import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { hashtags, publications } from '../src/db/schema.js';

/**
 * Recherche unifiée sur vraie base : plein texte français, trigrammes,
 * visibilité SQL, pagination par curseur et tendances.
 */
describe('Recherche (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  const suffix = Date.now();
  // Les prénoms refusent les chiffres : jeton alphabétique unique par exécution.
  const letters = Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join('');
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
        lastName: 'Cherche',
        email: `${firstName.toLowerCase()}_search_${suffix}_${counter}@e2e.dev`,
        password: 'password123',
        birthday: '1995-06-15',
        gender: 'FEMALE',
      })
      .expect(201);
    return { ...response.body.user, token: response.body.accessToken as string };
  };

  const publish = async (actor: { token: string }, caption: string, visibility = 'public') => {
    const response = await request(app.getHttpServer())
      .post('/publications')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({
        caption,
        visibility,
        clientId: `search-${suffix}-${Math.random().toString(36).slice(2)}`,
      })
      .expect(201);
    return response.body;
  };

  const search = (actor: { token: string }, query: Record<string, unknown>) =>
    request(app.getHttpServer())
      .get('/search')
      .query(query)
      .set('Authorization', `Bearer ${actor.token}`);

  it('retrouve un compte par pseudo ou par nom, sans PII', async () => {
    const viewer = await register('Chercheur');
    const target = await register(`Prenom${letters}`);
    // Le pseudo généré contient le prénom en minuscules.
    const response = await search(viewer, { q: `Prenom${letters}`, type: 'users' }).expect(200);

    const items = response.body.users.items;
    expect(items.map((item: { id: string }) => item.id)).toContain(target.id);
    const found = items.find((item: { id: string }) => item.id === target.id);
    expect(found).toEqual({
      id: target.id,
      username: target.username,
      displayName: target.displayName,
      avatarUrl: null,
      verified: false,
      privateAccount: false,
    });
    expect(JSON.stringify(response.body)).not.toContain('@e2e.dev');

    // Le compte qui cherche ne se trouve pas lui-même.
    const self = await search(viewer, { q: viewer.username, type: 'users' }).expect(200);
    expect(self.body.users.items.map((item: { id: string }) => item.id)).not.toContain(viewer.id);
  });

  it('exclut les comptes bloqués de la recherche', async () => {
    const viewer = await register('Bloqueur');
    const blocked = await register(`Banni${letters}`);
    await request(app.getHttpServer())
      .post(`/users/${blocked.id}/block`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(201);

    const response = await search(viewer, { q: `Banni${letters}`, type: 'users' }).expect(200);
    expect(response.body.users.items).toEqual([]);
  });

  it('trouve une publication en plein texte français', async () => {
    const author = await register('Ecrivain');
    const viewer = await register('Lecteur');
    const caption = `Les montagnes de la ${suffix} sont magnifiques`;
    // La colonne générée peut mettre un instant à être visible : lecture directe.
    const post = await publish(author, caption);

    // Forme fléchie : « montagne » doit retrouver « montagnes ».
    const response = await search(viewer, {
      q: `montagne ${suffix}`,
      type: 'publications',
    }).expect(200);

    const ids = response.body.publications.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(post.id);
    const item = response.body.publications.items.find(
      (entry: { id: string }) => entry.id === post.id,
    );
    expect(item.caption).toBe(caption);
    expect(item.author.id).toBe(author.id);
    expect(JSON.stringify(response.body)).not.toContain('@e2e.dev');
  });

  it('respecte visibilité, blocage, modération et suppression', async () => {
    const author = await register('Discret');
    const viewer = await register('Curieux');
    const token = `secret${suffix}`;

    const visible = await publish(author, `Visible ${token}`);
    const followers = await publish(author, `Fermé ${token}`, 'followers');
    const privatePost = await publish(author, `Prive ${token}`, 'private');
    const flagged = await publish(author, `Signale ${token}`);
    const removed = await publish(author, `Retire ${token}`);
    const deleted = await publish(author, `Supprime ${token}`);

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
      .set('Authorization', `Bearer ${author.token}`)
      .expect(200);

    const ids = (await search(viewer, { q: token, type: 'publications' }).expect(200)).body
      .publications.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(followers.id);
    expect(ids).not.toContain(privatePost.id);
    expect(ids).not.toContain(flagged.id);
    expect(ids).not.toContain(removed.id);
    expect(ids).not.toContain(deleted.id);

    // Un blocage retire aussi les publications déjà trouvables.
    await request(app.getHttpServer())
      .post(`/users/${author.id}/block`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(201);
    const afterBlock = (await search(viewer, { q: token, type: 'publications' }).expect(200)).body
      .publications.items.map((item: { id: string }) => item.id);
    expect(afterBlock).toEqual([]);
  });

  it('pagine les comptes par curseur sans doublon', async () => {
    const viewer = await register('Paginateur');
    const prefix = `pageur${letters}`;
    const created = [];
    for (let index = 0; index < 3; index += 1) {
      const user = await register(`${prefix}${'abc'[index]}`);
      created.push(user.id);
    }

    const page1 = await search(viewer, { q: prefix, type: 'users', limit: 2 }).expect(200);
    expect(page1.body.users.items).toHaveLength(2);
    expect(page1.body.users.nextCursor).toEqual(expect.any(String));

    const page2 = await search(viewer, {
      q: prefix,
      type: 'users',
      limit: 2,
      cursor: page1.body.users.nextCursor,
    }).expect(200);
    expect(page2.body.users.items).toHaveLength(1);
    expect(page2.body.users.nextCursor).toBeNull();

    const ids = [
      ...page1.body.users.items.map((item: { id: string }) => item.id),
      ...page2.body.users.items.map((item: { id: string }) => item.id),
    ];
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(expect.arrayContaining(created));
  });

  it('retrouve les hashtags et expose les tendances', async () => {
    const viewer = await register('Tagueur');
    const tag = `mbolo${suffix}`;
    await db.insert(hashtags).values([
      { tag: `${tag}a`, usageCount: 2, trendScore: 20 },
      { tag: `${tag}b`, usageCount: 9, trendScore: 90 },
    ]);

    const found = await search(viewer, { q: tag, type: 'hashtags' }).expect(200);
    expect(found.body.hashtags.items.map((item: { tag: string }) => item.tag)).toEqual([
      `${tag}b`,
      `${tag}a`,
    ]);

    const trending = await request(app.getHttpServer())
      .get('/hashtags/trending')
      .query({ limit: 30 })
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(200);
    const indexA = trending.body.findIndex((item: { tag: string }) => item.tag === `${tag}a`);
    const indexB = trending.body.findIndex((item: { tag: string }) => item.tag === `${tag}b`);
    expect(indexB).toBeGreaterThanOrEqual(0);
    expect(indexA).toBeGreaterThan(indexB);
  });

  it('valide la requête, le type et le curseur', async () => {
    const viewer = await register('Valideur');
    await search(viewer, { q: 'a' }).expect(400);
    await search(viewer, { q: 'mot', type: 'inconnu' }).expect(400);
    await search(viewer, { q: 'mot', type: 'users', cursor: 'xxx' }).expect(400);
    await request(app.getHttpServer()).get('/search').query({ q: 'mot' }).expect(401);
  });
});
