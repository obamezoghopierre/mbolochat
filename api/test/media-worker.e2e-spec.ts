import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
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
import { mediaAssets, mediaJobs } from '../src/db/schema.js';
import { MediaWorkerModule } from '../src/social-media/media-worker.module.js';
import { MediaWorkerService } from '../src/social-media/media-worker.service.js';

const run = promisify(execFile);

/** Le worker tourne réellement : base PostgreSQL, S3 HTTP, sharp et ffmpeg. */
describe('Worker média (e2e)', () => {
  let app: INestApplication;
  let workerModule: TestingModule;
  let worker: MediaWorkerService;
  let db: Database;
  let s3: S3rver;
  let ffmpegAvailable = true;
  const s3Directory = join('/tmp/opencode', `s3-worker-${Date.now()}`);
  const bucket = 'worker-test';
  const previousEnv = { ...process.env };
  const suffix = Date.now();
  let counter = 0;

  // PNG 64×64 uni : ni upscale, ni EXIF.
  const png64 = async (): Promise<Buffer> => {
    const { default: sharp } = await import('sharp');
    return sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 90, b: 200 } },
    })
      .png()
      .toBuffer();
  };

  const makeVideo = async (): Promise<Buffer> => {
    const path = join(s3Directory, 'source.mp4');
    await run('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=15',
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
    try {
      await run('ffmpeg', ['-version']);
    } catch {
      ffmpegAvailable = false;
    }
    const port = 42000 + (Date.now() % 5000);
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
    process.env.FFMPEG_PATH = 'ffmpeg';
    process.env.FFPROBE_PATH = 'ffprobe';

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
    // Les autres suites e2e laissent des uploads en attente dans la même base.
    // On neutralise leurs jobs pour que les compteurs de cette suite soient
    // déterministes ; aucune assertion d'une autre suite ne porte sur eux.
    await db
      .update(mediaJobs)
      .set({ status: 'failed', lastError: 'nettoyage avant suite worker' })
      .where(inArray(mediaJobs.status, ['pending', 'running']));

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
        lastName: 'Worker',
        email: `${firstName.toLowerCase()}_worker_${suffix}_${counter}@e2e.dev`,
        password: 'password123',
        birthday: '1995-06-15',
        gender: 'FEMALE',
      })
      .expect(201);
    return { ...response.body.user, token: response.body.accessToken as string };
  };

  const upload = async (
    actor: { token: string },
    input: { kind: 'image' | 'video'; mime: string; bytes: Buffer },
  ) => {
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
    const completed = await request(app.getHttpServer())
      .post(`/media/uploads/${ticket.body.id}/complete`)
      .set('Authorization', `Bearer ${actor.token}`)
      .expect(201);
    return completed.body.id as string;
  };

  const asset = async (id: string) => {
    const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id));
    return row;
  };

  it('produit les variantes d’une image et passe l’asset en ready', async () => {
    const alice = await register('Vignette');
    const bytes = await png64();
    const id = await upload(alice, { kind: 'image', mime: 'image/png', bytes });

    // La confirmation a mis un job en file, sans le traiter.
    const queued = await db.select().from(mediaJobs).where(eq(mediaJobs.assetId, id));
    expect(queued).toHaveLength(1);
    expect(queued[0].kind).toBe('image_variants');
    expect(queued[0].status).toBe('pending');

    const result = await worker.runOnce(5);
    expect(result.claimed).toBe(1);
    expect(result.done).toBe(1);
    expect(result.failed).toBe(0);

    const row = await asset(id);
    expect(row.status).toBe('ready');
    expect(row.width).toBe(64);
    expect(row.height).toBe(64);
    const variants = row.variants ?? [];
    expect(variants.map((variant) => variant.label).sort()).toEqual(['medium', 'thumb']);
    // Pas d'agrandissement : la source 64 px reste à 64 px.
    for (const variant of variants) {
      expect(variant.width).toBeLessThanOrEqual(64);
      expect(variant.url).toContain('social/variants/');
      const response = await fetch(variant.url);
      expect(response.status).toBe(200);
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.subarray(0, 4).toString('ascii')).toBe('RIFF'); // WebP
      expect(body.length).toBe(variant.sizeBytes);
    }

    // Rejouer la boucle ne retraite rien.
    const again = await worker.runOnce(5);
    expect(again.claimed).toBe(0);
    expect((await db.select().from(mediaJobs).where(eq(mediaJobs.assetId, id)))[0].status).toBe(
      'done',
    );
  });

  it('produit un poster et un MP4 transcodé pour une vidéo', async () => {
    if (!ffmpegAvailable) {
      console.warn('ffmpeg absent : test vidéo ignoré.');
      return;
    }
    const alice = await register('Filmeuse');
    const bytes = await makeVideo();
    const id = await upload(alice, { kind: 'video', mime: 'video/mp4', bytes });

    const queued = await db.select().from(mediaJobs).where(eq(mediaJobs.assetId, id));
    expect(queued.map((job) => job.kind).sort()).toEqual(['video_poster', 'video_transcode']);

    expect((await worker.runOnce(1)).done).toBe(1);
    expect((await worker.runOnce(1)).done).toBe(1);

    const row = await asset(id);
    expect(row.status).toBe('ready');
    expect(row.width).toBe(320);
    expect(row.height).toBe(240);
    expect(row.durationMs).toBeGreaterThan(900);
    expect(row.durationMs).toBeLessThan(1200);

    const labels = (row.variants ?? []).map((variant) => variant.label).sort();
    expect(labels).toEqual(['mp4', 'poster']);
    for (const variant of row.variants ?? []) {
      const response = await fetch(variant.url);
      expect(response.status).toBe(200);
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.length).toBe(variant.sizeBytes);
      if (variant.label === 'mp4') {
        expect(body.subarray(4, 8).toString('ascii')).toBe('ftyp');
      }
      if (variant.label === 'poster') {
        expect(body.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); // JPEG
      }
    }
  });

  it('n’exécute jamais deux fois le même job en parallèle', async () => {
    const alice = await register('Concurrente');
    const bytes = await png64();
    const id = await upload(alice, { kind: 'image', mime: 'image/png', bytes });

    const [first, second] = await Promise.all([worker.runOnce(5), worker.runOnce(5)]);
    expect(first.claimed + second.claimed).toBe(1);
    expect(first.done + second.done).toBe(1);

    const row = await asset(id);
    expect(row.status).toBe('ready');
  });

  it('réessaie un job en échec puis l’abandonne après trois tentatives', async () => {
    const alice = await register('Panne');
    const [broken] = await db
      .insert(mediaAssets)
      .values({
        ownerId: alice.id,
        bucket: 'social',
        storageKey: `social/image/${alice.id}/absent-${suffix}.png`,
        kind: 'image',
        mime: 'image/png',
        sizeBytes: 42,
        status: 'uploaded',
      })
      .returning();
    const [job] = await db
      .insert(mediaJobs)
      .values({ assetId: broken.id, kind: 'image_variants' })
      .returning();

    const first = await worker.runOnce(5);
    expect(first.failed).toBe(1);
    let row = (await db.select().from(mediaJobs).where(eq(mediaJobs.id, job.id)))[0];
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('introuvable');

    // Le worker applique un délai : on remet l'échéance à maintenant.
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      await db
        .update(mediaJobs)
        .set({ nextAttemptAt: new Date(Date.now() - 1000) })
        .where(eq(mediaJobs.id, job.id));
      await worker.runOnce(5);
      row = (await db.select().from(mediaJobs).where(eq(mediaJobs.id, job.id)))[0];
    }
    expect(row.attempts).toBe(3);
    expect(row.status).toBe('failed');
    expect((await asset(broken.id)).status).toBe('uploaded');
  });

  it('refuse de traiter un média supprimé', async () => {
    const alice = await register('Supprime');
    const bytes = await png64();
    const id = await upload(alice, { kind: 'image', mime: 'image/png', bytes });
    await db.update(mediaAssets).set({ deletedAt: new Date() }).where(eq(mediaAssets.id, id));

    const result = await worker.runOnce(5);
    expect(result.failed).toBe(1);
    const [job] = await db.select().from(mediaJobs).where(eq(mediaJobs.assetId, id));
    expect(job.lastError).toContain('supprimé');
  });
});
