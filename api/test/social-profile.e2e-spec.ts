import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { userSocialSettings, users } from '../src/db/schema.js';

/**
 * Profil public conscient du social, sur vraie base : agrégats, relation
 * d'abonnement, compte privé et permissions d'interaction.
 */
describe('Profil social (e2e)', () => {
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
        lastName: 'Profil',
        email: `${firstName.toLowerCase()}_profile_${suffix}_${counter}@e2e.dev`,
        password: 'password123',
        birthday: '1995-06-15',
        gender: 'FEMALE',
      })
      .expect(201);
    return { ...response.body.user, token: response.body.accessToken as string };
  };

  const profileOf = (viewer: { token: string }, userId: string) =>
    request(app.getHttpServer())
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${viewer.token}`);

  const makePrivate = async (userId: string) => {
    await db.update(users).set({ privateAccount: true }).where(eq(users.id, userId));
  };

  it('expose des agrégats sociaux à zéro sur un compte public', async () => {
    const alice = await register('Visiteuse');
    const bob = await register('Public');

    const body = (await profileOf(alice, bob.id).expect(200)).body;
    expect(body.social).toEqual({
      verified: false,
      privateAccount: false,
      followerCount: 0,
      followingCount: 0,
      publicationCount: 0,
      reelCount: 0,
      followStatus: 'none',
      followsViewer: false,
      contentVisible: true,
      canInteract: true,
    });
  });

  it('reflète un abonnement accepté des deux côtés', async () => {
    const alice = await register('Abonnee');
    const bob = await register('Suivi');
    await request(app.getHttpServer())
      .post(`/users/${bob.id}/follow`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(201);

    const seenByAlice = (await profileOf(alice, bob.id).expect(200)).body.social;
    expect(seenByAlice.followStatus).toBe('accepted');
    expect(seenByAlice.followerCount).toBe(1);
    expect(seenByAlice.followsViewer).toBe(false);

    const seenByBob = (await profileOf(bob, alice.id).expect(200)).body.social;
    expect(seenByBob.followStatus).toBe('none');
    expect(seenByBob.followingCount).toBe(1);
    expect(seenByBob.followsViewer).toBe(true);
  });

  it('ferme le contenu d’un compte privé jusqu’à l’acceptation', async () => {
    const alice = await register('Demandeuse');
    const bob = await register('Ferme');
    await makePrivate(bob.id);

    const before = (await profileOf(alice, bob.id).expect(200)).body.social;
    expect(before.contentVisible).toBe(false);
    expect(before.followStatus).toBe('none');
    expect(before.canInteract).toBe(false);

    await request(app.getHttpServer())
      .post(`/users/${bob.id}/follow`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(201);

    const pending = (await profileOf(alice, bob.id).expect(200)).body.social;
    expect(pending.contentVisible).toBe(false);
    expect(pending.followStatus).toBe('pending');
    expect(pending.followerCount).toBe(0);

    await request(app.getHttpServer())
      .post(`/users/me/follow-requests/${alice.id}/accept`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(201);

    const accepted = (await profileOf(alice, bob.id).expect(200)).body.social;
    expect(accepted.contentVisible).toBe(true);
    expect(accepted.followStatus).toBe('accepted');
    expect(accepted.followerCount).toBe(1);
    expect(accepted.canInteract).toBe(true);

    // Le propriétaire voit toujours son propre contenu.
    const own = (await profileOf(bob, bob.id).expect(200)).body;
    expect(own.isMe).toBe(true);
    expect(own.social.contentVisible).toBe(true);
    expect(own.social.canInteract).toBe(true);
  });

  it('applique la permission de commenter du compte consulté', async () => {
    const alice = await register('Curieuse');
    const bob = await register('Reserve');
    await db.insert(userSocialSettings).values({ userId: bob.id, commentPermission: 'nobody' });

    const body = (await profileOf(alice, bob.id).expect(200)).body.social;
    expect(body.canInteract).toBe(false);
    // Le profil public reste consultable : seule l'interaction est fermée.
    expect(body.contentVisible).toBe(true);
  });

  it('ne divulgue aucune donnée personnelle dans le profil', async () => {
    const alice = await register('Discrète');
    const bob = await register('Anonyme');

    const response = await profileOf(alice, bob.id).expect(200);
    expect(response.body).not.toHaveProperty('email');
    expect(response.body).not.toHaveProperty('birthday');
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('@e2e.dev');
    expect(JSON.stringify(response.body)).not.toContain('password123');
  });

  describe('profil par nom d’utilisateur', () => {
    const byUsername = (viewer: { token: string }, username: string) =>
      request(app.getHttpServer())
        .get(`/users/by-username/${encodeURIComponent(username)}`)
        .set('Authorization', `Bearer ${viewer.token}`);

    it('trouve le profil sans tenir compte de la casse ni du @', async () => {
      const viewer = await register('Visiteur');
      const target = await register('Recherchee');
      const exact = await byUsername(viewer, target.username).expect(200);
      expect(exact.body.id).toBe(target.id);
      const upper = await byUsername(viewer, `@${target.username.toUpperCase()}`).expect(200);
      expect(upper.body.id).toBe(target.id);
      expect(JSON.stringify(exact.body)).not.toContain('@e2e.dev');
    });

    it('répond 404 pour un nom inconnu ou invalide', async () => {
      const viewer = await register('Perdu');
      await byUsername(viewer, `inconnu${Date.now()}`).expect(404);
      await byUsername(viewer, 'a').expect(404);
      await byUsername(viewer, 'nom avec espaces').expect(404);
    });

    it('cache un compte bloqué, dans les deux sens', async () => {
      const blocker = await register('Bloqueuse');
      const blocked = await register('Bloque');
      await request(app.getHttpServer())
        .post(`/users/${blocked.id}/block`)
        .set('Authorization', `Bearer ${blocker.token}`)
        .expect(201);
      await byUsername(blocked, blocker.username).expect(404);
      await byUsername(blocker, blocked.username).expect(404);
    });
  });
});
