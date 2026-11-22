import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';

/**
 * Enregistrements et collections : liste privée, collections nommées,
 * rangement d'une publication, isolement entre comptes.
 */
describe('Enregistrements et collections (e2e)', () => {
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
        lastName: 'Saves',
        email: `${firstName.toLowerCase()}_saves_${suffix}_${counter}@e2e.dev`,
        password: 'password123',
        birthday: '1995-06-15',
        gender: 'FEMALE',
      })
      .expect(201);
    return { ...response.body.user, token: response.body.accessToken as string };
  };

  const publish = async (actor: { token: string }, caption: string) => {
    const response = await request(app.getHttpServer())
      .post('/publications')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ caption, clientId: `saves-${suffix}-${Math.random().toString(36).slice(2)}` })
      .expect(201);
    return response.body as { id: string };
  };

  const as = (actor: { token: string }) => ({
    get: (path: string) =>
      request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${actor.token}`),
    post: (path: string, body?: object) =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${actor.token}`)
        .send(body ?? {}),
    put: (path: string, body?: object) =>
      request(app.getHttpServer())
        .put(path)
        .set('Authorization', `Bearer ${actor.token}`)
        .send(body ?? {}),
    patch: (path: string, body?: object) =>
      request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${actor.token}`)
        .send(body ?? {}),
    del: (path: string) =>
      request(app.getHttpServer()).delete(path).set('Authorization', `Bearer ${actor.token}`),
  });

  it('liste les enregistrements, du plus récent au plus ancien', async () => {
    const author = await register('Createur');
    const fan = await register('Collectionneuse');
    const first = await publish(author, 'Premier');
    const second = await publish(author, 'Second');
    await as(fan).post(`/publications/${first.id}/save`).expect(201);
    await as(fan).post(`/publications/${second.id}/save`).expect(201);

    const page = await as(fan).get('/saved').expect(200);
    expect(page.body.items.map((item: { id: string }) => item.id)).toEqual([second.id, first.id]);
    expect(page.body.items[0].viewer.saved).toBe(true);

    // Privé : un autre compte ne voit que ses propres enregistrements.
    const other = await as(author).get('/saved').expect(200);
    expect(other.body.items.map((item: { id: string }) => item.id)).not.toContain(first.id);
  });

  it('crée, range, renomme et supprime une collection', async () => {
    const author = await register('Chef');
    const fan = await register('Gourmande');
    const recipe = await publish(author, 'Recette');
    const other = await publish(author, 'Autre');
    await as(fan).post(`/publications/${recipe.id}/save`).expect(201);
    await as(fan).post(`/publications/${other.id}/save`).expect(201);

    const created = await as(fan).post('/saved/collections', { name: '  Recettes  ' }).expect(201);
    expect(created.body.name).toBe('Recettes');
    // Nom en double (casse ignorée) refusé.
    await as(fan).post('/saved/collections', { name: 'recettes' }).expect(409);
    await as(fan).post('/saved/collections', { name: '   ' }).expect(400);

    await as(fan)
      .put(`/saved/${recipe.id}/collection`, { collectionId: created.body.id })
      .expect(200);
    const listed = await as(fan).get('/saved/collections').expect(200);
    expect(listed.body).toEqual([
      expect.objectContaining({ id: created.body.id, name: 'Recettes', count: 1 }),
    ]);
    const inside = await as(fan).get('/saved').query({ collection: created.body.id }).expect(200);
    expect(inside.body.items.map((item: { id: string }) => item.id)).toEqual([recipe.id]);

    const renamed = await as(fan)
      .patch(`/saved/collections/${created.body.id}`, { name: 'Cuisine' })
      .expect(200);
    expect(renamed.body.name).toBe('Cuisine');

    // Supprimer la collection garde l'enregistrement.
    await as(fan).del(`/saved/collections/${created.body.id}`).expect(200);
    const all = await as(fan).get('/saved').expect(200);
    expect(all.body.items.map((item: { id: string }) => item.id)).toContain(recipe.id);
  });

  it('refuse de ranger une publication non enregistrée ou dans la collection d’autrui', async () => {
    const author = await register('Source');
    const alice = await register('Alice');
    const mallory = await register('Mallory');
    const post = await publish(author, 'Contenu');
    const mine = await as(alice).post('/saved/collections', { name: 'À moi' }).expect(201);

    // Pas encore enregistrée.
    await as(alice).put(`/saved/${post.id}/collection`, { collectionId: mine.body.id }).expect(404);

    await as(mallory).post(`/publications/${post.id}/save`).expect(201);
    await as(mallory)
      .put(`/saved/${post.id}/collection`, { collectionId: mine.body.id })
      .expect(404);
    await as(mallory).get('/saved').query({ collection: mine.body.id }).expect(404);
    await as(mallory).del(`/saved/collections/${mine.body.id}`).expect(404);
  });
});
