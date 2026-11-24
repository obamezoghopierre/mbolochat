import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { publications, users } from '../src/db/schema.js';

describe('Discover (e2e)', () => {
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

  const register = async (name: string) => {
    counter += 1;
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        firstName: name,
        lastName: 'Discover',
        email: `${name.toLowerCase()}_discover_${suffix}_${counter}@e2e.dev`,
        password: 'password123',
        birthday: '1995-06-15',
        gender: 'FEMALE',
      })
      .expect(201);
    return { ...response.body.user, token: response.body.accessToken as string };
  };

  const publish = (actor: { token: string }, caption = 'Publication découverte') =>
    request(app.getHttpServer())
      .post('/publications')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({
        caption,
        clientId: `discover-${suffix}-${Math.random().toString(36).slice(2)}`,
      });

  const discover = (actor: { token: string }) =>
    request(app.getHttpServer())
      .get('/discover')
      .set('Authorization', `Bearer ${actor.token}`);

  const follow = (actor: { token: string }, targetId: string) =>
    request(app.getHttpServer())
      .post(`/users/${targetId}/follow`)
      .set('Authorization', `Bearer ${actor.token}`)
      .expect(201);

  const setCity = (userId: string, city: string | null) =>
    db.update(users).set({ city }).where(eq(users.id, userId));

  const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

  it('limite les comptes proches aux abonnements mutuels dans la même ville', async () => {
    const viewer = await register('LecteurProche');
    const friend = await register('AmieProche');
    const oneWay = await register('SuivieSeule');
    const elsewhere = await register('AmieLointaine');
    const city = `Discover-${suffix}`;
    await Promise.all([
      setCity(viewer.id, city),
      setCity(friend.id, city),
      setCity(oneWay.id, city),
      setCity(elsewhere.id, 'Autre-ville'),
    ]);

    await follow(viewer, friend.id);
    await follow(friend, viewer.id);
    await follow(viewer, oneWay.id);
    await follow(viewer, elsewhere.id);
    await follow(elsewhere, viewer.id);

    const friendPost = await publish(friend).expect(201);
    const oneWayPost = await publish(oneWay).expect(201);
    const distantPost = await publish(elsewhere).expect(201);

    const response = await discover(viewer).expect(200);
    expect(response.body.cityKnown).toBe(true);
    const nearbyIds = ids(response.body.sections.nearbyFriends);
    expect(nearbyIds).toContain(friendPost.body.id);
    expect(nearbyIds).not.toContain(oneWayPost.body.id);
    expect(nearbyIds).not.toContain(distantPost.body.id);
    expect(response.body.sections.nearbyFriends.length).toBeLessThanOrEqual(12);
    expect(response.body.sections.popular).toBeInstanceOf(Array);
    expect(response.body.sections.successful).toBeInstanceOf(Array);
    expect(response.body.sections.trendingHashtags).toBeInstanceOf(Array);
    expect(response.body.sections.suggestedAccounts).toBeInstanceOf(Array);

    await setCity(viewer.id, null);
    const withoutCity = await discover(viewer).expect(200);
    expect(withoutCity.body.cityKnown).toBe(false);
    expect(withoutCity.body.sections.nearbyFriends).toEqual([]);
  });

  it('classe le succès sur les interactions des 7 derniers jours et les tendances par hot score', async () => {
    const viewer = await register('LecteurSucces');
    const author = await register('AutriceSucces');
    const high = await publish(author, 'Très engageant').expect(201);
    const medium = await publish(author, 'Engagement moyen').expect(201);
    const old = await publish(author, 'Ancienne publication').expect(201);

    await db
      .update(publications)
      .set({ likeCount: 2_000_000_000, commentCount: 147_483_647, hotScore: 2_147_483_647 })
      .where(eq(publications.id, high.body.id));
    await db
      .update(publications)
      .set({ likeCount: 2_000_000_000, commentCount: 147_483_646, hotScore: 2_147_483_646 })
      .where(eq(publications.id, medium.body.id));
    await db
      .update(publications)
      .set({
        likeCount: 1_000_000,
        createdAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
        hotScore: 1_000_000,
      })
      .where(eq(publications.id, old.body.id));

    const response = await discover(viewer).expect(200);
    const successfulIds = ids(response.body.sections.successful);
    expect(successfulIds[0]).toBe(high.body.id);
    expect(successfulIds).not.toContain(old.body.id);
    if (successfulIds.includes(medium.body.id)) {
      expect(successfulIds.indexOf(high.body.id)).toBeLessThan(successfulIds.indexOf(medium.body.id));
    }

    const popularIds = ids(response.body.sections.popular);
    expect(popularIds[0]).toBe(high.body.id);
    if (popularIds.includes(medium.body.id)) {
      expect(popularIds.indexOf(high.body.id)).toBeLessThan(popularIds.indexOf(medium.body.id));
    }
  });

  it('applique blocages, comptes privés, retours négatifs et modération en SQL', async () => {
    const viewer = await register('LecteurPrudent');
    const blockedAuthor = await register('CompteBloque');
    const privateAuthor = await register('ComptePrive');
    const hiddenAuthor = await register('AuteurMasque');
    const visibleAuthor = await register('PublicationEcartee');
    const flaggedAuthor = await register('AuteurSignale');

    const blocked = await publish(blockedAuthor).expect(201);
    await request(app.getHttpServer())
      .post(`/users/${blockedAuthor.id}/block`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(201);

    await db.update(users).set({ privateAccount: true }).where(eq(users.id, privateAuthor.id));
    const privatePost = await publish(privateAuthor).expect(201);

    const hidden = await publish(hiddenAuthor).expect(201);
    await request(app.getHttpServer())
      .post('/feedback')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ targetType: 'author', targetId: hiddenAuthor.id })
      .expect(201);

    const dismissed = await publish(visibleAuthor).expect(201);
    await request(app.getHttpServer())
      .post('/feedback')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ targetType: 'publication', targetId: dismissed.body.id })
      .expect(201);

    const flagged = await publish(flaggedAuthor).expect(201);
    await db
      .update(publications)
      .set({ moderationStatus: 'flagged', hotScore: 1_500_000 })
      .where(eq(publications.id, flagged.body.id));
    for (const id of [blocked.body.id, privatePost.body.id, hidden.body.id, dismissed.body.id]) {
      await db.update(publications).set({ hotScore: 1_500_000 }).where(eq(publications.id, id));
    }

    const response = await discover(viewer).expect(200);
    const allSectionIds = [
      ...ids(response.body.sections.nearbyFriends),
      ...ids(response.body.sections.popular),
      ...ids(response.body.sections.successful),
    ];
    expect(allSectionIds).not.toContain(blocked.body.id);
    expect(allSectionIds).not.toContain(privatePost.body.id);
    expect(allSectionIds).not.toContain(hidden.body.id);
    expect(allSectionIds).not.toContain(dismissed.body.id);
    expect(allSectionIds).not.toContain(flagged.body.id);
  });

  it('exige un jeton valide', async () => {
    await request(app.getHttpServer()).get('/discover').expect(401);
  });
});
