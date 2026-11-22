import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';

/**
 * Liens web partageables : page d'aperçu publique `/p/:id` (Open Graph, aucun
 * contenu non public révélé) et fichiers .well-known des App Links.
 */
describe('Liens web partageables (e2e)', () => {
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
        lastName: 'Liens',
        email: `${firstName.toLowerCase()}_links_${suffix}_${counter}@e2e.dev`,
        password: 'password123',
        birthday: '1995-06-15',
        gender: 'FEMALE',
      })
      .expect(201);
    return { ...response.body.user, token: response.body.accessToken as string };
  };

  const publish = async (actor: { token: string }, body: Record<string, unknown>) => {
    const response = await request(app.getHttpServer())
      .post('/publications')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ clientId: `links-${suffix}-${Math.random().toString(36).slice(2)}`, ...body })
      .expect(201);
    return response.body as { id: string };
  };

  it('sert un aperçu Open Graph sans connexion pour une publication publique', async () => {
    const author = await register('Partageuse');
    const post = await publish(author, { caption: 'Coucher de soleil <b>à Libreville</b>' });

    const page = await request(app.getHttpServer()).get(`/p/${post.id}`).expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('og:title');
    expect(page.text).toContain(author.displayName);
    // Le texte est échappé : aucune balise injectée.
    expect(page.text).toContain('&lt;b&gt;à Libreville&lt;/b&gt;');
    expect(page.text).not.toContain('<b>à Libreville</b>');
    expect(page.text).toContain(`mbolochat://post/${post.id}`);
  });

  it('ne révèle rien d’une publication non publique ou inexistante', async () => {
    const author = await register('Discrete');
    const secret = await publish(author, {
      caption: 'Réservé aux abonnés',
      visibility: 'followers',
    });

    const hidden = await request(app.getHttpServer()).get(`/p/${secret.id}`).expect(404);
    expect(hidden.text).not.toContain('Réservé aux abonnés');
    expect(hidden.text).not.toContain(author.displayName);

    await request(app.getHttpServer()).get('/p/inexistante').expect(404);
    await request(app.getHttpServer()).get('/p/%3Cscript%3E').expect(404);
  });

  it('expose les fichiers d’association des App Links', async () => {
    const apple = await request(app.getHttpServer())
      .get('/.well-known/apple-app-site-association')
      .expect(200);
    expect(apple.body.applinks).toBeDefined();
    const android = await request(app.getHttpServer())
      .get('/.well-known/assetlinks.json')
      .expect(200);
    expect(Array.isArray(android.body)).toBe(true);
  });
});
