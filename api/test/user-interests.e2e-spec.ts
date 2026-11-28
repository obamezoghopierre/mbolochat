import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { userInterests } from '../src/db/schema.js';
import { RankingService } from '../src/ranking/ranking.service.js';

/**
 * Collecte des intérêts du spectateur, sur vraie base. La collecte est lancée
 * hors transaction et sans attente (`void`) : chaque test attend donc que la
 * ligne attendue apparaisse au lieu de supposer qu'elle est déjà écrite.
 */
describe('Intérêts du spectateur (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  const suffix = Date.now();
  let counter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
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
        lastName: 'Interets',
        email: `${firstName.toLowerCase()}_interets_${suffix}_${counter}@e2e.dev`,
        password=[REDACTED_PASSWORD]
        birthday: '1995-06-15',
        gender: 'FEMALE',
      })
      .expect(201);
    return {
      ...response.body.user,
      token: response.body.accessToken as string,
    };
  };

  const publish = async (actor: { token: string }, caption: string) =>
    (
      await request(app.getHttpServer())
        .post('/publications')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({
          caption,
          clientId: `interets-${suffix}-${Math.random().toString(36).slice(2)}`,
        })
        .expect(201)
    ).body as { id: string };

  const post = (
    actor: { token: string },
    path: string,
    body: Record<string, unknown> = {},
  ) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${actor.token}`)
      .send(body);

  const scoreOf = async (userId: string, subject: string) => {
    const [row] = await db
      .select({ score: userInterests.score })
      .from(userInterests)
      .where(
        and(
          eq(userInterests.userId, userId),
          eq(userInterests.subject, subject),
        ),
      );
    return row?.score ?? null;
  };

  /** La collecte n'est pas attendue par l'API : on attend son effet. */
  const waitForScore = async (
    userId: string,
    subject: string,
    expected: (score: number | null) => boolean,
  ) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const score = await scoreOf(userId, subject);
      if (expected(score)) {
        return score;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return scoreOf(userId, subject);
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

  it('retient l’intérêt pour les sujets d’un post aimé', async () => {
    const author = await register('Autrice');
    const viewer = await register('Spectatrice');
    const tag = `cuisine${suffix}`;
    const p = await publish(author, `Recette gabonaise #${tag}`);

    await post(viewer, `/publications/${p.id}/like`, { kind: 'like' }).expect(
      201,
    );
    expect(await waitForScore(viewer.id, tag, (s) => s !== null)).toBeCloseTo(2, 3);
    // Un mot-clé implicite de la légende est retenu aussi.
    expect(
      await waitForScore(viewer.id, 'recette', (s) => s !== null),
    ).toBeGreaterThan(0);
  });

  it('ne recompte pas une réaction rejouée ni un changement de type', async () => {
    const author = await register('Rejeu');
    const viewer = await register('Hesitante');
    const tag = `rejeu${suffix}`;
    const p = await publish(author, `Un sujet précis #${tag}`);

    await post(viewer, `/publications/${p.id}/like`, { kind: 'like' }).expect(201);
    await waitForScore(viewer.id, tag, (s) => s !== null);
    await post(viewer, `/publications/${p.id}/like`, { kind: 'like' }).expect(201);
    await post(viewer, `/publications/${p.id}/like`, { kind: 'love' }).expect(201);
    await settle();
    expect(await scoreOf(viewer.id, tag)).toBeCloseTo(2, 3);
  });

  it('valorise un envoi plus qu’un like, et cumule les actions', async () => {
    const author = await register('Cumul');
    const viewer = await register('Passionnee');
    const tag = `cumul${suffix}`;
    const p = await publish(author, `Match de football #${tag}`);

    await post(viewer, `/publications/${p.id}/like`, { kind: 'like' }).expect(201);
    await waitForScore(viewer.id, tag, (s) => s !== null && s > 1.9);
    await post(viewer, `/publications/${p.id}/save`).expect(201);
    await waitForScore(viewer.id, tag, (s) => s !== null && s > 5.9);
    await post(viewer, `/publications/${p.id}/share`).expect(201);
    // like (2) + save (4) + share (6), à la décroissance de quelques ms près.
    expect(
      await waitForScore(viewer.id, tag, (s) => s !== null && s > 11.9),
    ).toBeCloseTo(12, 2);
  });

  it('n’apprend rien des publications de l’auteur lui-même', async () => {
    const author = await register('Solo');
    const tag = `solo${suffix}`;
    const p = await publish(author, `Mon propre sujet #${tag}`);

    await post(author, `/publications/${p.id}/like`, { kind: 'like' }).expect(201);
    await post(author, `/publications/${p.id}/save`).expect(201);
    await post(author, `/publications/${p.id}/view`, { watchedMs: 9000, completed: true }).expect(201);
    await settle();
    expect(await scoreOf(author.id, tag)).toBeNull();
  });

  it('compte un zap suivi d’un vrai visionnage, sans recompter un rejeu', async () => {
    const author = await register('Palier');
    const viewer = await register('Zappeuse');
    const tag = `palier${suffix}`;
    const p = await publish(author, `Un contenu à tester #${tag}`);
    const view = (body: Record<string, unknown>) =>
      post(viewer, `/publications/${p.id}/view`, body).expect(201);

    await view({ watchedMs: 800 });
    // zap : -1
    expect(
      await waitForScore(viewer.id, tag, (s) => s !== null),
    ).toBeCloseTo(-1, 3);
    // Même vue renvoyée : le palier n'a pas changé, rien n'est recompté.
    await view({ watchedMs: 800 });
    await settle();
    expect(await scoreOf(viewer.id, tag)).toBeCloseTo(-1, 3);
    // Le spectateur revient et regarde : palier « watch » (+1), donc le zap est
    // compensé. La décroissance de quelques millisecondes entre deux écritures
    // est négligeable : on compare avec une tolérance.
    await view({ watchedMs: 6000 });
    expect(
      await waitForScore(viewer.id, tag, (s) => s !== null && s > -0.5),
    ).toBeCloseTo(0, 2);
    // Terminé pour la première fois : +3, et une seule fois.
    await view({ watchedMs: 6000, completed: true });
    await waitForScore(viewer.id, tag, (s) => s !== null && s > 2);
    await view({ watchedMs: 6000, completed: true });
    await settle();
    expect(await scoreOf(viewer.id, tag)).toBeCloseTo(3, 2);
  });

  it('n’efface pas un sujet aimé sur un seul zap', async () => {
    const author = await register('Fragile');
    const viewer = await register('Fidele');
    const tag = `fragile${suffix}`;
    const loved = await publish(author, `Premier contenu #${tag}`);
    const other = await publish(author, `Second contenu #${tag}`);

    await post(viewer, `/publications/${loved.id}/save`).expect(201);
    await waitForScore(viewer.id, tag, (s) => s !== null && s > 3.9);
    await post(viewer, `/publications/${other.id}/view`, { watchedMs: 500 }).expect(201);
    const after = await waitForScore(viewer.id, tag, (s) => s !== null && s < 3.5);
    // 4 - 1, à la décroissance de quelques millisecondes près.
    expect(after).toBeCloseTo(3, 2);
    expect(after).toBeGreaterThan(0);
  });

  it('ne casse jamais l’action quand la collecte échoue', async () => {
    const author = await register('Robuste');
    const viewer = await register('Tranquille');
    // Aucune légende exploitable : aucun sujet, la collecte ne fait rien et le
    // like réussit normalement.
    const p = await publish(author, 'Il a la');
    const response = await post(viewer, `/publications/${p.id}/like`, { kind: 'like' }).expect(201);
    expect(response.body.reaction).toBe('like');
  });

  it('supprime les intérêts périmés sans toucher aux récents', async () => {
    const ranking = app.get(RankingService);
    const author = await register('Purge');
    const viewer = await register('Oublieuse');
    const stale = `ancien${suffix}`;
    const fresh = `recent${suffix}`;
    const p = await publish(author, `Deux sujets #${stale} #${fresh}`);
    await post(viewer, `/publications/${p.id}/like`, { kind: 'like' }).expect(201);
    await waitForScore(viewer.id, fresh, (s) => s !== null);
    await waitForScore(viewer.id, stale, (s) => s !== null);

    // Un intérêt resté inactif des mois : sa valeur décroissée est négligeable.
    await db
      .update(userInterests)
      .set({ updatedAt: new Date(Date.now() - 400 * 86_400_000) })
      .where(
        and(eq(userInterests.userId, viewer.id), eq(userInterests.subject, stale)),
      );

    await ranking.purgeStaleInterests();
    expect(await scoreOf(viewer.id, stale)).toBeNull();
    expect(await scoreOf(viewer.id, fresh)).toBeCloseTo(2, 3);
  });
});
