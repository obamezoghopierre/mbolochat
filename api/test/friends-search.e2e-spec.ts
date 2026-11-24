import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { users } from '../src/db/schema.js';

describe('Recherche d’amis — API (e2e)', () => {
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
        lastName: `Ami${suffix}`,
        email: `${firstName.toLowerCase()}_friend_search_${suffix}_${counter}@e2e.dev`,
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

  const follow = (actor: { token: string }, targetId: string) =>
    request(app.getHttpServer())
      .post(`/users/${targetId}/follow`)
      .set('Authorization', `Bearer ${actor.token}`);

  it('ne renvoie que les abonnements mutuels acceptés, sans blocages ni PII', async () => {
    const alice = await register('Recherche');
    const mutual = await register('Mutuel');
    const oneWay = await register('Unilateral');
    const pending = await register('Demande');
    const blocked = await register('Bloque');

    await follow(alice, mutual.id).expect(201);
    await follow(mutual, alice.id).expect(201);
    await follow(alice, oneWay.id).expect(201);

    await db.update(users).set({ privateAccount: true }).where(eq(users.id, pending.id));
    await follow(alice, pending.id).expect(201);

    await follow(alice, blocked.id).expect(201);
    await follow(blocked, alice.id).expect(201);
    await request(app.getHttpServer())
      .post(`/users/${blocked.id}/block`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(201);

    const result = await request(app.getHttpServer())
      .get('/users/me/friends')
      .query({ q: `Ami${suffix}` })
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);

    expect(result.body.map((item: { id: string }) => item.id)).toEqual([mutual.id]);
    expect(result.body[0]).toMatchObject({
      id: mutual.id,
      username: expect.any(String),
      displayName: expect.any(String),
    });
    expect(result.body[0]).not.toHaveProperty('email');
    expect(result.body[0]).not.toHaveProperty('birthday');
    expect(JSON.stringify(result.body)).not.toContain('@e2e.dev');
  });

  it('exige une session et renvoie une liste vide pour une requête vide', async () => {
    await request(app.getHttpServer()).get('/users/me/friends').expect(401);

    const alice = await register('Vide');
    const result = await request(app.getHttpServer())
      .get('/users/me/friends')
      .query({ q: '   ' })
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect(result.body).toEqual([]);
  });
});
