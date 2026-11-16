import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { users } from '../src/db/schema.js';

/**
 * Tests e2e réels : vraie base PostgreSQL, vraies transactions, vrai HTTP.
 * Ils vérifient les compteurs en base, pas seulement la réponse de l'API.
 */
describe('Graphe social — follows (e2e)', () => {
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
        lastName: 'Follows',
        email: `${firstName.toLowerCase()}_follows_${suffix}_${counter}@e2e.dev`,
        password: 'password123',
        birthday: '1995-06-15',
        gender: 'FEMALE',
      })
      .expect(201);
    return {
      ...response.body.user,
      token: response.body.accessToken as string,
    };
  };

  const follow = (actor: { token: string }, targetId: string) =>
    request(app.getHttpServer())
      .post(`/users/${targetId}/follow`)
      .set('Authorization', `Bearer ${actor.token}`);

  const unfollow = (actor: { token: string }, targetId: string) =>
    request(app.getHttpServer())
      .delete(`/users/${targetId}/follow`)
      .set('Authorization', `Bearer ${actor.token}`);

  const counters = async (userId: string) => {
    const [row] = await db
      .select({
        followers: users.followerCount,
        following: users.followingCount,
      })
      .from(users)
      .where(eq(users.id, userId));
    return row;
  };

  const makePrivate = async (userId: string) => {
    await db.update(users).set({ privateAccount: true }).where(eq(users.id, userId));
  };

  it('s’abonne à un compte public, une seule fois même en rejeu', async () => {
    const alice = await register('Suiveuse');
    const bob = await register('Public');

    const first = await follow(alice, bob.id).expect(201);
    expect(first.body).toEqual({ status: 'accepted', followerCount: 1 });

    const replay = await follow(alice, bob.id).expect(201);
    expect(replay.body).toEqual({ status: 'accepted', followerCount: 1 });

    expect(await counters(bob.id)).toEqual({ followers: 1, following: 0 });
    expect(await counters(alice.id)).toEqual({ followers: 0, following: 1 });
  });

  it('se désabonne sans passer le compteur sous zéro', async () => {
    const alice = await register('Partante');
    const bob = await register('Quittee');
    await follow(alice, bob.id).expect(201);

    const first = await unfollow(alice, bob.id).expect(200);
    expect(first.body).toEqual({ status: 'none', followerCount: 0 });

    const replay = await unfollow(alice, bob.id).expect(200);
    expect(replay.body).toEqual({ status: 'none', followerCount: 0 });

    expect(await counters(bob.id)).toEqual({ followers: 0, following: 0 });
    expect(await counters(alice.id)).toEqual({ followers: 0, following: 0 });
  });

  it('refuse de s’abonner à soi-même et à un compte inconnu', async () => {
    const alice = await register('Egocentrique');
    await follow(alice, alice.id).expect(400);
    await follow(alice, '00000000-0000-0000-0000-000000000000').expect(404);
  });

  it('refuse l’abonnement dès qu’un blocage existe, dans les deux sens', async () => {
    const alice = await register('Bloqueuse');
    const bob = await register('Bloque');

    await request(app.getHttpServer())
      .post(`/users/${bob.id}/block`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(201);

    await follow(bob, alice.id).expect(403);
    await follow(alice, bob.id).expect(403);
    expect(await counters(alice.id)).toEqual({ followers: 0, following: 0 });
  });

  it('un compte privé reçoit une demande, acceptée par son propriétaire seulement', async () => {
    const alice = await register('Demandeuse');
    const bob = await register('Prive');
    await makePrivate(bob.id);

    const requested = await follow(alice, bob.id).expect(201);
    expect(requested.body).toEqual({ status: 'pending', followerCount: 0 });

    // Une demande en attente ne compte pas comme un abonné.
    expect(await counters(bob.id)).toEqual({ followers: 0, following: 0 });

    const requests = await request(app.getHttpServer())
      .get('/users/me/follow-requests')
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(requests.body.map((item: { id: string }) => item.id)).toEqual([alice.id]);

    // Un tiers ne peut pas accepter une demande qui ne lui est pas adressée.
    const carol = await register('Tiers');
    await request(app.getHttpServer())
      .post(`/users/me/follow-requests/${alice.id}/accept`)
      .set('Authorization', `Bearer ${carol.token}`)
      .expect(404);

    const accepted = await request(app.getHttpServer())
      .post(`/users/me/follow-requests/${alice.id}/accept`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(201);
    expect(accepted.body).toEqual({ status: 'accepted', followerCount: 1 });

    expect(await counters(bob.id)).toEqual({ followers: 1, following: 0 });
    expect(await counters(alice.id)).toEqual({ followers: 0, following: 1 });

    // Rejouer l'acceptation ne reincrémente pas le compteur.
    await request(app.getHttpServer())
      .post(`/users/me/follow-requests/${alice.id}/accept`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(404);
    expect(await counters(bob.id)).toEqual({ followers: 1, following: 0 });

    const after = await request(app.getHttpServer())
      .get('/users/me/follow-requests')
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(after.body).toEqual([]);
  });

  it('refuse une demande de compte privé sans toucher aux compteurs', async () => {
    const alice = await register('Refusee');
    const bob = await register('Selectif');
    await makePrivate(bob.id);
    await follow(alice, bob.id).expect(201);

    const rejected = await request(app.getHttpServer())
      .post(`/users/me/follow-requests/${alice.id}/reject`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(201);
    expect(rejected.body).toEqual({ status: 'none', followerCount: 0 });

    expect(await counters(bob.id)).toEqual({ followers: 0, following: 0 });
    expect(await counters(alice.id)).toEqual({ followers: 0, following: 0 });
  });

  it('pagine les abonnés par curseur, sans doublon', async () => {
    const owner = await register('Populaire');
    const first = await register('Fan1');
    const second = await register('Fan2');
    const third = await register('Fan3');
    for (const fan of [first, second, third]) {
      await follow(fan, owner.id).expect(201);
    }

    const page1 = await request(app.getHttpServer())
      .get(`/users/${owner.id}/followers`)
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    const page2 = await request(app.getHttpServer())
      .get(`/users/${owner.id}/followers`)
      .query({ limit: 2, cursor: page1.body.nextCursor })
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();

    const ids = [
      ...page1.body.items.map((item: { id: string }) => item.id),
      ...page2.body.items.map((item: { id: string }) => item.id),
    ];
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(expect.arrayContaining([first.id, second.id, third.id]));
  });

  it('ne divulgue que des champs publics dans les listes', async () => {
    const owner = await register('Discret');
    const fan = await register('Curieuse');
    await follow(fan, owner.id).expect(201);

    const response = await request(app.getHttpServer())
      .get(`/users/${owner.id}/followers`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const [item] = response.body.items;
    expect(item).toEqual({
      id: fan.id,
      username: fan.username,
      displayName: expect.any(String),
      avatarUrl: null,
      bio: null,
      verified: false,
    });
    expect(JSON.stringify(response.body)).not.toContain('@e2e.dev');
    expect(item).not.toHaveProperty('birthday');
    expect(item).not.toHaveProperty('email');
  });

  it('ferme les listes d’un compte privé aux inconnus, pas à ses abonnés', async () => {
    const owner = await register('Fermee');
    const fan = await register('Fidele');
    const stranger = await register('Inconnu');
    await makePrivate(owner.id);
    await follow(fan, owner.id).expect(201);
    await request(app.getHttpServer())
      .post(`/users/me/follow-requests/${fan.id}/accept`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/users/${owner.id}/followers`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(403);

    const visible = await request(app.getHttpServer())
      .get(`/users/${owner.id}/followers`)
      .set('Authorization', `Bearer ${fan.token}`)
      .expect(200);
    expect(visible.body.items.map((item: { id: string }) => item.id)).toEqual([fan.id]);

    const own = await request(app.getHttpServer())
      .get(`/users/${owner.id}/following`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(own.body.items).toEqual([]);
  });

  it('rejette un curseur forgé au lieu de renvoyer une page incohérente', async () => {
    const owner = await register('Curseur');
    await request(app.getHttpServer())
      .get(`/users/${owner.id}/followers`)
      .query({ cursor: 'n’importe-quoi' })
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(400);
  });

  it('deux abonnements simultanés ne comptent qu’une fois', async () => {
    const alice = await register('Rapide');
    const bob = await register('Convoite');

    const responses = await Promise.all([follow(alice, bob.id), follow(alice, bob.id)]);
    for (const response of responses) {
      expect(response.status).toBe(201);
      expect(response.body.status).toBe('accepted');
    }

    expect(await counters(bob.id)).toEqual({ followers: 1, following: 0 });
  });

  it('deux acceptations simultanées ne gonflent pas le compteur', async () => {
    const alice = await register('Impatiente');
    const bob = await register('PriveConcurrent');
    await makePrivate(bob.id);
    await follow(alice, bob.id).expect(201);

    const accept = () =>
      request(app.getHttpServer())
        .post(`/users/me/follow-requests/${alice.id}/accept`)
        .set('Authorization', `Bearer ${bob.token}`);
    const responses = await Promise.all([accept(), accept()]);

    // La seconde peut répondre 404 (déjà acceptée) : seul le compteur compte.
    for (const response of responses) {
      expect([201, 404]).toContain(response.status);
    }
    expect(await counters(bob.id)).toEqual({ followers: 1, following: 0 });
    expect(await counters(alice.id)).toEqual({ followers: 0, following: 1 });
  });

  it('liste les comptes suivis, et exclut les demandes en attente', async () => {
    const alice = await register('SuiveuseListe');
    const publicUser = await register('PublicListe');
    const privateUser = await register('PriveListe');
    await makePrivate(privateUser.id);

    await follow(alice, publicUser.id).expect(201);
    await follow(alice, privateUser.id).expect(201);

    const page = await request(app.getHttpServer())
      .get(`/users/${alice.id}/following`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);

    const ids = page.body.items.map((item: { id: string }) => item.id);
    expect(ids).toEqual([publicUser.id]);
    expect(await counters(alice.id)).toEqual({ followers: 0, following: 1 });
  });
});
