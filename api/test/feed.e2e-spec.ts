import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { publications, users } from '../src/db/schema.js';
import { RankingService } from '../src/ranking/ranking.service.js';

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

  const reposts = (actor: { token: string }, userId: string, query: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .get(`/feed/reposts/${userId}`)
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

  it('masque les publications d’un compte privé à un non-abonné', async () => {
    const author = await register('Prive');
    const viewer = await register('Inconnu');
    const city = `Prive-${suffix}`;
    await Promise.all([setCity(author.id, city), setCity(viewer.id, city)]);
    const post = await publish(author);

    // Même une publication `public` ne sort pas d'un compte privé : le profil
    // est fermé, le contenu doit l'être aussi (canViewProfile l'exige).
    await db.update(users).set({ privateAccount: true }).where(eq(users.id, author.id));
    const hidden = ids((await feed(viewer, { tab: 'local' }).expect(200)).body);
    expect(hidden).not.toContain(post.id);
    // Le détail doit être fermé aussi : le fil masquait mais l'URL directe
    // répondait encore avant cette règle.
    await request(app.getHttpServer())
      .get(`/publications/${post.id}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(404);

    // Un compte privé transforme l'abonnement en demande : tant qu'elle n'est
    // pas acceptée, rien ne change.
    const request1 = await request(app.getHttpServer())
      .post(`/users/${author.id}/follow`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(201);
    expect(request1.body.status).toBe('pending');
    expect(ids((await feed(viewer, { tab: 'local' }).expect(200)).body)).not.toContain(post.id);

    // Une fois la demande acceptée, la publication apparaît dans le fil.
    await request(app.getHttpServer())
      .post(`/users/me/follow-requests/${viewer.id}/accept`)
      .set('Authorization', `Bearer ${author.token}`)
      .expect(201);
    const visible = ids((await feed(viewer, { tab: 'local' }).expect(200)).body);
    expect(visible).toContain(post.id);
  });

  it('filtre le fil par format pour un pager plein écran', async () => {
    const author = await register('Formats');
    const viewer = await register('LecteurFormat');
    const city = `Format-${suffix}`;
    await Promise.all([setCity(author.id, city), setCity(viewer.id, city)]);
    const textPost = await publish(author);
    const other = await publish(author);

    await request(app.getHttpServer())
      .get('/feed')
      .query({ tab: 'local', format: 'video' })
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(200)
      .expect((response) => {
        expect(ids(response.body)).not.toContain(textPost.id);
        expect(ids(response.body)).not.toContain(other.id);
      });

    const texts = await feed(viewer, { tab: 'local', format: 'text' }).expect(200);
    expect(ids(texts.body)).toEqual(expect.arrayContaining([textPost.id, other.id]));
    await feed(viewer, { tab: 'local', format: 'gif' }).expect(400);
  });

  it('enregistre une vue unique et un temps de visionnage croissant', async () => {
    const author = await register('Compteur');
    const viewer = await register('Spectateur');
    const second = await register('Spectatrice');
    const city = `Vues-${suffix}`;
    await Promise.all([
      setCity(author.id, city),
      setCity(viewer.id, city),
      setCity(second.id, city),
    ]);
    const post = await publish(author);

    const view = (actor: { token: string }, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`/publications/${post.id}/view`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send(body);

    const first = await view(viewer, { watchedMs: 1200 }).expect(201);
    expect(first.body).toMatchObject({ viewCount: 1, watchMs: 1200, completed: false, firstView: true });

    // Rejouer ne crée pas de vue supplémentaire, et le temps ne redescend pas.
    const replay = await view(viewer, { watchedMs: 800 }).expect(201);
    expect(replay.body).toMatchObject({ viewCount: 1, watchMs: 1200, firstView: false });

    const longer = await view(viewer, { watchedMs: 5000, completed: true }).expect(201);
    expect(longer.body).toMatchObject({ viewCount: 1, watchMs: 5000, completed: true });

    const other = await view(second, { watchedMs: 900 }).expect(201);
    expect(other.body.viewCount).toBe(2);

    // Le compteur du fil suit les vues uniques.
    const page = (await feed(viewer, { tab: 'local' }).expect(200)).body;
    const item = page.items.find((entry: { id: string }) => entry.id === post.id);
    expect(item.counters.views).toBe(2);

    await view(viewer, { watchedMs: -10 }).expect(400);
    await view(viewer, { watchedMs: 'beaucoup' }).expect(400);
  });

  it('recalcule périodiquement le score sans interaction', async () => {
    const ranking = app.get(RankingService);
    const author = await register('Ranking');
    const post = await publish(author);
    // Score effacé : c'est l'état d'une publication dont la fraîcheur n'a jamais
    // été réévaluée (le cas que le worker doit corriger).
    await setHotScore(post.id, 0);

    await ranking.recomputeHotScores();
    const [row] = await db
      .select({ hotScore: publications.hotScore })
      .from(publications)
      .where(eq(publications.id, post.id));
    expect(row.hotScore).toBeGreaterThan(0);

    // Deuxième passe : le score de cette publication est stable. On ne compte
    // pas les lignes réécrites : la base est partagée par toutes les suites, et
    // le score d'un autre post peut franchir le seuil de dérive entre les deux
    // passes (test instable en CI).
    await ranking.recomputeHotScores();
    const [again] = await db
      .select({ hotScore: publications.hotScore })
      .from(publications)
      .where(eq(publications.id, post.id));
    expect(again.hotScore).toBe(row.hotScore);
  });

  it('garde l’ordre d’une session stable malgré une interaction', async () => {
    const author = await register('Session');
    const viewer = await register('Swipe');
    const city = `Session-${suffix}`;
    await Promise.all([setCity(author.id, city), setCity(viewer.id, city)]);

    const posts = [];
    for (let index = 0; index < 5; index += 1) {
      posts.push(await publish(author));
    }
    for (let index = 0; index < posts.length; index += 1) {
      await setHotScore(posts[index].id, 500 - index * 100);
    }

    const page1 = await feed(viewer, { tab: 'local', limit: 2 }).expect(200);
    const firstPage = ids(page1.body);
    expect(firstPage).toHaveLength(2);
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    // Une interaction arrive entre deux pages : sans session figée, le score
    // bouge et la page 2 sauterait ou répéterait des lignes.
    await request(app.getHttpServer())
      .post(`/publications/${posts[4].id}/like`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(201);

    const page2 = await feed(viewer, {
      tab: 'local',
      limit: 3,
      cursor: page1.body.nextCursor,
    }).expect(200);
    const secondPage = ids(page2.body);
    expect(secondPage).toHaveLength(3);
    for (const id of secondPage) {
      expect(firstPage).not.toContain(id);
    }
    // Aucune publication perdue : les 5 sont couvertes par les deux pages.
    expect(new Set([...firstPage, ...secondPage]).size).toBe(5);
  });

  it('ne resert pas un contenu déjà vu dans « Pour toi », mais le garde en local', async () => {
    const author = await register('Vu');
    const viewer = await register('Revoir');
    const city = `Vues-${suffix}-pourtou`;
    await Promise.all([setCity(author.id, city), setCity(viewer.id, city)]);
    const post = await publish(author);
    // Score élevé : la publication entre à coup sûr dans les 200 candidates.
    await setHotScore(post.id, 2_000_000_000);

    expect(ids((await feed(viewer, { tab: 'for-you' }).expect(200)).body)).toContain(post.id);

    await request(app.getHttpServer())
      .post(`/publications/${post.id}/view`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ watchedMs: 1500 })
      .expect(201);

    // « Pour toi » avance : le contenu vu récemment est écarté.
    expect(ids((await feed(viewer, { tab: 'for-you' }).expect(200)).body)).not.toContain(post.id);
    // Local reste un fil de proximité : le contenu y demeure.
    expect(ids((await feed(viewer, { tab: 'local' }).expect(200)).body)).toContain(post.id);
  });

  it('applique « pas intéressé » et le masquage d’un auteur', async () => {
    const author = await register('Ecartee');
    const viewer = await register('Selectif');
    const city = `Feedback-${suffix}`;
    await Promise.all([setCity(author.id, city), setCity(viewer.id, city)]);
    const first = await publish(author);
    const second = await publish(author);
    await setHotScore(first.id, 900);
    await setHotScore(second.id, 800);

    // Publication écartée : elle disparaît du fil.
    await request(app.getHttpServer())
      .post('/feedback')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ targetType: 'publication', targetId: first.id })
      .expect(201);
    const afterHide = ids((await feed(viewer, { tab: 'local' }).expect(200)).body);
    expect(afterHide).not.toContain(first.id);
    expect(afterHide).toContain(second.id);

    // Retrait : elle revient.
    await request(app.getHttpServer())
      .delete(`/feedback/publication/${first.id}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(200);
    expect(ids((await feed(viewer, { tab: 'local' }).expect(200)).body)).toContain(first.id);

    // Auteur masqué : plus rien de lui, même ses autres publications.
    await request(app.getHttpServer())
      .post('/feedback')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ targetType: 'author', targetId: author.id })
      .expect(201);
    const afterMute = ids((await feed(viewer, { tab: 'local' }).expect(200)).body);
    expect(afterMute).not.toContain(first.id);
    expect(afterMute).not.toContain(second.id);

    // Se masquer soi-même est refusé.
    await request(app.getHttpServer())
      .post('/feedback')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ targetType: 'author', targetId: viewer.id })
      .expect(400);
  });

  it('trie les abonnements par date, pas par score', async () => {
    const author = await register('Chrono');
    const viewer = await register('Fidele');
    const older = await publish(author);
    const newer = await publish(author);
    await setHotScore(older.id, 900_000);
    await setHotScore(newer.id, 10);
    await request(app.getHttpServer())
      .post(`/users/${author.id}/follow`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(201);

    const following = ids((await feed(viewer, { tab: 'following' }).expect(200)).body);
    const newerIndex = following.indexOf(newer.id);
    const olderIndex = following.indexOf(older.id);
    expect(newerIndex).toBeGreaterThanOrEqual(0);
    expect(olderIndex).toBeGreaterThanOrEqual(0);
    expect(newerIndex).toBeLessThan(olderIndex);
  });

  it('mélange les republications des comptes suivis avec attribution', async () => {
    const author = await register('Originale');
    const relaye = await register('Relayeuse');
    const viewer = await register('Filtre');
    const post = await publish(author);

    // Le visiteur suit le relayeur, pas l'auteur : la publication n'entre
    // dans son fil « Abonnements » que par la republication.
    await request(app.getHttpServer())
      .post(`/users/${relaye.id}/follow`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/publications/${post.id}/repost`)
      .set('Authorization', `Bearer ${relaye.token}`)
      .expect(201);

    const page = (await feed(viewer, { tab: 'following' }).expect(200)).body;
    const item = page.items.find((entry: { id: string }) => entry.id === post.id);
    expect(item).toBeDefined();
    expect(item.repostedBy?.id).toBe(relaye.id);
    expect(item.repostedBy?.displayName).toBe(relaye.displayName);

    // Dès que le visiteur suit aussi l'auteur, la publication arrive par
    // lui : le badge « a republié » disparaît.
    await request(app.getHttpServer())
      .post(`/users/${author.id}/follow`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(201);
    const after = (await feed(viewer, { tab: 'following' }).expect(200)).body;
    const direct = after.items.find((entry: { id: string }) => entry.id === post.id);
    expect(direct).toBeDefined();
    expect(direct.repostedBy ?? null).toBeNull();
  });

  it('liste les republications d’un profil avec curseur et confidentialité', async () => {
    const author = await register('Source');
    const relaye = await register('ProfilRepost');
    const viewer = await register('Collectionneuse');
    const first = await publish(author);
    const second = await publish(author);

    for (const post of [first, second]) {
      await request(app.getHttpServer())
        .post(`/publications/${post.id}/repost`)
        .set('Authorization', `Bearer ${relaye.token}`)
        .expect(201);
    }

    const page1 = await reposts(viewer, relaye.id, { limit: 1 }).expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.items[0].repostedBy?.id).toBe(relaye.id);
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    const page2 = await reposts(viewer, relaye.id, {
      limit: 1,
      cursor: page1.body.nextCursor,
    }).expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);

    // Profil privé : fermé à un étranger, ouvert à soi-même.
    await db.update(users).set({ privateAccount: true }).where(eq(users.id, relaye.id));
    await reposts(viewer, relaye.id).expect(403);
    const own = await reposts(relaye, relaye.id).expect(200);
    expect(own.body.items.length).toBeGreaterThanOrEqual(2);
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

  describe('« Aimé par » dans le fil', () => {
    const follow = (follower: { token: string }, targetId: string) =>
      request(app.getHttpServer())
        .post(`/users/${targetId}/follow`)
        .set('Authorization', `Bearer ${follower.token}`)
        .expect(201);
    const like = (actor: { token: string }, publicationId: string) =>
      request(app.getHttpServer())
        .post(`/publications/${publicationId}/like`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ kind: 'like' })
        .expect(201);
    const itemOf = async (viewer: { token: string }, publicationId: string) =>
      (await feed(viewer, { tab: 'following' }).expect(200)).body.items.find(
        (item: { id: string }) => item.id === publicationId,
      );

    it('montre le compte suivi qui a aimé, jamais un inconnu ni soi-même', async () => {
      const author = await register('Aimee');
      const friend = await register('Amie');
      const stranger = await register('Passante');
      const viewer = await register('Lectrice');
      const post = await publish(author);
      await follow(viewer, author.id);
      await follow(viewer, friend.id);

      // Seuls un inconnu et le visiteur ont aimé : pas d'attribution.
      await like(stranger, post.id);
      await like(viewer, post.id);
      let item = await itemOf(viewer, post.id);
      expect(item.counters.likes).toBe(2);
      expect(item.likedBy).toBeNull();

      // Un compte suivi aime : il est cité, sans données privées.
      await like(friend, post.id);
      item = await itemOf(viewer, post.id);
      expect(item.counters.likes).toBe(3);
      expect(item.likedBy).toEqual({
        id: friend.id,
        username: friend.username,
        displayName: friend.displayName,
        avatarUrl: null,
        verified: false,
      });
      expect(JSON.stringify(item.likedBy)).not.toContain('@e2e.dev');
    });

    it('n’affiche pas un compte bloqué', async () => {
      const author = await register('Bloquante');
      const friend = await register('Bloquee');
      const viewer = await register('Prudente');
      const post = await publish(author);
      await follow(viewer, author.id);
      await follow(viewer, friend.id);
      await like(friend, post.id);
      expect((await itemOf(viewer, post.id)).likedBy?.id).toBe(friend.id);

      await request(app.getHttpServer())
        .post(`/users/${friend.id}/block`)
        .set('Authorization', `Bearer ${viewer.token}`)
        .expect(201);
      expect((await itemOf(viewer, post.id)).likedBy).toBeNull();
    });
  });
});
