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
      textPageStyles: ({
        background?: string;
        color?: string;
        font?: string;
        align?: string;
        size?: number;
      } | null)[];
      textFont: string;
      textAlign: string;
      textColor: string;
      textTitle: string;
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

  it('persiste un style indépendant par page de carrousel texte', async () => {
    const alice = await register('Cartouche');

    const response = await publish(alice, {
      textPages: ['Page une', 'Page deux', 'Page trois'],
      textPageStyles: [
        { background: 'ocean', color: 'white', font: 'elegant', align: 'center', size: 40 },
        {},
        { color: 'mint', font: 'typewriter', align: 'right', size: 20 },
      ],
    }).expect(201);
    const body = response.body;

    expect(body.pages).toEqual(['Page une', 'Page deux', 'Page trois']);
    // Le style reste appairé à son index, `null` = rendu par défaut.
    expect(body.pageStyles).toEqual([
      { background: 'ocean', color: 'white', font: 'elegant', align: 'center', size: 40 },
      null,
      { color: 'mint', font: 'typewriter', align: 'right', size: 20 },
    ]);

    // Le détail expose les mêmes styles.
    const detail = await see(alice, body.id).expect(200);
    expect(detail.body.pageStyles).toEqual(body.pageStyles);

    // Clés inconnues refusées par le DTO.
    await publish(alice, {
      textPages: ['a', 'b'],
      textPageStyles: [{ background: 'chartreuse' }],
    }).expect(400);
    await publish(alice, {
      textPages: ['a', 'b'],
      textPageStyles: [{ color: 'chartreuse' }],
    }).expect(400);
    // Typographie invalide refusée aussi.
    await publish(alice, {
      textPages: ['a', 'b'],
      textPageStyles: [{ font: 'comic-sans' }],
    }).expect(400);
    await publish(alice, {
      textPages: ['a', 'b'],
      textPageStyles: [{ align: 'block' }],
    }).expect(400);
    await publish(alice, {
      textPages: ['a', 'b'],
      textPageStyles: [{ size: 500 }],
    }).expect(400);
  });

  it('réaligne les styles de page à l’édition', async () => {
    const alice = await register('Retoucheuse');
    const created = await publish(alice, {
      textPages: ['Page un', 'Page deux', 'Page trois'],
      textPageStyles: [{ background: 'rose' }, {}, { color: 'gold' }],
    }).expect(201);
    const id = created.body.id;

    // Nouvelles pages + nouveaux styles : l'ancien style ne fuit pas.
    const updated = await request(app.getHttpServer())
      .patch(`/publications/${id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({
        textPages: ['Nouvelle un', 'Nouvelle deux'],
        textPageStyles: [{ background: 'mint' }, { color: 'black' }],
      })
      .expect(200);
    expect(updated.body.pageStyles).toEqual([
      { background: 'mint' },
      { color: 'black' },
    ]);

    // Styles seuls, sans toucher les pages : réalignés sur l'existant.
    const restyled = await request(app.getHttpServer())
      .patch(`/publications/${id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ textPageStyles: [{}, { background: 'teal' }] })
      .expect(200);
    expect(restyled.body.pageStyles).toEqual([null, { background: 'teal' }]);
    expect(restyled.body.pages).toEqual(['Nouvelle un', 'Nouvelle deux']);

    // Repasser à une page efface les styles devenus sans objet.
    const single = await request(app.getHttpServer())
      .patch(`/publications/${id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ textPages: ['Page unique'], textPageStyles: [{ background: 'red' }] })
      .expect(200);
    expect(single.body.pages).toBeNull();
    expect(single.body.pageStyles).toBeNull();
  });

  it('persiste police, alignement et couleur d’un post texte', async () => {
    const alice = await register('Stylee');

    const response = await publish(alice, {
      caption: 'Post stylé',
      textBackground: 'coral',
      textFont: 'typewriter',
      textAlign: 'left',
      textColor: 'mint',
      textTitle: '  Mon titre  ',
    }).expect(201);
    const body = response.body;

    expect(body.textBackground).toBe('coral');
    expect(body.textFont).toBe('typewriter');
    expect(body.textAlign).toBe('left');
    expect(body.textColor).toBe('mint');
    // Le titre est persisté sans ses espaces de bord.
    expect(body.textTitle).toBe('Mon titre');

    // Le détail et le fil exposent les mêmes champs.
    const detail = await see(alice, body.id).expect(200);
    expect(detail.body.textFont).toBe('typewriter');
    expect(detail.body.textAlign).toBe('left');
    expect(detail.body.textColor).toBe('mint');
    expect(detail.body.textTitle).toBe('Mon titre');

    // Un titre trop long est refusé par le DTO.
    await publish(alice, { caption: 'x', textTitle: 't'.repeat(201) }).expect(400);

    // Une clé inconnue est refusée par le DTO.
    await publish(alice, { caption: 'x', textFont: 'comic-sans' }).expect(400);
    await publish(alice, { caption: 'x', textAlign: 'block' }).expect(400);
    await publish(alice, { caption: 'x', textColor: 'chartreuse' }).expect(400);
  });

  it('modifie une publication texte en conservant l’inchangé', async () => {
    const alice = await register('Editrice');
    const created = await publish(alice, {
      textPages: ['Page un', 'Page deux'],
      textBackground: 'ocean',
      textFont: 'modern',
      textAlign: 'left',
      textColor: 'mint',
      textTitle: 'Titre initial',
    }).expect(201);
    const id = created.body.id;

    // Mise à jour partielle : légende, titre et style, pages inchangées.
    const updated = await request(app.getHttpServer())
      .patch(`/publications/${id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ caption: 'Légende corrigée', textTitle: '  Nouveau titre  ', textFont: 'caps' })
      .expect(200);

    expect(updated.body.caption).toBe('Légende corrigée');
    expect(updated.body.textTitle).toBe('Nouveau titre');
    expect(updated.body.textFont).toBe('caps');
    // La légende est la première page : elle est resynchronisée.
    expect(updated.body.pages).toEqual(['Légende corrigée', 'Page deux']);
    expect(updated.body.textBackground).toBe('ocean');
    expect(updated.body.textAlign).toBe('left');
    expect(updated.body.textColor).toBe('mint');

    // `textTitle: null` efface le titre ; `textPages` refait la légende.
    const cleared = await request(app.getHttpServer())
      .patch(`/publications/${id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ textTitle: null, textPages: ['  Une page  '] })
      .expect(200);
    expect(cleared.body.textTitle).toBeNull();
    expect(cleared.body.pages).toBeNull();
    expect(cleared.body.caption).toBe('Une page');

    // Le détail expose les mêmes valeurs.
    const detail = await see(alice, id).expect(200);
    expect(detail.body.textTitle).toBeNull();
    expect(detail.body.caption).toBe('Une page');
  });

  it('refuse la modification aux non-auteurs et après suppression', async () => {
    const alice = await register('Proprietaire');
    const bob = await register('VoisinEdit');
    const created = await publish(alice, { caption: 'À moi' }).expect(201);
    const id = created.body.id;

    await request(app.getHttpServer())
      .patch(`/publications/${id}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ caption: 'Détourné' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/publications/${id}`)
      .send({ caption: 'Anonyme' })
      .expect(401);

    await request(app.getHttpServer())
      .delete(`/publications/${id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/publications/${id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ caption: 'Posthume' })
      .expect(404);
  });

  it('valide la mise à jour comme la création', async () => {
    const alice = await register('Valideuse');
    const created = await publish(alice, { caption: 'Post' }).expect(201);
    const id = created.body.id;
    const patch = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .patch(`/publications/${id}`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send(body);

    await patch({ textFont: 'comic-sans' }).expect(400);
    await patch({ textAlign: 'block' }).expect(400);
    await patch({ textColor: 'chartreuse' }).expect(400);
    await patch({ textBackground: 'arc-en-ciel' }).expect(400);
    await patch({ textTitle: 't'.repeat(201) }).expect(400);
    await patch({ textPages: ['ok', 'x'.repeat(2001)] }).expect(400);
    await patch({ textPages: Array.from({ length: 11 }, (_, i) => `p${i}`) }).expect(400);
    await patch({ textSize: 10 }).expect(400);
    await patch({ textSize: 65 }).expect(400);
    await patch({ textSize: 1.5 }).expect(400);
    await patch({ location: 'x'.repeat(101) }).expect(400);
    // Une légende vide sur un post sans média est refusée.
    await patch({ caption: '   ' }).expect(400);
    // `textColor: null` est accepté : retour à la couleur du thème.
    await patch({ textColor: null }).expect(200);
    // Taille et lieu acceptés puis effaçables.
    const sized = await patch({ textSize: 42, location: '  Paris  ' }).expect(200);
    expect(sized.body.textSize).toBe(42);
    expect(sized.body.location).toBe('Paris');
    const clearedSize = await patch({ textSize: null, location: null }).expect(200);
    expect(clearedSize.body.textSize).toBeNull();
    expect(clearedSize.body.location).toBeNull();
  });

  it('rejette les pages sur une publication avec média ou citation', async () => {
    const alice = await register('Mediapages');
    const original = await publish(alice).expect(201);

    await publish(alice, {
      textPages: ['a', 'b'],
      quotedPublicationId: original.body.id,
    }).expect(400);
  });

  describe('cas limites des posts texte multi-pages', () => {
    const page = (char: string, length = 2000) => char.repeat(length);

    it('accepte 10 pages pleines de 2000 caractères', async () => {
      const alice = await register('Dixpages');
      const pages = Array.from({ length: 10 }, (_, index) =>
        page(String.fromCharCode(97 + index)),
      );

      const response = await publish(alice, { textPages: pages }).expect(201);
      expect(response.body.pages).toHaveLength(10);
      expect(response.body.pages.every((value: string) => value.length === 2000)).toBe(true);
      expect(response.body.caption).toBe(pages[0]);
      expect((await publicationRow(response.body.id)).textPages).toEqual(pages);
    });

    it('rejette une 11e page et une page de plus de 2000 caractères', async () => {
      const alice = await register('Tropdepages');
      await publish(alice, {
        textPages: Array.from({ length: 11 }, (_, index) => `Page ${index + 1}`),
      }).expect(400);
      await publish(alice, { textPages: ['Courte', page('x', 2001)] }).expect(400);
      expect((await counters(alice.id)).publications).toBe(0);
    });

    it('rejette des pages qui ne sont pas du texte', async () => {
      const alice = await register('Pagesnontexte');
      await publish(alice, { textPages: [42, 'ok'] as unknown as string[] }).expect(400);
    });

    it('ignore les pages vides ou faites d’espaces et nettoie les autres', async () => {
      const alice = await register('Espaces');
      const response = await publish(alice, {
        textPages: ['   ', '  Une  ', '\n\t', 'Deux '],
      }).expect(201);
      expect(response.body.pages).toEqual(['Une', 'Deux']);
      expect(response.body.caption).toBe('Une');
    });

    it('une seule page non vide devient la légende, caption ignoré', async () => {
      const alice = await register('Uniquepage');
      const response = await publish(alice, {
        caption: 'ignorée par le serveur',
        textPages: ['   ', 'Unique'],
      }).expect(201);
      expect(response.body.caption).toBe('Unique');
      expect(response.body.pages).toBeNull();
    });

    it('refuse un post dont toutes les pages sont vides', async () => {
      const alice = await register('Pagesvides');
      await publish(alice, {
        caption: 'ignorée par le serveur',
        textPages: ['  ', '\n\t'],
      }).expect(400);
      expect((await counters(alice.id)).publications).toBe(0);
    });

    it('rejette un fond inconnu et garde null sans fond', async () => {
      const alice = await register('Fonds');
      await publish(alice, { textBackground: 'neon' }).expect(400);
      // Les clés de palette sont sensibles à la casse.
      await publish(alice, { textBackground: 'OCEAN' }).expect(400);

      const plain = await publish(alice).expect(201);
      expect(plain.body.textBackground).toBeNull();
    });

    it('modère le texte de toutes les pages', async () => {
      const moderator = await register('Moderapages');
      await db.update(users).set({ role: 'admin' }).where(eq(users.id, moderator.id));
      const alice = await register('Pagesmoderees');
      // Mot unique fait de lettres seules, pour ne gêner aucun autre test.
      const word = `interdit${String(suffix)
        .split('')
        .map((digit) => String.fromCharCode(97 + Number(digit)))
        .join('')}`;

      const added = await request(app.getHttpServer())
        .post('/admin/blocked-words')
        .set('Authorization', `Bearer ${moderator.token}`)
        .send({ word })
        .expect(201);
      try {
        const response = await publish(alice, {
          textPages: ['Page sage', 'Toujours sage', `Ici un ${word} caché`],
        }).expect(201);
        expect((await publicationRow(response.body.id)).moderationStatus).toBe('flagged');
      } finally {
        await request(app.getHttpServer())
          .delete(`/admin/blocked-words/${added.body.id}`)
          .set('Authorization', `Bearer ${moderator.token}`)
          .expect(200);
      }
    });
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

  describe('« Aimé par » sur le détail d’une publication', () => {
    it('cite le compte suivi qui a aimé, rien pour un visiteur qui ne le suit pas', async () => {
      const author = await register('Detaillee');
      const friend = await register('Amicale');
      const viewer = await register('Curieuse');
      const stranger = await register('Distante');
      const post = await publish(author).expect(201);

      await request(app.getHttpServer())
        .post(`/users/${friend.id}/follow`)
        .set('Authorization', `Bearer ${viewer.token}`)
        .expect(201);

      // Personne n'a aimé : pas d'attribution.
      expect((await see(viewer, post.body.id).expect(200)).body.likedBy).toBeNull();

      await request(app.getHttpServer())
        .post(`/publications/${post.body.id}/like`)
        .set('Authorization', `Bearer ${friend.token}`)
        .send({ kind: 'like' })
        .expect(201);

      const seen = (await see(viewer, post.body.id).expect(200)).body;
      expect(seen.counters.likes).toBe(1);
      expect(seen.likedBy).toEqual({
        id: friend.id,
        username: friend.username,
        displayName: friend.displayName,
        avatarUrl: null,
        verified: false,
      });
      // Un visiteur qui ne suit pas l'amie ne voit que le nombre.
      expect((await see(stranger, post.body.id).expect(200)).body.likedBy).toBeNull();
    });
  });
});
