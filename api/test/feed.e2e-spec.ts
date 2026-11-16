import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { publications, users } from '../src/db/schema.js';

/**
 * Feed de base sur vraie base : autorisation SQL (visibilité, abonnements,
 * blocages, modération), onglets et pagination par curseur stable.
 */
describe('Feed (e2e)', () => {
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
        lastName: 'Feed',
        email: `${firstName.toLowerCase()}_feed_${suffix}_${counter}@e2e.dev`,
        password: 'password123',
        birthday: '1995-06-15',
        gender: 'FEMALE',
      })
      .expect(201);
    return { ...response.body.user, token: response.body.accessToken as string };
  };

  const publish = async (
    actor: { token: string },
    overrides: Partial<{ caption: string; visibility: string }> = {},
  ) => {
    const response = await request(app.getHttpServer())
      .post('/publications')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({
        caption: 'Post de feed',
        clientId: `feed-${suffix}-${Math.random().toString(36).slice(2)}`,
        ...overrides,
      })
      .expect(201);
    return response.body;
  };

  const feed = (actor: { token: string }, query: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .get('/feed')
      .query(query)
      .set('Authorization', `Bearer ${actor.token}`);

  const ids = (body: { items: Array<{ id: string }> }) => body.items.map((item) => item.id);

  const setCity = (userId: string, city: string | null) =>
    db.update(users).set({ city }).where(eq(users.id, userId));

  const setHotScore = (publicationId: string, hotScore: number) =>
    db.update(publications).set({ hotScore }).where(eq(publications.id, publicationId));

  it('n’expose publiquement que ce qui est public, plus son propre contenu', async () => {
    const alice = await register('Autrice');
    const viewer = await register('Visiteur');
    // Ville dédiée : la base de test accumule les posts des autres exécutions.
    const city = `Visibilite-${suffix}`;
    await Promise.all([setCity(alice.id, city), setCity(viewer.id, city)]);

    const publicPost = await publish(alice);
    const followersPost = await publish(alice, { visibility: 'followers' });
    const privatePost = await publish(alice, { visibility: 'private' });

    const seen = ids((await feed(viewer, { tab: 'local' }).expect(200)).body);
    expect(seen).toContain(publicPost.id);
    expect(seen).not.toContain(followersPost.id);
    expect(seen).not.toContain(privatePost.id);

    // L'auteur voit ses trois publications dans son propre fil.
    const own = ids((await feed(alice, { tab: 'local' }).expect(200)).body);
    expect(own).toEqual(expect.arrayContaining([publicPost.id, followersPost.id, privatePost.id]));
  });

  it('ouvre les publications « followers » à l’abonné accepté', async () => {
    const alice = await register('Confidentielle');
    const fan = await register('Fan');
    const city = `Followers-${suffix}`;
    await Promise.all([setCity(alice.id, city), setCity(fan.id, city)]);
    const post = await publish(alice, { visibility: 'followers' });

    await request(app.getHttpServer())
      .post(`/users/${alice.id}/follow`)
      .set('Authorization', `Bearer ${fan.token}`)
      .expect(201);

    const seen = ids((await feed(fan, { tab: 'local' }).expect(200)).body);
    expect(seen).toContain(post.id);
    const item = (await feed(fan, { tab: 'local' }).expect(200)).body.items.find(
      (entry: { id: string }) => entry.id === post.id,
    );
    expect(item.viewer.followingAuthor).toBe(true);
  });

  it('masque les blocages, la modération et les suppressions logiques', async () => {
    const alice = await register('Masquee');
    const viewer = await register('Observateur');
    const bob = await register('Modere');
    const city = `Moderation-${suffix}`;
    await Promise.all([
      setCity(alice.id, city),
      setCity(bob.id, city),
      setCity(viewer.id, city),
    ]);

    const blocked = await publish(alice);

    await request(app.getHttpServer())
      .post(`/users/${alice.id}/block`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(201);

    // Les autres cas sont vérifiés sur un compte non bloqué.
    const visible = await publish(bob);
    const flagged = await publish(bob);
    const removed = await publish(bob);
    const deleted = await publish(bob);
    await db
      .update(publications)
      .set({ moderationStatus: 'flagged' })
      .where(eq(publications.id, flagged.id));
    await db
      .update(publications)
      .set({ moderationStatus: 'removed' })
      .where(eq(publications.id, removed.id));
    await request(app.getHttpServer())
      .delete(`/publications/${deleted.id}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);

    const seen = ids((await feed(viewer, { tab: 'local' }).expect(200)).body);
    expect(seen).not.toContain(blocked.id);
    expect(seen).toContain(visible.id);
    expect(seen).not.toContain(flagged.id);
    expect(seen).not.toContain(removed.id);
    expect(seen).not.toContain(deleted.id);
  });

  it('limite l’onglet Abonnements aux comptes suivis acceptés', async () => {
    const followed = await register('Suivie');
    const stranger = await register('Inconnue');
    const viewer = await register('Abonne');

    const seenPost = await publish(followed);
    const hiddenPost = await publish(stranger);
    await request(app.getHttpServer())
      .post(`/users/${followed.id}/follow`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(201);

    const following = ids((await feed(viewer, { tab: 'following' }).expect(200)).body);
    expect(following).toContain(seenPost.id);
    expect(following).not.toContain(hiddenPost.id);
  });

  it('filtre l’onglet Local sur la ville du visiteur', async () => {
    const neighbour = await register('Voisine');
    const elsewhere = await register('Lointaine');
    const viewer = await register('Locale');
    const city = `Ville-${suffix}`;
    await Promise.all([setCity(neighbour.id, city), setCity(elsewhere.id, 'Ailleurs')]);

    const nearbyPost = await publish(neighbour);
    const farPost = await publish(elsewhere);

    await setCity(viewer.id, city);
    const local = ids((await feed(viewer, { tab: 'local' }).expect(200)).body);
    expect(local).toContain(nearbyPost.id);
    expect(local).not.toContain(farPost.id);

    // Sans ville connue, l'onglet Local répond vide au lieu de tout montrer.
    await setCity(viewer.id, null);
    const empty = await feed(viewer, { tab: 'local' }).expect(200);
    expect(empty.body).toEqual({ items: [], nextCursor: null });
  });

  it('pagine par curseur sans doublon ni saut', async () => {
    const author = await register('Pagineur');
    const viewer = await register('Lecteur');
    const city = `Pagination-${suffix}`;
    await setCity(author.id, city);
    await setCity(viewer.id, city);

    const first = await publish(author);
    const second = await publish(author);
    const third = await publish(author);
    await setHotScore(first.id, 100);
    await setHotScore(second.id, 300);
    await setHotScore(third.id, 200);

    const page1 = await feed(viewer, { tab: 'local', limit: 2 }).expect(200);
    expect(ids(page1.body)).toEqual([second.id, third.id]);
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    const page2 = await feed(viewer, {
      tab: 'local',
      limit: 2,
      cursor: page1.body.nextCursor,
    }).expect(200);
    expect(ids(page2.body)).toEqual([first.id]);
    expect(page2.body.nextCursor).toBeNull();

    await feed(viewer, { tab: 'local', cursor: 'pas-un-curseur' }).expect(400);
  });

  it('expose la réaction du visiteur et fait monter le score d’un post liké', async () => {
    const author = await register('Aimee');
    const viewer = await register('Reactif');
    const city = `Score-${suffix}`;
    await setCity(author.id, city);
    await setCity(viewer.id, city);

    const liked = await publish(author);
    const untouched = await publish(author);
    await setHotScore(liked.id, 100);
    await setHotScore(untouched.id, 100);

    await request(app.getHttpServer())
      .post(`/publications/${liked.id}/like`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ kind: 'love' })
      .expect(201);

    const page = (await feed(viewer, { tab: 'local' }).expect(200)).body;
    const likedItem = page.items.find((item: { id: string }) => item.id === liked.id);
    const untouchedItem = page.items.find((item: { id: string }) => item.id === untouched.id);
    expect(likedItem.viewer.reaction).toBe('love');
    expect(untouchedItem.viewer.reaction).toBeNull();

    const [likedRow] = await db
      .select({ hotScore: publications.hotScore })
      .from(publications)
      .where(eq(publications.id, liked.id));
    const [untouchedRow] = await db
      .select({ hotScore: publications.hotScore })
      .from(publications)
      .where(eq(publications.id, untouched.id));
    expect(likedRow.hotScore).toBeGreaterThan(untouchedRow.hotScore);
    expect(ids(page).indexOf(liked.id)).toBeLessThan(ids(page).indexOf(untouched.id));
  });

  it('rejette un onglet inconnu et exige un jeton', async () => {
    const viewer = await register('Valideur');
    await feed(viewer, { tab: 'n-importe-quoi' }).expect(400);
    await request(app.getHttpServer()).get('/feed').expect(401);
  });

  it('ne renvoie aucune donnée personnelle dans les cartes d’auteur', async () => {
    const author = await register('Discret');
    const city = `Cartes-${suffix}`;
    await setCity(author.id, city);
    await publish(author);
    const body = (await feed(author, { tab: 'local' }).expect(200)).body;
    const item = body.items.find((entry: { author: { id: string } }) => entry.author.id === author.id);
    expect(item.author).toEqual({
      id: author.id,
      username: author.username,
      displayName: author.displayName,
      avatarUrl: null,
      verified: false,
    });
    expect(JSON.stringify(body)).not.toContain('@e2e.dev');
  });

  it('préserve l’ordre du score matérialisé entre deux appels', async () => {
    const author = await register('Stable');
    const viewer = await register('Constante');
    const city = `Stable-${suffix}`;
    await setCity(author.id, city);
    await setCity(viewer.id, city);
    const post = await publish(author);
    await setHotScore(post.id, 42);

    const first = ids((await feed(viewer, { tab: 'local' }).expect(200)).body);
    // Une lecture plusieurs fois répétée ne doit pas dériver : le score est lu,
    // pas recalculé avec `now()`.
    const second = ids((await feed(viewer, { tab: 'local' }).expect(200)).body);
    expect(second).toEqual(first);
    expect(first).toEqual([post.id]);
    expect(
      (await db
        .select({ hotScore: publications.hotScore })
        .from(publications)
        .where(and(eq(publications.id, post.id))))[0].hotScore,
    ).toBe(42);
  });
});
