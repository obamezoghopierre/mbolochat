import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import {
  hashtags,
  publicationHashtags,
  publications,
  publicationTopics,
} from '../src/db/schema.js';

/**
 * Rattachement des publications à leurs sujets, sur vraie base : hashtags
 * explicites (`publication_hashtags`) et mots-clés implicites
 * (`publication_topics`), remplacés à la modification et jamais comptés dans
 * les tendances pour un contenu non public.
 */
describe('Sujets des publications (e2e)', () => {
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
        lastName: 'Sujets',
        email: `${firstName.toLowerCase()}_sujets_${suffix}_${counter}@e2e.dev`,
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

  const publish = async (
    actor: { token: string },
    caption: string,
    visibility: 'public' | 'followers' | 'private' = 'public',
  ) =>
    (
      await request(app.getHttpServer())
        .post('/publications')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({
          caption,
          visibility,
          clientId: `sujets-${suffix}-${Math.random().toString(36).slice(2)}`,
        })
        .expect(201)
    ).body as { id: string };

  const edit = (
    actor: { token: string },
    publicationId: string,
    caption: string,
  ) =>
    request(app.getHttpServer())
      .patch(`/publications/${publicationId}`)
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ caption });

  const tagsOf = async (publicationId: string) => {
    const rows = await db
      .select({ tag: hashtags.tag })
      .from(publicationHashtags)
      .innerJoin(hashtags, eq(hashtags.id, publicationHashtags.hashtagId))
      .where(eq(publicationHashtags.publicationId, publicationId));
    return rows.map((row) => row.tag).sort();
  };

  const topicsOf = async (publicationId: string) => {
    const rows = await db
      .select({ topic: publicationTopics.topic })
      .from(publicationTopics)
      .where(eq(publicationTopics.publicationId, publicationId));
    return rows.map((row) => row.topic).sort();
  };

  const usage = async (tag: string) => {
    const [row] = await db
      .select({ usageCount: hashtags.usageCount })
      .from(hashtags)
      .where(eq(hashtags.tag, tag));
    return row?.usageCount ?? 0;
  };

  it('rattache les hashtags de la légende et complète avec des mots-clés', async () => {
    const author = await register('Rattache');
    const tag = `voyage${suffix}`;
    const post = await publish(author, `Belle plage à Libreville #${tag}`);

    expect(await tagsOf(post.id)).toEqual([tag]);
    // Peu de hashtags : la légende fournit des mots-clés en plus.
    expect(await topicsOf(post.id)).toEqual(
      expect.arrayContaining(['belle', 'plage', 'libreville']),
    );
    expect(await usage(tag)).toBe(1);
  });

  it('ne garde que les hashtags quand l’auteur en met assez', async () => {
    const author = await register('Tagueur');
    const a = `alpha${suffix}`;
    const b = `bravo${suffix}`;
    const c = `charlie${suffix}`;
    const post = await publish(author, `Un derby très disputé #${a} #${b} #${c}`);

    expect(await tagsOf(post.id)).toEqual([a, b, c].sort());
    expect(await topicsOf(post.id)).toEqual([]);
  });

  it('remplace les sujets à la modification, sans empiler', async () => {
    const author = await register('Retouche');
    const first = `ancien${suffix}`;
    const second = `nouveau${suffix}`;
    const post = await publish(author, `Cuisine gabonaise #${first}`);
    expect(await tagsOf(post.id)).toEqual([first]);

    await edit(author, post.id, `Football du dimanche #${second}`).expect(200);
    expect(await tagsOf(post.id)).toEqual([second]);
    const topics = await topicsOf(post.id);
    expect(topics).toContain('football');
    expect(topics).not.toContain('cuisine');
    // Le tag ajouté par la retouche est compté, le retiré n'est pas décompté.
    expect(await usage(second)).toBe(1);
  });

  it('ne gonfle pas le compteur quand la retouche garde le même hashtag', async () => {
    const author = await register('Corrige');
    const tag = `stable${suffix}`;
    const post = await publish(author, `Premier jet #${tag}`);
    expect(await usage(tag)).toBe(1);

    await edit(author, post.id, `Premier jet corrigé #${tag}`).expect(200);
    expect(await usage(tag)).toBe(1);
  });

  it('refuse une légende vide sans média et garde les sujets existants', async () => {
    const author = await register('Vide');
    const tag = `efface${suffix}`;
    const post = await publish(author, `Souvenir de vacances #${tag}`);
    expect(await tagsOf(post.id)).toEqual([tag]);

    // Sans média, une légende vide est refusée : la transaction n'écrit rien,
    // les sujets d'origine doivent donc rester intacts.
    await edit(author, post.id, '').expect(400);
    expect(await tagsOf(post.id)).toEqual([tag]);
  });

  it('rattache mais ne compte pas un hashtag d’un post non public', async () => {
    const author = await register('Discrete');
    const tag = `prive${suffix}`;
    const followers = await publish(author, `Pour mes abonnés #${tag}`, 'followers');
    const privatePost = await publish(author, `Pour moi seul #${tag}`, 'private');

    expect(await tagsOf(followers.id)).toEqual([tag]);
    expect(await tagsOf(privatePost.id)).toEqual([tag]);
    // Le hashtag existe pour le classement, mais n'est pas tendance publique.
    expect(await usage(tag)).toBe(0);
  });

  it('supprime les liens quand la publication est supprimée physiquement', async () => {
    const author = await register('Purge');
    const tag = `cascade${suffix}`;
    const post = await publish(author, `Un sujet éphémère #${tag}`);
    expect(await tagsOf(post.id)).toEqual([tag]);
    expect((await topicsOf(post.id)).length).toBeGreaterThan(0);

    // La suppression par l'API est logique ; la suppression physique (purge de
    // compte) s'appuie sur ON DELETE CASCADE : aucun lien ne doit rester.
    await db.delete(publications).where(eq(publications.id, post.id));
    expect(await tagsOf(post.id)).toEqual([]);
    expect(await topicsOf(post.id)).toEqual([]);
  });
});
