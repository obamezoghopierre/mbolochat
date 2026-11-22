import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import S3rver from 's3rver';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { mediaAssets } from '../src/db/schema.js';

/**
 * Spike médias S3 (plan §16.4) sur une vraie base et un vrai serveur S3 :
 * s3rver écoute en HTTP et reçoit le PUT via l'URL présignée, exactement comme
 * MinIO ou R2. Le serveur applicatif ne voit jamais les octets du fichier.
 */
describe('Médias sociaux — upload présigné (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let s3: S3rver;
  let s3Endpoint: string;
  const s3Directory = join('/tmp/opencode', `s3-social-${Date.now()}`);
  const bucket = 'social-test';
  const previousEnv = { ...process.env };
  const suffix = Date.now();
  let counter = 0;

  // PNG 1×1 valide (signature + IHDR), suffisant pour la détection.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  // Faux JPEG : seuls les premiers octets comptent pour la signature.
  const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
  const MP4 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypisom'),
    Buffer.alloc(64),
  ]);

  beforeAll(async () => {
    const port = 40000 + (Date.now() % 10000);
    s3 = new S3rver({ port, address: '127.0.0.1', silent: true, directory: s3Directory });
    await s3.run();
    s3Endpoint = `http://127.0.0.1:${port}`;
    process.env.SOCIAL_S3_ENDPOINT = s3Endpoint;
    process.env.SOCIAL_S3_REGION = 'us-east-1';
    process.env.SOCIAL_S3_BUCKET = bucket;
    process.env.SOCIAL_S3_ACCESS_KEY_ID = 'S3RVER';
    process.env.SOCIAL_S3_SECRET_ACCESS_KEY = 'S3RVER';
    process.env.SOCIAL_S3_FORCE_PATH_STYLE = 'true';
    process.env.SOCIAL_S3_PUBLIC_BASE_URL = `${s3Endpoint}/${bucket}`;

    const client = new S3Client({
      endpoint: s3Endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'S3RVER', secretAccessKey: 'S3RVER' },
    });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    await migrate(db, { migrationsFolder: 'drizzle' });
  });

  afterAll(async () => {
    process.env = previousEnv;
    await app?.close();
    await s3?.close();
    await rm(s3Directory, { recursive: true, force: true });
  });

  const register = async (firstName: string) => {
    counter += 1;
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        firstName,
        lastName: 'Media',
        email: `${firstName.toLowerCase()}_media_${suffix}_${counter}@e2e.dev`,
        password: 'password123',
        birthday: '1995-06-15',
        gender: 'FEMALE',
      })
      .expect(201);
    return { ...response.body.user, token: response.body.accessToken as string };
  };

  const createUpload = (
    actor: { token: string },
    body: { kind: string; mime: string; sizeBytes: number },
  ) =>
    request(app.getHttpServer())
      .post('/media/uploads')
      .set('Authorization', `Bearer ${actor.token}`)
      .send(body);

  const complete = (actor: { token: string }, id: string) =>
    request(app.getHttpServer())
      .post(`/media/uploads/${id}/complete`)
      .set('Authorization', `Bearer ${actor.token}`);

  /** Écrit les octets dans le stockage exactement comme le fera le client. */
  const put = (url: string, body: Buffer, contentType: string) =>
    fetch(url, {
      method: 'PUT',
      // `Uint8Array` est un `BodyInit` valide ; `Buffer` ne l'est pas côté types.
      body: new Uint8Array(body),
      headers: { 'content-type': contentType },
    });

  it('présigne, téléverse et confirme une image', async () => {
    const alice = await register('Photographe');
    const ticket = await createUpload(alice, {
      kind: 'image',
      mime: 'image/png',
      sizeBytes: PNG.length,
    }).expect(201);

    expect(ticket.body.status).toBe('pending');
    expect(ticket.body.contentType).toBe('image/png');
    expect(ticket.body.expiresIn).toBeGreaterThan(0);
    expect(ticket.body.uploadUrl).toContain(bucket);
    // La clé est décidée par le serveur, pas par le client.
    expect(ticket.body.uploadUrl).toContain('/social/image/');

    const upload = await put(ticket.body.uploadUrl, PNG, 'image/png');
    expect(upload.status).toBe(200);

    const completed = await complete(alice, ticket.body.id).expect(201);
    expect(completed.body.status).toBe('uploaded');
    expect(completed.body.sizeBytes).toBe(PNG.length);
    expect(completed.body.kind).toBe('image');

    // Idempotent : rejouer la confirmation ne change rien.
    const replay = await complete(alice, ticket.body.id).expect(201);
    expect(replay.body.status).toBe('uploaded');

    const read = await request(app.getHttpServer())
      .get(`/media/uploads/${ticket.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect(read.body.id).toBe(ticket.body.id);
  });

  it('accepte une vidéo MP4 reconnue par sa signature', async () => {
    const alice = await register('Filmeuse');
    const ticket = await createUpload(alice, {
      kind: 'video',
      mime: 'video/mp4',
      sizeBytes: MP4.length,
    }).expect(201);

    await put(ticket.body.uploadUrl, MP4, 'video/mp4');
    const completed = await complete(alice, ticket.body.id).expect(201);
    expect(completed.body.status).toBe('uploaded');
    expect(completed.body.kind).toBe('video');
  });

  it('accepte une photo mal étiquetée (JPEG annoncé PNG) et enregistre le vrai type', async () => {
    const alice = await register('Galerie');
    const ticket = await createUpload(alice, {
      kind: 'image',
      mime: 'image/png',
      sizeBytes: FAKE_JPEG.length,
    }).expect(201);
    await put(ticket.body.uploadUrl, FAKE_JPEG, 'image/png');
    const completed = await complete(alice, ticket.body.id).expect(201);
    expect(completed.body.status).toBe('uploaded');
    expect(completed.body.mime).toBe('image/jpeg');
  });

  it('accepte une vidéo iPhone .mov (QuickTime)', async () => {
    const alice = await register('Iphoneuse');
    const MOV = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x14]),
      Buffer.from('ftypqt  '),
      Buffer.alloc(64),
    ]);
    const ticket = await createUpload(alice, {
      kind: 'video',
      mime: 'video/quicktime',
      sizeBytes: MOV.length,
    }).expect(201);
    await put(ticket.body.uploadUrl, MOV, 'video/quicktime');
    const completed = await complete(alice, ticket.body.id).expect(201);
    expect(completed.body.kind).toBe('video');
    expect(completed.body.mime).toBe('video/quicktime');
  });

  it('refuse un contenu qui ne correspond pas au type déclaré et le supprime', async () => {
    const alice = await register('Tricheuse');
    const HTML = Buffer.from('<!doctype html><script>alert(1)</script>' + ' '.repeat(40));
    const ticket = await createUpload(alice, {
      kind: 'image',
      mime: 'image/png',
      sizeBytes: HTML.length,
    }).expect(201);

    await put(ticket.body.uploadUrl, HTML, 'image/png');
    await complete(alice, ticket.body.id).expect(400);

    // L'asset reste en attente et l'objet a été retiré du stockage.
    const read = await request(app.getHttpServer())
      .get(`/media/uploads/${ticket.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect(read.body.status).toBe('pending');

    // Le second essai ne trouve plus rien : la suppression a bien eu lieu.
    await complete(alice, ticket.body.id).expect(400);
  });

  it('refuse une taille réelle différente de la taille déclarée', async () => {
    const alice = await register('Mentore');
    const ticket = await createUpload(alice, {
      kind: 'image',
      mime: 'image/png',
      sizeBytes: PNG.length + 100,
    }).expect(201);

    await put(ticket.body.uploadUrl, PNG, 'image/png');
    await complete(alice, ticket.body.id).expect(400);
  });

  it('refuse un MIME inconnu et un fichier au-delà du plafond', async () => {
    const alice = await register('Excessive');

    await createUpload(alice, {
      kind: 'image',
      mime: 'application/pdf',
      sizeBytes: 100,
    }).expect(400);

    await createUpload(alice, {
      kind: 'image',
      mime: 'image/png',
      sizeBytes: 9 * 1024 * 1024,
    }).expect(400);

    await createUpload(alice, {
      kind: 'image',
      mime: 'image/png',
      sizeBytes: 0,
    }).expect(400);
  });

  it('n’expose l’asset qu’à son propriétaire', async () => {
    const alice = await register('Proprietaire');
    const bob = await register('Voisin');
    const ticket = await createUpload(alice, {
      kind: 'image',
      mime: 'image/png',
      sizeBytes: PNG.length,
    }).expect(201);

    await request(app.getHttpServer())
      .get(`/media/uploads/${ticket.body.id}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(404);

    await complete(bob, ticket.body.id).expect(404);

    const [row] = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, ticket.body.id));
    expect(row.status).toBe('pending');
    expect(row.ownerId).toBe(alice.id);
  });

  it('refuse la confirmation quand rien n’a été téléversé', async () => {
    const alice = await register('Vide');
    const ticket = await createUpload(alice, {
      kind: 'image',
      mime: 'image/png',
      sizeBytes: PNG.length,
    }).expect(201);

    await complete(alice, ticket.body.id).expect(400);
  });

  it('exige une authentification sur toutes les routes médias', async () => {
    await request(app.getHttpServer())
      .post('/media/uploads')
      .send({ kind: 'image', mime: 'image/png', sizeBytes: 10 })
      .expect(401);
  });
});
