import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { publications, users } from '../src/db/schema.js';

/**
 * Signalements et modération sur vraie base : file, décisions, audit,
 * auto-flag par mots bloqués et contrôle d'accès `/admin`.
 */
describe('Modération (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  const suffix = Date.now();
  const letters = Array.from({ length: 5 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join('');
  let counter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    await migrate(db, { migrationsFolder: 'drizzle' });
  });

  afterAll(async () => {
    await app.close();
  });

  const register = async (firstName: string) => {
    counter += 1;
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        firstName,
        lastName: 'Modo',
        email: `${firstName.toLowerCase()}_modo_${suffix}_${counter}@e2e.dev`,
        password: 'password123',
        birthday: '1995-06-15',
        gender: 'FEMALE',
      })
      .expect(201);
    return { ...response.body.user, token: response.body.accessToken as string };
  };

  const promote = async (userId: string, role: 'moderator' | 'admin') => {
    await db.update(users).set({ role }).where(eq(users.id, userId));
  };

  const publish = async (actor: { token: string }, caption: string) => {
    const response = await request(app.getHttpServer())
      .post('/publications')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({
        caption,
        clientId: `modo-${suffix}-${Math.random().toString(36).slice(2)}`,
      })
      .expect(201);
    return response.body;
  };

  const report = (
    actor: { token: string },
    targetType: string,
    targetId: string,
    reason = 'spam',
  ) =>
    request(app.getHttpServer())
      .post('/reports')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ targetType, targetId, reason, details: 'Signalement de test' });

  const queue = (actor: { token: string }, query: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .get('/admin/reports')
      .query(query)
      .set('Authorization', `Bearer ${actor.token}`);

  const decide = (
    actor: { token: string },
    reportId: string,
    action: string,
    notes?: string,
  ) =>
    request(app.getHttpServer())
      .post(`/admin/reports/${reportId}/decision`)
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ action, notes });

  const publicationRow = async (id: string) => {
    const [row] = await db.select().from(publications).where(eq(publications.id, id));
    return row;
  };

  it('enregistre un signalement une seule fois et l’expose dans la file', async () => {
    const author = await register('Signale');
    const reporter = await register('Rapporteur');
    const moderator = await register('Moderatrice');
    await promote(moderator.id, 'moderator');
    const post = await publish(author, 'Contenu discutable');

    const first = await report(reporter, 'publication', post.id).expect(201);
    const replay = await report(reporter, 'publication', post.id).expect(201);
    expect(replay.body.id).toBe(first.body.id);

    const page = await queue(moderator).expect(200);
    const item = page.body.items.find(
      (entry: { id: string }) => entry.id === first.body.id,
    );
    expect(item.targetPreview).toBe('Contenu discutable');
    expect(item.targetAuthorId).toBe(author.id);
    expect(item.reporter.id).toBe(reporter.id);
    expect(JSON.stringify(page.body)).not.toContain('@e2e.dev');
  });

  it('refuse l’auto-signalement et une cible inconnue', async () => {
    const author = await register('Auto');
    const post = await publish(author, 'Mon contenu');
    await report(author, 'publication', post.id).expect(400);
    await report(author, 'publication', '00000000-0000-0000-0000-000000000000').expect(404);
  });

  it('ferme l’accès /admin aux comptes ordinaires', async () => {
    const normal = await register('Simple');
    await queue(normal).expect(403);
    await request(app.getHttpServer())
      .get('/admin/blocked-words')
      .set('Authorization', `Bearer ${normal.token}`)
      .expect(403);
    await decide(normal, '00000000-0000-0000-0000-000000000000', 'warn').expect(403);
  });

  it('masque, retire et restaure une publication, avec audit', async () => {
    const author = await register('Auteur');
    const reporter = await register('Plaintif');
    const moderator = await register('Juge');
    await promote(moderator.id, 'moderator');

    const hidden = await publish(author, 'A masquer');
    const hiddenReport = await report(reporter, 'publication', hidden.id).expect(201);
    await decide(moderator, hiddenReport.body.id, 'hide', 'Signale').expect(201);
    expect((await publicationRow(hidden.id)).moderationStatus).toBe('flagged');

    const removed = await publish(author, 'A retirer');
    const removedReport = await report(reporter, 'publication', removed.id).expect(201);
    await decide(moderator, removedReport.body.id, 'remove').expect(201);
    expect((await publicationRow(removed.id)).moderationStatus).toBe('removed');
    // Le contenu retiré n'est plus lisible par un tiers.
    await request(app.getHttpServer())
      .get(`/publications/${removed.id}`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .expect(404);

    // Restauration : une publication `flagged` redevient `approved`.
    const restoredPost = await publish(author, 'A restaurer');
    const restoredReport = await report(reporter, 'publication', restoredPost.id).expect(201);
    await decide(moderator, restoredReport.body.id, 'hide').expect(201);
    await decide(moderator, restoredReport.body.id, 'restore').expect(201);
    // Le signalement était clos : seule une restauration reste possible, et
    // elle ne rouvre pas le dossier.
    expect((await publicationRow(restoredPost.id)).moderationStatus).toBe('approved');

    const audit = await request(app.getHttpServer())
      .get('/admin/audit')
      .set('Authorization', `Bearer ${moderator.token}`)
      .expect(200);
    const actions = audit.body.items.map((item: { action: string }) => item.action);
    expect(actions).toEqual(expect.arrayContaining(['hide', 'remove']));
  });

  it('rejette un signalement sans toucher au contenu', async () => {
    const author = await register('Innocente');
    const reporter = await register('Susceptible');
    const moderator = await register('Arbitre');
    await promote(moderator.id, 'admin');
    const post = await publish(author, 'Contenu licite');

    const created = await report(reporter, 'publication', post.id, 'other').expect(201);
    const decision = await decide(moderator, created.body.id, 'dismiss').expect(201);
    expect(decision.body.status).toBe('dismissed');
    expect((await publicationRow(post.id)).moderationStatus).toBe('pending');

    const page = await queue(moderator, { status: 'dismissed' }).expect(200);
    expect(page.body.items.map((item: { id: string }) => item.id)).toContain(created.body.id);
  });

  it('auto-flag une publication qui contient un mot bloqué', async () => {
    const moderator = await register('Censeur');
    await promote(moderator.id, 'admin');
    const author = await register('Bavarde');
    const word = `vilain${letters}`;

    const added = await request(app.getHttpServer())
      .post('/admin/blocked-words')
      .set('Authorization', `Bearer ${moderator.token}`)
      .send({ word })
      .expect(201);
    expect(added.body.word).toBe(word);

    // Accents et majuscules neutralisés à la comparaison.
    const post = await publish(author, `Quel VILAIN${letters.toUpperCase()} propos`);
    expect((await publicationRow(post.id)).moderationStatus).toBe('flagged');

    // Le mot retiré, un nouveau contenu repasse en contrôle automatique.
    await request(app.getHttpServer())
      .delete(`/admin/blocked-words/${added.body.id}`)
      .set('Authorization', `Bearer ${moderator.token}`)
      .expect(200);
    const clean = await publish(author, `Quel VILAIN${letters.toUpperCase()} propos`);
    expect((await publicationRow(clean.id)).moderationStatus).toBe('pending');
  });

  it('notifie les mentions d’un post signalé seulement une fois validé', async () => {
    const moderator = await register('Valideur');
    await promote(moderator.id, 'admin');
    const author = await register('Mentionne');
    const target = await register('Citee');
    const reporter = await register('Vigie');
    const word = `grossier${letters}`;
    const added = await request(app.getHttpServer())
      .post('/admin/blocked-words')
      .set('Authorization', `Bearer ${moderator.token}`)
      .send({ word })
      .expect(201);

    const mentionsOf = async (publicationId: string) =>
      (
        await request(app.getHttpServer())
          .get('/social/notifications')
          .set('Authorization', `Bearer ${target.token}`)
          .expect(200)
      ).body.items.filter(
        (item: { type: string; publicationId: string }) =>
          item.type === 'mention' && item.publicationId === publicationId,
      );

    const post = await publish(author, `Coucou @${target.username}, ${word}`);
    expect((await publicationRow(post.id)).moderationStatus).toBe('flagged');
    // En revue : personne n'est notifié d'un contenu invisible.
    expect(await mentionsOf(post.id)).toEqual([]);

    const created = await report(reporter, 'publication', post.id).expect(201);
    await decide(moderator, created.body.id, 'restore').expect(201);
    expect((await publicationRow(post.id)).moderationStatus).toBe('approved');
    const received = await mentionsOf(post.id);
    expect(received).toHaveLength(1);
    expect(received[0].actor.id).toBe(author.id);

    // Rejouer la validation ne notifie pas une seconde fois.
    await decide(moderator, created.body.id, 'restore').expect(201);
    expect(await mentionsOf(post.id)).toHaveLength(1);

    await request(app.getHttpServer())
      .delete(`/admin/blocked-words/${added.body.id}`)
      .set('Authorization', `Bearer ${moderator.token}`)
      .expect(200);
  });

  it('refuse une suspension non supportée et une action inapplicable', async () => {
    const author = await register('Suspension');
    const reporter = await register('Plaintif2');
    const moderator = await register('Juge2');
    await promote(moderator.id, 'moderator');
    const post = await publish(author, 'Contenu');

    const created = await report(reporter, 'publication', post.id).expect(201);
    await decide(moderator, created.body.id, 'suspend').expect(400);

    const userReport = await report(reporter, 'user', author.id, 'harassment').expect(201);
    await decide(moderator, userReport.body.id, 'remove').expect(400);
    // Le signalement reste ouvert après un refus d'action.
    const page = await queue(moderator).expect(200);
    expect(page.body.items.map((item: { id: string }) => item.id)).toContain(userReport.body.id);
  });

  it('recherche un compte pour le back-office et valide la requête', async () => {
    const moderator = await register('Chercheuse');
    await promote(moderator.id, 'moderator');
    const target = await register(`Pseudo${letters}`);

    const found = await request(app.getHttpServer())
      .get('/admin/users')
      .query({ q: `Pseudo${letters}` })
      .set('Authorization', `Bearer ${moderator.token}`)
      .expect(200);
    expect(found.body.map((row: { id: string }) => row.id)).toContain(target.id);
    expect(found.body[0]).not.toHaveProperty('email');

    await request(app.getHttpServer())
      .get('/admin/users')
      .query({ q: 'a' })
      .set('Authorization', `Bearer ${moderator.token}`)
      .expect(400);
  });
});
