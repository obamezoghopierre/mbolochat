import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import S3rver from 's3rver';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { mediaAssets, users } from '../src/db/schema.js';
import { MediaWorkerModule } from '../src/social-media/media-worker.module.js';
import { MediaWorkerService } from '../src/social-media/media-worker.service.js';

const run = promisify(execFile);

/**
 * Publications avec médias : le fichier est téléversé, traité par le worker
 * (donc `ready`), puis attaché à la publication. Vérifie les formats déduits,
 * l'ordre du carrousel et les refus (média d'autrui, non prêt, mélange).
 */
describe('Publications avec médias (e2e)', () => {
  let app: INestApplication;
  let workerModule: TestingModule;
  let worker: MediaWorkerService;
  let db: Database;
  let s3: S3rver;
  const s3Directory = join('/tmp/opencode', `s3-post-media-${Date.now()}`);
  const bucket = 'post-media-test';
  const previousEnv = { ...process.env };
  const suffix = Date.now();
  let counter = 0;

  const png = async (): Promise<Buffer> => {
    const { default: sharp } = await import('sharp');
    return sharp({
      create: { width: 120, height: 90, channels: 3, background: { r: 10, g: 120, b: 60 } },
    })
      .png()
      .toBuffer();
  };

  const mp4 = async (): Promise<Buffer> => {
    const path = join(s3Directory, 'video.mp4');
    await run('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=160x120:rate=12',
      '-t',
      '1',
      '-pix_fmt',
      'yuv420p',
      path,
    ]);
    const { readFile } = await import('node:fs/promises');
    return readFile(path);
  };

  beforeAll(async () => {
    const port = 44000 + (Date.now() % 4000);
    s3 = new S3rver({ port, address: '127.0.0.1', silent: true, directory: s3Directory });
    await s3.run();
    const endpoint = `http://127.0.0.1:${port}`;
    process.env.SOCIAL_S3_ENDPOINT = endpoint;
    process.env.SOCIAL_S3_REGION = 'us-east-1';
    process.env.SOCIAL_S3_BUCKET = bucket;
    process.env.SOCIAL_S3_ACCESS_KEY_ID = 'S3RVER';
    process.env.SOCIAL_S3_SECRET_ACCESS_KEY = 'S3RVER';
    process.env.SOCIAL_S3_FORCE_PATH_STYLE = 'true';
    process.env.SOCIAL_S3_PUBLIC_BASE_URL = `${endpoint}/${bucket}`;

    const client = new S3Client({
      endpoint,
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

    workerModule = await Test.createTestingModule({ imports: [MediaWorkerModule] }).compile();
    worker = workerModule.get(MediaWorkerService);
  });

  afterAll(async () => {
    process.env = previousEnv;
    await workerModule?.close();
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
        lastName: 'Medias',
        email: `${firstName.toLowerCase()}_postmedia_${suffix}_${counter}@e2e.dev`,
        password: 'password123',
        birthday: '1995-06-15',
        gender: 'FEMALE',
      })
      .expect(201);
    return { ...response.body.user, token: response.body.accessToken as string };
  };

  /** Téléverse un média et le rend `ready` via le vrai worker. */
  const readyAsset = async (
    actor: { token: string },
    input: { kind: 'image' | 'video'; mime: string; bytes: Buffer },
  ): Promise<string> => {
    const ticket = await request(app.getHttpServer())
      .post('/media/uploads')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ kind: input.kind, mime: input.mime, sizeBytes: input.bytes.length })
      .expect(201);
    await fetch(ticket.body.uploadUrl, {
      method: 'PUT',
      body: new Uint8Array(input.bytes),
      headers: { 'content-type': input.mime },
    });
    await request(app.getHttpServer())
      .post(`/media/uploads/${ticket.body.id}/complete`)
      .set('Authorization', `Bearer ${actor.token}`)
      .expect(201);
    await worker.runOnce(10);
    const read = await request(app.getHttpServer())
      .get(`/media/uploads/${ticket.body.id}`)
      .set('Authorization', `Bearer ${actor.token}`)
      .expect(200);
    expect(read.body.status).toBe('ready');
    return ticket.body.id as string;
  };

  const publish = (
    actor: { token: string },
    body: Record<string, unknown>,
  ) =>
    request(app.getHttpServer())
      .post('/publications')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({
        clientId: `media-${suffix}-${Math.random().toString(36).slice(2)}`,
        ...body,
      });

  it('publie une image et renvoie son URL dans le détail et le fil', async () => {
    const author = await register('Photographe');
    // Ville dédiée : le fil partagé contient des centaines de posts de tests.
    const city = `Media-${suffix}`;
    await db.update(users).set({ city }).where(eq(users.id, author.id));
    const assetId = await readyAsset(author, {
      kind: 'image',
      mime: 'image/png',
      bytes: await png(),
    });

    const created = await publish(author, { assetIds: [assetId], caption: 'Photo' }).expect(201);
    expect(created.body.format).toBe('image');
    expect(created.body.media).toHaveLength(1);
    expect(created.body.media[0].kind).toBe('image');
    expect(created.body.media[0].url).toContain('social/variants/');

    const detail = await request(app.getHttpServer())
      .get(`/publications/${created.body.id}`)
      .set('Authorization', `Bearer ${author.token}`)
      .expect(200);
    expect(detail.body.media[0].assetId).toBe(assetId);

    const feed = await request(app.getHttpServer())
      .get('/feed')
      .query({ tab: 'local', limit: 50 })
      .set('Authorization', `Bearer ${author.token}`)
      .expect(200);
    const item = feed.body.items.find((entry: { id: string }) => entry.id === created.body.id);
    expect(item.media[0].url).toBe(created.body.media[0].url);
  });

  it('ordre du carrousel respecté', async () => {
    const author = await register('Carrousel');
    const first = await readyAsset(author, {
      kind: 'image',
      mime: 'image/png',
      bytes: await png(),
    });
    const second = await readyAsset(author, {
      kind: 'image',
      mime: 'image/png',
      bytes: await png(),
    });

    const created = await publish(author, {
      assetIds: [second, first],
      caption: 'Deux images',
    }).expect(201);
    expect(created.body.format).toBe('carousel');
    expect(created.body.media.map((item: { assetId: string }) => item.assetId)).toEqual([
      second,
      first,
    ]);
    expect(created.body.media.map((item: { position: number }) => item.position)).toEqual([0, 1]);
  });

  it('publie une vidéo avec poster et MP4 transcodé', async () => {
    const author = await register('Filmeur');
    const assetId = await readyAsset(author, {
      kind: 'video',
      mime: 'video/mp4',
      bytes: await mp4(),
    });

    const created = await publish(author, { assetIds: [assetId] }).expect(201);
    expect(created.body.format).toBe('video');
    expect(created.body.caption).toBeNull();
    expect(created.body.media[0].kind).toBe('video');
    expect(created.body.media[0].url).toContain('.mp4');
    expect(created.body.media[0].posterUrl).toContain('posters');
    expect(created.body.media[0].durationMs).toBeGreaterThan(900);
  });

  it('signe les médias d’une publication réservée aux abonnés', async () => {
    const author = await register('Fermee');
    const assetId = await readyAsset(author, {
      kind: 'image',
      mime: 'image/png',
      bytes: await png(),
    });

    // Publication publique : URL de CDN, lisible sans signature.
    const open = await publish(author, { assetIds: [assetId], caption: 'Ouverte' }).expect(201);
    expect(open.body.media[0].url).toContain('social/variants/');
    expect(open.body.media[0].url).not.toContain('X-Amz-Signature');

    // Publication réservée aux abonnés : URL signée courte, et réellement lisible.
    const closedAsset = await readyAsset(author, {
      kind: 'image',
      mime: 'image/png',
      bytes: await png(),
    });
    const closed = await publish(author, {
      assetIds: [closedAsset],
      caption: 'Abonnés',
      visibility: 'followers',
    }).expect(201);
    const signedUrl: string = closed.body.media[0].url;
    expect(signedUrl).toContain('X-Amz-Signature');
    // Le chemin public du bucket n'est plus exposé pour un contenu non public.
    expect(signedUrl).not.toBe(open.body.media[0].url);
    const fetched = await fetch(signedUrl);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).subarray(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('purge les objets d’une publication supprimée', async () => {
    const author = await register('Purgee');
    const assetId = await readyAsset(author, {
      kind: 'image',
      mime: 'image/png',
      bytes: await png(),
    });
    const created = await publish(author, { assetIds: [assetId], caption: 'Éphémère' }).expect(201);
    const publicUrl: string = created.body.media[0].url;
    expect((await fetch(publicUrl)).status).toBe(200);

    await request(app.getHttpServer())
      .delete(`/publications/${created.body.id}`)
      .set('Authorization', `Bearer ${author.token}`)
      .expect(200);

    // Le worker exécute le job `cleanup` mis en file par la suppression.
    await worker.runOnce(10);

    const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId));
    expect(row.deletedAt).not.toBeNull();
    expect(row.variants).toBeNull();
    // L'URL publique ne sert plus rien : les octets ont quitté le stockage.
    expect((await fetch(publicUrl)).status).toBe(404);
  });

  it('persiste le filtre d’une publication média et l’ignore sur un post texte', async () => {
    const author = await register('Filtre');
    const assetId = await readyAsset(author, {
      kind: 'image',
      mime: 'image/png',
      bytes: await png(),
    });

    const created = await publish(author, {
      assetIds: [assetId],
      caption: 'Photo filtrée',
      mediaFilter: 'warm',
    }).expect(201);
    expect(created.body.mediaFilter).toBe('warm');

    // Le filtre est aussi exposé dans le fil.
    const detail = await request(app.getHttpServer())
      .get(`/publications/${created.body.id}`)
      .set('Authorization', `Bearer ${author.token}`)
      .expect(200);
    expect(detail.body.mediaFilter).toBe('warm');

    // Sur un post texte, le filtre est ignoré ; une clé inconnue est refusée.
    const text = await publish(author, {
      caption: 'Texte',
      mediaFilter: 'noir',
    }).expect(201);
    expect(text.body.mediaFilter).toBeNull();
    await publish(author, {
      assetIds: [await readyAsset(author, { kind: 'image', mime: 'image/png', bytes: await png() })],
      mediaFilter: 'inconnu',
    }).expect(400);
  });

  it('refuse un média d’un autre compte, non prêt, ou incohérent', async () => {
    const author = await register('Verifie');
    const other = await register('Autre');
    const image = await readyAsset(author, {
      kind: 'image',
      mime: 'image/png',
      bytes: await png(),
    });
    const video = await readyAsset(author, {
      kind: 'video',
      mime: 'video/mp4',
      bytes: await mp4(),
    });

    // Média appartenant à un autre compte.
    await publish(other, { assetIds: [image], caption: 'Vol' }).expect(400);
    // Média encore en attente de traitement.
    const pendingTicket = await request(app.getHttpServer())
      .post('/media/uploads')
      .set('Authorization', `Bearer ${author.token}`)
      .send({ kind: 'image', mime: 'image/png', sizeBytes: 10 })
      .expect(201);
    await publish(author, { assetIds: [pendingTicket.body.id], caption: 'Pas prêt' }).expect(400);
    // Mélange image + vidéo.
    await publish(author, { assetIds: [image, video], caption: 'Mixte' }).expect(400);
    // Même média deux fois.
    await publish(author, { assetIds: [image, image], caption: 'Double' }).expect(400);
    // Ni texte ni média.
    await publish(author, { caption: '   ' }).expect(400);
  });
});
