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
    return {
      ...response.body.user,
      token: response.body.accessToken as string,
    };
  };

  const publish = (
    actor: { token: string },
    caption = 'Publication découverte',
  ) =>
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

  const section = (actor: { token: string }, name: string, query = '') =>
    request(app.getHttpServer())
      .get(`/discover/sections/${name}${query}`)
      .set('Authorization', `Bearer ${actor.token}`);

  /** Traverse toutes les pages d'une section et renvoie les identifiants vus. */
  const collectSection = async (
    actor: { token: string },
    name: string,
    limit: number,
  ) => {
    const seen: string[] = [];
    let cursor: string | undefined;
    // Une session borne la liste à 200 publications : 60 pages suffisent.
    for (let page = 0; page < 60; page += 1) {
      const params = new URLSearchParams({ limit: String(limit) });
      if (cursor) {
        params.set('cursor', cursor);
      }
      const response = await section(
        actor,
        name,
        `?${params.toString()}`,
      ).expect(200);
      seen.push(...ids(response.body.items));
      cursor = response.body.nextCursor ?? undefined;
      if (!cursor) {
        return seen;
      }
    }
    throw new Error('Pagination découverte : trop de pages.');
  };

  const insertPublication = (
    authorId: string,
    tag: string,
    values: Partial<typeof publications.$inferInsert> = {},
  ) => {
    const id = crypto.randomUUID();
    return db
      .insert(publications)
      .values({
        id,
        authorId,
        clientId: `page-${tag}-${suffix}-${crypto.randomUUID()}`,
        caption: `Publication ${tag}`,
        // Découvrir n'expose que les contenus média : les fixtures sont des
        // publications image par défaut (le format natif est 'text').
        format: 'image',
        ...values,
      })
      .returning({ id: publications.id })
      .then((rows) => rows[0]!.id);
  };

  /** Les publications créées via l'API sont texte : on les passe en image. */
  const markAsImage = (publicationId: string) =>
    db
      .update(publications)
      .set({ format: 'image' })
      .where(eq(publications.id, publicationId));

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
    await Promise.all([
      markAsImage(friendPost.body.id),
      markAsImage(oneWayPost.body.id),
      markAsImage(distantPost.body.id),
    ]);

    const response = await discover(viewer).expect(200);
    expect(response.body.cityKnown).toBe(true);
    const nearbyIds = ids(response.body.sections.nearbyFriends);
    expect(nearbyIds).toContain(friendPost.body.id);
    expect(nearbyIds).not.toContain(oneWayPost.body.id);
    expect(nearbyIds).not.toContain(distantPost.body.id);
    expect(response.body.sections.nearbyFriends.length).toBeLessThanOrEqual(12);
    expect(response.body.sections.popular).toBeInstanceOf(Array);
    expect(response.body.sections.successful).toBeInstanceOf(Array);
    expect(response.body.sections.breakout).toBeInstanceOf(Array);
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
    await Promise.all([
      markAsImage(high.body.id),
      markAsImage(medium.body.id),
      markAsImage(old.body.id),
    ]);

    await db
      .update(publications)
      .set({
        likeCount: 2_000_000_000,
        commentCount: 147_483_647,
        hotScore: 2_147_483_647,
      })
      .where(eq(publications.id, high.body.id));
    await db
      .update(publications)
      .set({
        likeCount: 2_000_000_000,
        commentCount: 147_483_646,
        hotScore: 2_147_483_646,
      })
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
      expect(successfulIds.indexOf(high.body.id)).toBeLessThan(
        successfulIds.indexOf(medium.body.id),
      );
    }

    const popularIds = ids(response.body.sections.popular);
    expect(popularIds[0]).toBe(high.body.id);
    if (popularIds.includes(medium.body.id)) {
      expect(popularIds.indexOf(high.body.id)).toBeLessThan(
        popularIds.indexOf(medium.body.id),
      );
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

    await db
      .update(users)
      .set({ privateAccount: true })
      .where(eq(users.id, privateAuthor.id));
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
    await Promise.all([
      markAsImage(blocked.body.id),
      markAsImage(privatePost.body.id),
      markAsImage(hidden.body.id),
      markAsImage(dismissed.body.id),
      markAsImage(flagged.body.id),
    ]);
    await db
      .update(publications)
      .set({ moderationStatus: 'flagged', hotScore: 1_500_000 })
      .where(eq(publications.id, flagged.body.id));
    for (const id of [
      blocked.body.id,
      privatePost.body.id,
      hidden.body.id,
      dismissed.body.id,
    ]) {
      await db
        .update(publications)
        .set({ hotScore: 1_500_000 })
        .where(eq(publications.id, id));
    }

    const response = await discover(viewer).expect(200);
    const allSectionIds = [
      ...ids(response.body.sections.nearbyFriends),
      ...ids(response.body.sections.popular),
      ...ids(response.body.sections.successful),
      ...ids(response.body.sections.breakout),
    ];
    expect(allSectionIds).not.toContain(blocked.body.id);
    expect(allSectionIds).not.toContain(privatePost.body.id);
    expect(allSectionIds).not.toContain(hidden.body.id);
    expect(allSectionIds).not.toContain(dismissed.body.id);
    expect(allSectionIds).not.toContain(flagged.body.id);
  });

  it('exige un jeton valide', async () => {
    await request(app.getHttpServer()).get('/discover').expect(401);
    await request(app.getHttpServer())
      .get('/discover/sections/popular')
      .expect(401);
  });

  it('pagine la section populaire par sessions, sans doublon ni perte', async () => {
    const viewer = await register('LecteurPopulaire');
    const author = await register('AutricePopulaire');
    const total = 12;
    const created: string[] = [];
    for (let index = 0; index < total; index += 1) {
      created.push(
        await insertPublication(author.id, 'pop', {
          caption: `Populaire ${index}`,
          hotScore: 2_000_000_000 + index,
        }),
      );
    }

    const seen = await collectSection(viewer, 'popular', 4);
    // Plus de 4 éléments vus ⇒ au moins deux pages ont été chaînées par curseur.
    expect(seen.length).toBeGreaterThan(4);
    expect(new Set(seen).size).toBe(seen.length);

    // hotScore distincts : l'ordre attendu est le score décroissant.
    const expectedOrder = [...created].reverse();
    const positions = expectedOrder.map((id) => seen.indexOf(id));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('ne perd ni ne duplique les publications à score et date identiques', async () => {
    const viewer = await register('LecteurExAequo');
    const author = await register('AutriceExAequo');
    const sameMoment = new Date('2026-01-01T00:00:00.000Z');
    const tied: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      tied.push(
        await insertPublication(author.id, 'tie', {
          caption: `Ex aequo ${index}`,
          hotScore: 2_050_000_000,
          createdAt: sameMoment,
        }),
      );
    }

    const seen = await collectSection(viewer, 'popular', 7);
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of tied) {
      expect(seen).toContain(id);
    }
  });

  it('pagine la section successful et exclut les publications de plus de 7 jours', async () => {
    const viewer = await register('LecteurSuccesPages');
    const author = await register('AutriceSuccesPages');
    const created: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      created.push(
        await insertPublication(author.id, 'suc', {
          caption: `Succès ${index}`,
          // Engagement élevé mais sous le maximum des autres suites : la base
          // e2e est partagée et les fixtures persistent entre les exécutions.
          likeCount: 1_500_000_000,
          commentCount: 500_000_000,
          repostCount: 100_000_000 + index,
        }),
      );
    }
    // Engagement maximal mais hors fenêtre de 7 jours : jamais éligible.
    const stale = await insertPublication(author.id, 'suc-old', {
      caption: 'Succès ancien',
      likeCount: 2_147_483_647,
      commentCount: 2_147_483_647,
      repostCount: 2_147_483_647,
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const seen = await collectSection(viewer, 'successful', 4);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).not.toContain(stale);

    const expectedOrder = [...created].reverse();
    const positions = expectedOrder.map((id) => seen.indexOf(id));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('classe breakout par vélocité en favorisant les petits comptes', async () => {
    const viewer = await register('LecteurBreakout');
    const small = await register('PetitPercant');
    const big = await register('GrosPercant');
    await db
      .update(users)
      .set({ followerCount: 100_000 })
      .where(eq(users.id, big.id));

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    // Petit compte : engagement modeste mais audience nulle → score élevé.
    const smallRecent = await insertPublication(small.id, 'break-small', {
      caption: 'Perce doucement',
      likeCount: 20,
      commentCount: 10,
      repostCount: 5,
      createdAt: oneHourAgo,
    });
    // Gros compte : engagement massif mais audience énorme → score amorti.
    const bigRecent = await insertPublication(big.id, 'break-big', {
      caption: 'Deja costaud',
      likeCount: 2_000,
      commentCount: 500,
      repostCount: 100,
      createdAt: oneHourAgo,
    });
    // Hors fenêtre de 72 h : jamais éligible malgré un engagement énorme.
    const stale = await insertPublication(small.id, 'break-stale', {
      caption: 'Percait avant',
      likeCount: 100_000,
      commentCount: 50_000,
      repostCount: 10_000,
      createdAt: new Date(Date.now() - 80 * 60 * 60 * 1000),
    });
    // Sous le plancher d'engagement pondéré (2 J'aime = 6 < 10) : exclu.
    const tooQuiet = await insertPublication(small.id, 'break-quiet', {
      caption: 'Presque rien',
      likeCount: 2,
      createdAt: oneHourAgo,
    });

    const seen = await collectSection(viewer, 'breakout', 20);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toContain(smallRecent);
    expect(seen).toContain(bigRecent);
    expect(seen.indexOf(smallRecent)).toBeLessThan(seen.indexOf(bigRecent));
    expect(seen).not.toContain(stale);
    expect(seen).not.toContain(tooQuiet);
  });

  it('exclut les publications texte de toutes les sections', async () => {
    const viewer = await register('LecteurSansTexte');
    const author = await register('AutriceSansTexte');
    const textPost = await insertPublication(author.id, 'text-only', {
      caption: 'Publication texte',
      format: 'text',
      hotScore: 2_147_483_647,
      likeCount: 2_000_000_000,
    });
    const mediaPost = await insertPublication(author.id, 'media-ok', {
      // Haut dans le rail « populaire » malgré les fixtures des autres suites.
      hotScore: 2_147_000_000,
    });

    const response = await discover(viewer).expect(200);
    const allIds = [
      ...ids(response.body.sections.nearbyFriends),
      ...ids(response.body.sections.popular),
      ...ids(response.body.sections.successful),
      ...ids(response.body.sections.breakout),
    ];
    expect(allIds).not.toContain(textPost);
    expect(allIds).toContain(mediaPost);

    for (const name of ['popular', 'successful', 'breakout']) {
      const page = await collectSection(viewer, name, 50);
      expect(page).not.toContain(textPost);
    }
  });

  it('pagine nearby-friends par curseur chronologique', async () => {
    const viewer = await register('LecteurProchePages');
    const friend = await register('AmieProchePages');
    const city = `DiscoverPages-${suffix}`;
    await setCity(viewer.id, city);
    await setCity(friend.id, city);
    await follow(viewer, friend.id);
    await follow(friend, viewer.id);

    const created: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      created.push(
        await insertPublication(friend.id, 'near', {
          caption: `Proche ${index}`,
          createdAt: new Date(Date.now() - index * 60_000),
        }),
      );
    }

    const first = await section(viewer, 'nearby-friends', '?limit=2').expect(
      200,
    );
    expect(ids(first.body.items)).toEqual([created[0], created[1]]);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await section(
      viewer,
      'nearby-friends',
      `?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    ).expect(200);
    expect(ids(second.body.items)).toEqual([created[2]]);
    expect(second.body.nextCursor).toBeNull();
  });

  it('renvoie une page vide pour nearby-friends sans ville connue', async () => {
    const viewer = await register('LecteurSansVille');
    const response = await section(viewer, 'nearby-friends').expect(200);
    expect(response.body.items).toEqual([]);
    expect(response.body.nextCursor).toBeNull();
  });

  it('rejette les sections, curseurs et limites invalides', async () => {
    const viewer = await register('LecteurCurseurs');
    // Sans ville, nearby-friends répond une page vide avant de lire le curseur.
    await setCity(viewer.id, `DiscoverCurseurs-${suffix}`);
    await section(viewer, 'inconnue').expect(400);
    for (const name of [
      'popular',
      'successful',
      'breakout',
      'nearby-friends',
    ]) {
      await section(viewer, name, '?cursor=!!!').expect(400);
      // Comme sur /feed : une limite non numérique retombe sur la valeur par
      // défaut (ValidationPipe → NaN → DefaultValuePipe), jamais sur une erreur.
      const fallback = await section(viewer, name, '?limit=abc').expect(200);
      expect(fallback.body.items).toBeInstanceOf(Array);
    }
    // Curseur de session bien formé mais inexistant.
    const bogus = Buffer.from(
      '00000000-0000-0000-0000-000000000000:1',
      'utf8',
    ).toString('base64url');
    await section(viewer, 'popular', `?cursor=${bogus}`).expect(400);

    // Le curseur d'une section classée n'est pas interchangeable avec une autre.
    const first = await section(viewer, 'popular', '?limit=1').expect(200);
    if (first.body.nextCursor) {
      await section(
        viewer,
        'successful',
        `?cursor=${encodeURIComponent(first.body.nextCursor)}`,
      ).expect(400);
    }
  });

  it('applique visibilité, blocages, feedback et modération aux sections paginées', async () => {
    const viewer = await register('LecteurFiltrePages');
    const blockedAuthor = await register('BloquePages');
    const privateAuthor = await register('PrivePages');
    const hiddenAuthor = await register('MasquePages');
    const flaggedAuthor = await register('SignalePages');
    const deletedAuthor = await register('SupprimePages');

    const hot = { hotScore: 2_100_000_000 };
    const blocked = await insertPublication(
      blockedAuthor.id,
      'filt-blocked',
      hot,
    );
    await request(app.getHttpServer())
      .post(`/users/${blockedAuthor.id}/block`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(201);

    await db
      .update(users)
      .set({ privateAccount: true })
      .where(eq(users.id, privateAuthor.id));
    const privatePost = await insertPublication(
      privateAuthor.id,
      'filt-private',
      hot,
    );

    const hidden = await insertPublication(hiddenAuthor.id, 'filt-hidden', hot);
    await request(app.getHttpServer())
      .post('/feedback')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ targetType: 'author', targetId: hiddenAuthor.id })
      .expect(201);

    const flagged = await insertPublication(flaggedAuthor.id, 'filt-flagged', {
      ...hot,
      moderationStatus: 'flagged',
    });
    const deleted = await insertPublication(deletedAuthor.id, 'filt-deleted', {
      ...hot,
      deletedAt: new Date(),
    });

    // Ces publications seraient en tête de page si elles n'étaient pas filtrées.
    const response = await section(viewer, 'popular', '?limit=50').expect(200);
    const pageIds = ids(response.body.items);
    for (const id of [blocked, privatePost, hidden, flagged, deleted]) {
      expect(pageIds).not.toContain(id);
    }
  });
});
