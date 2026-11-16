import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { userSocialSettings, users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Notifications sociales : création serveur dans la transaction, déduplication,
 * blocages, préférences et lecture — sur vraie base PostgreSQL.
 */
describe('Notifications sociales (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  const suffix = Date.now();
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
        lastName: 'Notifs',
        email: `${firstName.toLowerCase()}_notifs_${suffix}_${counter}@e2e.dev`,
        password: 'password123',
        birthday: '1995-06-15',
        gender: 'FEMALE',
      })
      .expect(201);
    return { ...response.body.user, token: response.body.accessToken as string };
  };

  const publish = async (actor: { token: string }) => {
    const response = await request(app.getHttpServer())
      .post('/publications')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({
        caption: 'Base de notification',
        clientId: `notif-${suffix}-${Math.random().toString(36).slice(2)}`,
      })
      .expect(201);
    return response.body;
  };

  const notifications = (actor: { token: string }, query: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .get('/social/notifications')
      .query(query)
      .set('Authorization', `Bearer ${actor.token}`);

  const like = (actor: { token: string }, publicationId: string) =>
    request(app.getHttpServer())
      .post(`/publications/${publicationId}/like`)
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ kind: 'like' });

  const comment = (actor: { token: string }, publicationId: string, body: string, parentId?: string) =>
    request(app.getHttpServer())
      .post(`/publications/${publicationId}/comments`)
      .set('Authorization', `Bearer ${actor.token}`)
      .send({
        body,
        parentId,
        clientId: `notif-c-${suffix}-${Math.random().toString(36).slice(2)}`,
      });

  it('notifie une réaction une seule fois, jamais à soi-même', async () => {
    const author = await register('Auteur');
    const fan = await register('Fan');
    const post = await publish(author);

    await like(fan, post.id).expect(201);
    await like(fan, post.id).expect(201);

    const page = await notifications(author).expect(200);
    const likes = page.body.items.filter((item: { type: string }) => item.type === 'like');
    expect(likes).toHaveLength(1);
    expect(page.body.unreadCount).toBe(1);
    expect(likes[0].actor.id).toBe(fan.id);
    expect(JSON.stringify(page.body)).not.toContain('@e2e.dev');

    // Se liker soi-même ne crée rien.
    const own = await publish(author);
    await like(author, own.id).expect(201);
    const after = await notifications(author).expect(200);
    expect(
      after.body.items.filter(
        (item: { type: string; publicationId: string }) =>
          item.type === 'like' && item.publicationId === own.id,
      ),
    ).toEqual([]);
  });

  it('notifie le commentaire et la réponse à son auteur', async () => {
    const author = await register('Createur');
    const commenter = await register('Commentateur');
    const post = await publish(author);

    const root = await comment(commenter, post.id, 'Premier').expect(201);
    const reply = await comment(author, post.id, 'Merci', root.body.id).expect(201);
    // Une réponse de l'auteur à son propre commentaire ne doit rien créer.
    expect(reply.body.parentId).toBe(root.body.id);

    const authorPage = await notifications(author).expect(200);
    expect(
      authorPage.body.items.some(
        (item: { type: string; publicationId: string }) =>
          item.type === 'comment' && item.publicationId === post.id,
      ),
    ).toBe(true);
    // L'auteur répond à son tour : pas de notification pour lui-même.
    expect(
      authorPage.body.items.some(
        (item: { type: string }) => item.type === 'reply',
      ),
    ).toBe(false);

    const commenterPage = await notifications(commenter).expect(200);
    const replies = commenterPage.body.items.filter(
      (item: { type: string; commentId: string }) =>
        item.type === 'reply' && item.commentId === reply.body.id,
    );
    expect(replies).toHaveLength(1);
  });

  it('distingue abonnement, demande et acceptation', async () => {
    const owner = await register('Proprio');
    const fan = await register('Abonne');
    const privateName = `prive${suffix}`;
    void privateName;

    await request(app.getHttpServer())
      .post(`/users/${owner.id}/follow`)
      .set('Authorization', `Bearer ${fan.token}`)
      .expect(201);

    const followNotifs = (await notifications(owner).expect(200)).body.items.filter(
      (item: { type: string }) => item.type === 'follow',
    );
    expect(followNotifs).toHaveLength(1);
    expect(followNotifs[0].actor.id).toBe(fan.id);

    // Compte privé : demande puis acceptation.
    const closed = await register('Ferme');
    await db.update(users).set({ privateAccount: true }).where(eq(users.id, closed.id));
    await request(app.getHttpServer())
      .post(`/users/${closed.id}/follow`)
      .set('Authorization', `Bearer ${fan.token}`)
      .expect(201);
    const requests = (await notifications(closed).expect(200)).body.items.filter(
      (item: { type: string }) => item.type === 'follow_request',
    );
    expect(requests).toHaveLength(1);

    await request(app.getHttpServer())
      .post(`/users/me/follow-requests/${fan.id}/accept`)
      .set('Authorization', `Bearer ${closed.token}`)
      .expect(201);
    const accepted = (await notifications(fan).expect(200)).body.items.filter(
      (item: { type: string; actor: { id: string } }) =>
        item.type === 'follow_accepted' && item.actor.id === closed.id,
    );
    expect(accepted).toHaveLength(1);
  });

  it('ne notifie jamais entre comptes bloqués', async () => {
    const author = await register('Bloqueur');
    const fan = await register('Bloquee');
    const post = await publish(author);

    await request(app.getHttpServer())
      .post(`/users/${fan.id}/block`)
      .set('Authorization', `Bearer ${author.token}`)
      .expect(201);

    // L'auteur a bloqué le fan : le fan ne voit plus le post, et aucune
    // notification ne doit être créée pour l'auteur.
    await like(fan, post.id).expect(404);
    const page = await notifications(author).expect(200);
    expect(
      page.body.items.filter(
        (item: { publicationId: string }) => item.publicationId === post.id,
      ),
    ).toEqual([]);
  });

  it('marque comme lues toutes les notifications ou une sélection', async () => {
    const author = await register('Lecteur');
    const first = await register('Premier');
    const second = await register('Second');
    const post = await publish(author);
    await like(first, post.id).expect(201);
    await like(second, post.id).expect(201);

    let page = await notifications(author).expect(200);
    expect(page.body.unreadCount).toBe(2);

    const target = page.body.items[0].id as string;
    const partial = await request(app.getHttpServer())
      .post('/social/notifications/read')
      .set('Authorization', `Bearer ${author.token}`)
      .send({ ids: [target] })
      .expect(201);
    expect(partial.body.updated).toBe(1);

    page = await notifications(author).expect(200);
    expect(page.body.unreadCount).toBe(1);
    expect(page.body.items.find((item: { id: string }) => item.id === target).readAt).toBeTruthy();

    const all = await request(app.getHttpServer())
      .post('/social/notifications/read')
      .set('Authorization', `Bearer ${author.token}`)
      .send({})
      .expect(201);
    expect(all.body.updated).toBe(1);
    page = await notifications(author).expect(200);
    expect(page.body.unreadCount).toBe(0);
  });

  it('pagine les notifications sans doublon et reste privé', async () => {
    const author = await register('Populaire');
    const post = await publish(author);
    for (let index = 0; index < 3; index += 1) {
      const fan = await register(`FanNotif${'abc'[index]}`);
      await like(fan, post.id).expect(201);
    }

    const page1 = await notifications(author, { limit: 2 }).expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    const page2 = await notifications(author, {
      limit: 2,
      cursor: page1.body.nextCursor,
    }).expect(200);
    const ids = [
      ...page1.body.items.map((item: { id: string }) => item.id),
      ...page2.body.items.map((item: { id: string }) => item.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);

    // Un autre compte ne voit jamais ces notifications.
    const stranger = await register('Etranger');
    const foreign = await notifications(stranger).expect(200);
    expect(foreign.body.items).toEqual([]);
  });

  it('enregistre la notification même si le push est coupé par les préférences', async () => {
    const author = await register('Silencieux');
    const fan = await register('Discret');
    const post = await publish(author);
    await db
      .insert(userSocialSettings)
      .values({ userId: author.id, notifyLikes: false })
      .onConflictDoNothing();

    await like(fan, post.id).expect(201);

    const page = await notifications(author).expect(200);
    expect(
      page.body.items.some(
        (item: { type: string; publicationId: string }) =>
          item.type === 'like' && item.publicationId === post.id,
      ),
    ).toBe(true);
  });
});
