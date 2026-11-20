import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { comments, publications, userSocialSettings, users } from '../src/db/schema.js';

/**
 * Publications et interactions sur vraie base : idempotence des créations,
 * visibilité, compteurs transactionnels, permissions de commentaire.
 */
describe('Publications et interactions (e2e)', () => {
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
        lastName: 'Publie',
        email: `${firstName.toLowerCase()}_pub_${suffix}_${counter}@e2e.dev`,
        password: 'password123',
        birthday: '1995-06-15',
        gender: 'FEMALE',
      })
      .expect(201);
    return { ...response.body.user, token: response.body.accessToken as string };
  };

  const publish = (
    actor: { token: string },
    overrides: Partial<{
      caption: string;
      visibility: string;
      kind: string;
      clientId: string;
      textBackground: string;
      textPages: string[];
      quotedPublicationId: string;
    }> = {},
  ) =>
    request(app.getHttpServer())
      .post('/publications')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({
        caption: 'Mon premier post',
        clientId: `client-${suffix}-${Math.random().toString(36).slice(2)}`,
        ...overrides,
      });

  const see = (actor: { token: string }, id: string) =>
    request(app.getHttpServer())
      .get(`/publications/${id}`)
      .set('Authorization', `Bearer ${actor.token}`);

  const counters = async (userId: string) => {
    const [row] = await db
      .select({
        publications: users.publicationCount,
        reels: users.reelCount,
        likesReceived: users.likeReceivedCount,
      })
      .from(users)
      .where(eq(users.id, userId));
    return row;
  };

  const publicationRow = async (id: string) => {
    const [row] = await db.select().from(publications).where(eq(publications.id, id));
    return row;
  };

  it('crée une publication texte et incrémente le compteur de l’auteur', async () => {
    const alice = await register('Autrice');

    const response = await publish(alice).expect(201);
    const body = response.body;

    expect(body.caption).toBe('Mon premier post');
    expect(body.kind).toBe('post');
    expect(body.format).toBe('text');
    expect(body.visibility).toBe('public');
    expect(body.author).toEqual({
      id: alice.id,
      username: alice.username,
      displayName: alice.displayName,
      avatarUrl: null,
      verified: false,
    });
    expect(body.counters).toEqual({
      likes: 0,
      comments: 0,
      reposts: 0,
      saves: 0,
      shares: 0,
      views: 0,
    });
    expect(body.viewer).toEqual({ reaction: null, saved: false, reposted: false });
    expect(await counters(alice.id)).toEqual({
      publications: 1,
      reels: 0,
      likesReceived: 0,
    });
  });

  it('persiste le fond et les pages d’un post texte', async () => {
    const alice = await register('Paginee');

    const response = await publish(alice, {
      caption: 'ignorée par le serveur',
      textBackground: 'ocean',
      textPages: ['Première page', 'Deuxième page'],
    }).expect(201);
    const body = response.body;

    // La première page devient la légende (recherche, extraits, citation).
    expect(body.caption).toBe('Première page');
    expect(body.textBackground).toBe('ocean');
    expect(body.pages).toEqual(['Première page', 'Deuxième page']);
    expect(body.format).toBe('text');

    // Une seule page reste une publication classique, sans `pages`.
    const single = await publish(alice, {
      caption: 'Seule page',
      textBackground: 'forest',
      textPages: ['Seule page'],
    }).expect(201);
    expect(single.body.caption).toBe('Seule page');
    expect(single.body.textBackground).toBe('forest');
    expect(single.body.pages).toBeNull();
  });

  it('rejette les pages sur une publication avec média ou citation', async () => {
    const alice = await register('Mediapages');
    const original = await publish(alice).expect(201);

    await publish(alice, {
      textPages: ['a', 'b'],
      quotedPublicationId: original.body.id,
    }).expect(400);
  });

  it('rejoue la création sans créer de doublon', async () => {
    const alice = await register('Rejouee');
    const clientId = `idem-${suffix}-unique`;

    const first = await publish(alice, { clientId }).expect(201);
    const replay = await publish(alice, { clientId }).expect(201);

    expect(replay.body.id).toBe(first.body.id);
    expect((await counters(alice.id)).publications).toBe(1);
  });

  it('compte un reel séparément des posts', async () => {
    const alice = await register('Reeleuse');
    await publish(alice, { kind: 'reel' }).expect(201);

    expect(await counters(alice.id)).toEqual({
      publications: 1,
      reels: 1,
      likesReceived: 0,
    });
  });

  it('respecte la visibilité followers et le blocage', async () => {
    const alice = await register('Privee');
    const follower = await register('Abo');
    const stranger = await register('Etranger');

    const post = await publish(alice, { visibility: 'followers' }).expect(201);
    await see(stranger, post.body.id).expect(404);

    await request(app.getHttpServer())
      .post(`/users/${alice.id}/follow`)
      .set('Authorization', `Bearer ${follower.token}`)
      .expect(201);
    await see(follower, post.body.id).expect(200);

    await request(app.getHttpServer())
      .post(`/users/${alice.id}/block`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(201);
    await see(stranger, post.body.id).expect(404);
  });

  it('enferme une publication private dans son compte', async () => {
    const alice = await register('Intime');
    const follower = await register('Indiscret');
    await request(app.getHttpServer())
      .post(`/users/${alice.id}/follow`)
      .set('Authorization', `Bearer ${follower.token}`)
      .expect(201);
    // Le compte devient privé mais l'abonnement est déjà accepté : autre test.
    const post = await publish(alice, { visibility: 'private' }).expect(201);

    await see(alice, post.body.id).expect(200);
    await see(follower, post.body.id).expect(404);
  });

  it('supprime logiquement et décrémente les compteurs', async () => {
    const alice = await register('Supprimeuse');
    const bob = await register('Temoin');
    const post = await publish(alice, { kind: 'reel' }).expect(201);

    await request(app.getHttpServer())
      .delete(`/publications/${post.body.id}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/publications/${post.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);

    expect(await counters(alice.id)).toEqual({ publications: 0, reels: 0, likesReceived: 0 });
    expect((await publicationRow(post.body.id)).deletedAt).toBeInstanceOf(Date);
    await see(bob, post.body.id).expect(404);

    // Rejouer la suppression ne repasse pas le compteur sous zéro.
    await request(app.getHttpServer())
      .delete(`/publications/${post.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect((await counters(alice.id)).publications).toBe(0);
  });

  it('réagit une fois, change de type, puis retire la réaction', async () => {
    const alice = await register('Reagie');
    const bob = await register('Reacteur');
    const post = await publish(alice).expect(201);

    const like = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/like`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ kind: 'like' })
      .expect(201);
    expect(like.body).toEqual({ reaction: 'like', likeCount: 1 });

    await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/like`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ kind: 'like' })
      .expect(201);

    const change = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/like`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ kind: 'love' })
      .expect(201);
    expect(change.body).toEqual({ reaction: 'love', likeCount: 1 });

    const seen = await see(bob, post.body.id).expect(200);
    expect(seen.body.viewer.reaction).toBe('love');
    expect((await counters(alice.id)).likesReceived).toBe(1);

    const removed = await request(app.getHttpServer())
      .delete(`/publications/${post.body.id}/like`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(removed.body).toEqual({ reaction: null, likeCount: 0 });
    expect((await counters(alice.id)).likesReceived).toBe(0);

    // Rejeu du retrait : aucun compteur négatif.
    const replay = await request(app.getHttpServer())
      .delete(`/publications/${post.body.id}/like`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(replay.body.likeCount).toBe(0);
  });


  it('enregistre puis retire un signet, sans fausser le compteur', async () => {
    const alice = await register('Signets');
    const bob = await register('Signeteur');
    const post = await publish(alice).expect(201);

    const saved = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/save`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(201);
    expect(saved.body).toEqual({ saved: true, saveCount: 1 });

    // Rejeu : idempotent, le compteur ne monte pas.
    await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/save`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(201);

    const seen = await see(bob, post.body.id).expect(200);
    expect(seen.body.viewer.saved).toBe(true);
    expect(seen.body.counters.saves).toBe(1);

    const removed = await request(app.getHttpServer())
      .delete(`/publications/${post.body.id}/save`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(removed.body).toEqual({ saved: false, saveCount: 0 });

    // Rejeu du retrait : jamais négatif.
    const replay = await request(app.getHttpServer())
      .delete(`/publications/${post.body.id}/save`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(replay.body.saveCount).toBe(0);
  });

  it('compte chaque partage sans idempotence', async () => {
    const alice = await register('Partagee');
    const bob = await register('Shareur');
    const post = await publish(alice).expect(201);

    const first = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/share`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(201);
    expect(first.body).toEqual({ shareCount: 1 });

    // Chaque action de partage est un événement : pas de déduplication.
    const second = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/share`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(201);
    expect(second.body).toEqual({ shareCount: 2 });

    const seen = await see(bob, post.body.id).expect(200);
    expect(seen.body.counters.shares).toBe(2);
  });

  it('refuse de partager une publication invisible', async () => {
    const alice = await register('PriveePartage');
    const bob = await register('Voisin');
    const post = await publish(alice, { visibility: 'private' }).expect(201);

    await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/share`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(404);
  });

  it('republie puis retire, sans double notification', async () => {
    const alice = await register('Repostee');
    const bob = await register('Reposteur');
    const post = await publish(alice).expect(201);

    const reposted = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/repost`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(201);
    expect(reposted.body).toEqual({ reposted: true, repostCount: 1 });

    // Rejeu : idempotent.
    await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/repost`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(201);

    const seen = await see(bob, post.body.id).expect(200);
    expect(seen.body.viewer.reposted).toBe(true);
    expect(seen.body.counters.reposts).toBe(1);

    const removed = await request(app.getHttpServer())
      .delete(`/publications/${post.body.id}/repost`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(removed.body).toEqual({ reposted: false, repostCount: 0 });

    const replay = await request(app.getHttpServer())
      .delete(`/publications/${post.body.id}/repost`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(replay.body.repostCount).toBe(0);
  });

  it('interdit de republier sa propre publication', async () => {
    const alice = await register('Auto');
    const post = await publish(alice).expect(201);

    await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/repost`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(400);
  });

  it('refuse le signet et le repost sur une publication invisible', async () => {
    const alice = await register('Privee');
    const stranger = await register('Etranger');
    const post = await publish(alice, { visibility: 'private' }).expect(201);

    await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/save`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/repost`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
  });

  it('refuse la réaction sur une publication invisible', async () => {
    const alice = await register('Cachee');
    const stranger = await register('Voyeur');
    const post = await publish(alice, { visibility: 'private' }).expect(201);

    await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/like`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({})
      .expect(404);
  });

  it('commente, répond et supprime sans fausser les compteurs', async () => {
    const alice = await register('Commentee');
    const bob = await register('Commentateur');
    const carol = await register('Intruse');
    const post = await publish(alice).expect(201);

    const root = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ body: 'Super post', clientId: `c-${suffix}-1` })
      .expect(201);
    expect(root.body.author.id).toBe(bob.id);
    expect(root.body.parentId).toBeNull();

    // Rejeu : même commentaire, compteur inchangé.
    const replay = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ body: 'Super post', clientId: `c-${suffix}-1` })
      .expect(201);
    expect(replay.body.id).toBe(root.body.id);
    expect((await publicationRow(post.body.id)).commentCount).toBe(1);

    const reply = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ body: 'Merci !', parentId: root.body.id, clientId: `c-${suffix}-2` })
      .expect(201);
    expect(reply.body.parentId).toBe(root.body.id);
    expect((await publicationRow(post.body.id)).commentCount).toBe(2);
    const [rootRow] = await db.select().from(comments).where(eq(comments.id, root.body.id));
    expect(rootRow.replyCount).toBe(1);

    const list = await request(app.getHttpServer())
      .get(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${carol.token}`)
      .expect(200);
    expect(list.body.items.map((item: { body: string }) => item.body)).toEqual([
      'Super post',
      'Merci !',
    ]);
    expect(JSON.stringify(list.body)).not.toContain('@e2e.dev');

    // Un tiers ne peut pas supprimer.
    await request(app.getHttpServer())
      .delete(`/comments/${reply.body.id}`)
      .set('Authorization', `Bearer ${carol.token}`)
      .expect(403);

    // L'auteur de la publication peut modérer la suppression.
    await request(app.getHttpServer())
      .delete(`/comments/${reply.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect((await publicationRow(post.body.id)).commentCount).toBe(1);
    const [rootAfter] = await db.select().from(comments).where(eq(comments.id, root.body.id));
    expect(rootAfter.replyCount).toBe(0);

    // Rejouer la suppression ne décrémente pas deux fois.
    await request(app.getHttpServer())
      .delete(`/comments/${reply.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect((await publicationRow(post.body.id)).commentCount).toBe(1);
  });

  it('bloque les commentaires quand la permission est « nobody », pas les réactions', async () => {
    const alice = await register('Reservee');
    const bob = await register('Persistant');
    await db.insert(userSocialSettings).values({ userId: alice.id, commentPermission: 'nobody' });
    const post = await publish(alice).expect(201);

    await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ body: 'Toujours là', clientId: `c-${suffix}-nobody` })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/like`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({})
      .expect(201);
  });

  it('valide les entrées : légende vide, clientId absent, commentaire vide', async () => {
    const alice = await register('Valideuse');

    await publish(alice, { caption: '   ' }).expect(400);
    await request(app.getHttpServer())
      .post('/publications')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ caption: 'Sans clé' })
      .expect(400);

    const post = await publish(alice).expect(201);
    await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ body: '  ', clientId: `c-${suffix}-vide` })
      .expect(400);
  });

  it('pagine les commentaires sans doublon', async () => {
    const alice = await register('Bavarde');
    const bob = await register('Pagineur');
    const post = await publish(alice).expect(201);
    for (let index = 0; index < 3; index += 1) {
      await request(app.getHttpServer())
        .post(`/publications/${post.body.id}/comments`)
        .set('Authorization', `Bearer ${bob.token}`)
        .send({ body: `Commentaire ${index}`, clientId: `c-${suffix}-page-${index}` })
        .expect(201);
    }

    const page1 = await request(app.getHttpServer())
      .get(`/publications/${post.body.id}/comments`)
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    const page2 = await request(app.getHttpServer())
      .get(`/publications/${post.body.id}/comments`)
      .query({ limit: 2, cursor: page1.body.nextCursor })
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();

    const ids = [
      ...page1.body.items.map((item: { id: string }) => item.id),
      ...page2.body.items.map((item: { id: string }) => item.id),
    ];
    expect(new Set(ids).size).toBe(3);
  });

  it('refuse une réponse à un commentaire d’une autre publication', async () => {
    const alice = await register('Cloison');
    const first = await publish(alice).expect(201);
    const second = await publish(alice).expect(201);

    const created = await request(app.getHttpServer())
      .post(`/publications/${first.body.id}/comments`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ body: 'Sur la première', clientId: `c-${suffix}-first` })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/publications/${second.body.id}/comments`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({
        body: 'Mauvaise cible',
        parentId: created.body.id,
        clientId: `c-${suffix}-bad-parent`,
      })
      .expect(404);

    // Le refus n'a laissé aucune trace sur la seconde publication.
    expect((await publicationRow(second.body.id)).commentCount).toBe(0);
  });

  it('épingle un commentaire racine, réservé à l’auteur de la publication', async () => {
    const alice = await register('Epingleuse');
    const bob = await register('Epinglant');
    const carol = await register('TemoinPin');
    const post = await publish(alice).expect(201);

    const first = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ body: 'Premier', clientId: `c-${suffix}-pin-1` })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${carol.token}`)
      .send({ body: 'À épingler', clientId: `c-${suffix}-pin-2` })
      .expect(201);
    const reply = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ body: 'Réponse', parentId: first.body.id, clientId: `c-${suffix}-pin-3` })
      .expect(201);

    // Un tiers ne peut pas épingler, pas plus qu'une réponse.
    await request(app.getHttpServer())
      .post(`/comments/${second.body.id}/pin`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/comments/${reply.body.id}/pin`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(400);

    const pinned = await request(app.getHttpServer())
      .post(`/comments/${second.body.id}/pin`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(201);
    expect(pinned.body.pinned).toBe(true);

    const list = await request(app.getHttpServer())
      .get(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(list.body.pinned.map((item: { id: string }) => item.id)).toEqual([second.body.id]);
    expect(list.body.items.map((item: { id: string }) => item.id)).not.toContain(second.body.id);

    // Rejeu idempotent, puis désépinglage.
    await request(app.getHttpServer())
      .post(`/comments/${second.body.id}/pin`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(201);
    const unpinned = await request(app.getHttpServer())
      .delete(`/comments/${second.body.id}/pin`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect(unpinned.body.pinned).toBe(false);

    const after = await request(app.getHttpServer())
      .get(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(after.body.pinned).toHaveLength(0);
    expect(after.body.items.map((item: { id: string }) => item.id)).toContain(second.body.id);
  });

  it('réagit par emoji, change de kind et retire sa réaction', async () => {
    const alice = await register('Reactive');
    const bob = await register('Emojiste');
    const carol = await register('SecondEmoji');
    const post = await publish(alice).expect(201);
    const comment = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ body: 'Reacte-moi', clientId: `c-${suffix}-react-1` })
      .expect(201);

    const heart = await request(app.getHttpServer())
      .post(`/comments/${comment.body.id}/react`)
      .set('Authorization', `Bearer ${carol.token}`)
      .send({ kind: 'heart' })
      .expect(201);
    expect(heart.body.viewerReaction).toBe('heart');
    expect(heart.body.reactions).toEqual([{ kind: 'heart', count: 1 }]);

    // Changer de kind déplace le vote, une seule réaction par compte.
    const laugh = await request(app.getHttpServer())
      .post(`/comments/${comment.body.id}/react`)
      .set('Authorization', `Bearer ${carol.token}`)
      .send({ kind: 'laugh' })
      .expect(201);
    expect(laugh.body.viewerReaction).toBe('laugh');
    expect(laugh.body.reactions).toEqual([{ kind: 'laugh', count: 1 }]);

    // Un second compte cumule les compteurs.
    await request(app.getHttpServer())
      .post(`/comments/${comment.body.id}/react`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ kind: 'laugh' })
      .expect(201);
    const seen = await request(app.getHttpServer())
      .get(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    const row = seen.body.items.find((item: { id: string }) => item.id === comment.body.id);
    expect(row.reactions).toEqual([{ kind: 'laugh', count: 2 }]);
    expect(row.viewerReaction).toBeNull();

    const removed = await request(app.getHttpServer())
      .delete(`/comments/${comment.body.id}/react`)
      .set('Authorization', `Bearer ${carol.token}`)
      .expect(200);
    expect(removed.body.viewerReaction).toBeNull();

    await request(app.getHttpServer())
      .post(`/comments/${comment.body.id}/react`)
      .set('Authorization', `Bearer ${carol.token}`)
      .send({ kind: 'inconnu' })
      .expect(400);
  });

  it('trie les commentaires par pertinence ou par date récente', async () => {
    const alice = await register('Triage');
    const bob = await register('LikeurTri');
    const post = await publish(alice).expect(201);

    const older = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ body: 'Ancien mais aimé', clientId: `c-${suffix}-sort-1` })
      .expect(201);
    const newer = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ body: 'Récent sans like', clientId: `c-${suffix}-sort-2` })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/comments/${older.body.id}/like`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(201);

    const top = await request(app.getHttpServer())
      .get(`/publications/${post.body.id}/comments`)
      .query({ sort: 'top' })
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(top.body.items.map((item: { id: string }) => item.id)).toEqual([
      older.body.id,
      newer.body.id,
    ]);

    const recent = await request(app.getHttpServer())
      .get(`/publications/${post.body.id}/comments`)
      .query({ sort: 'recent' })
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(recent.body.items.map((item: { id: string }) => item.id)).toEqual([
      newer.body.id,
      older.body.id,
    ]);

    // Un curseur d'un tri ne se réutilise pas dans l'autre.
    const mixed = await request(app.getHttpServer())
      .get(`/publications/${post.body.id}/comments`)
      .query({ sort: 'recent', limit: 1 })
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(mixed.body.nextCursor).toEqual(expect.any(String));
    await request(app.getHttpServer())
      .get(`/publications/${post.body.id}/comments`)
      .query({ sort: 'top', cursor: mixed.body.nextCursor })
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(400);
  });

  it('pagine les réponses d’un fil dans l’ordre chronologique', async () => {
    const alice = await register('FilMere');
    const bob = await register('FilRepondeur');
    const post = await publish(alice).expect(201);

    const root = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ body: 'Fil principal', clientId: `c-${suffix}-thread-1` })
      .expect(201);
    const other = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ body: 'Autre fil', clientId: `c-${suffix}-thread-2` })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ body: 'Réponse à lautre', parentId: other.body.id, clientId: `c-${suffix}-thread-3` })
      .expect(201);
    const first = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ body: 'Réponse 1', parentId: root.body.id, clientId: `c-${suffix}-thread-4` })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/publications/${post.body.id}/comments`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ body: 'Réponse 2', parentId: root.body.id, clientId: `c-${suffix}-thread-5` })
      .expect(201);

    const replies = await request(app.getHttpServer())
      .get(`/comments/${root.body.id}/replies`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(replies.body.items.map((item: { id: string }) => item.id)).toEqual([
      first.body.id,
      second.body.id,
    ]);
    expect(replies.body.pinned).toEqual([]);

    await request(app.getHttpServer())
      .get(`/comments/${other.body.id}/replies`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/comments/inexistant/replies`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(404);
  });
});
