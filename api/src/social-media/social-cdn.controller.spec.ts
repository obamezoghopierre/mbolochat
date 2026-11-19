import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { ObjectStorageService } from './object-storage.service.js';
import { SocialCdnController } from './social-cdn.controller.js';

/**
 * Réponse Express simulée : un vrai `Writable` (pour `pipeline`) affublé des
 * méthodes impératives utilisées par le contrôleur, avec l'état observable.
 */
function fakeRes() {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  // Méthodes natives capturées avant surcharge : `res` est ce même objet,
  // les rappeler par leur nom après `Object.assign` bouclerait à l'infini.
  const nativeEnd = stream.end.bind(stream);
  const nativeDestroy = stream.destroy.bind(stream);
  return Object.assign(stream, {
    chunks,
    statusCode: 0,
    headers: {} as Record<string, string>,
    headersSent: false,
    ended: false,
    controllerDestroyed: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    set(field: string | Record<string, string>, value?: string) {
      if (typeof field === 'string') {
        this.headers[field] = value ?? '';
      } else {
        Object.assign(this.headers, field);
      }
      this.headersSent = true;
      return this;
    },
    end() {
      this.ended = true;
      nativeEnd();
      return this;
    },
    destroy() {
      this.controllerDestroyed = true;
      nativeDestroy();
      return this;
    },
  });
}

type FakeRes = ReturnType<typeof fakeRes>;

function asResponse(res: FakeRes): Response {
  return res as unknown as Response;
}

function fakeReq(method = 'GET', range?: string): Request {
  return { method, headers: range ? { range } : {} } as unknown as Request;
}

function makeStorage() {
  return {
    open: vi.fn(),
    head: vi.fn(),
  };
}

function makeController(
  storage: ReturnType<typeof makeStorage>,
  env: Record<string, string | undefined>,
): SocialCdnController {
  const config = {
    get: vi.fn((key: string) => env[key]),
  } as unknown as ConfigService;
  return new SocialCdnController(
    storage as unknown as ObjectStorageService,
    config,
  );
}

const KEY = 'social/video/u/abc.mp4';

function objectBody(text: string) {
  return {
    body: Readable.from([Buffer.from(text)]),
    contentType: 'video/mp4',
    contentLength: text.length,
    contentRange: undefined as string | undefined,
    etag: '"abc"',
  };
}

describe('SocialCdnController — ouverture de la route', () => {
  it.each([undefined, 'production', 'staging'])(
    'répond 404 hors développement sans opt-in (NODE_ENV=%s)',
    async (env) => {
      const storage = makeStorage();
      const controller = makeController(storage, { NODE_ENV: env });
      await expect(
        controller.stream(KEY, fakeReq(), asResponse(fakeRes())),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.open).not.toHaveBeenCalled();
    },
  );

  it.each(['development', 'test'])('sert le flux en %s', async (env) => {
    const storage = makeStorage();
    storage.open.mockResolvedValue(objectBody('abc'));
    const controller = makeController(storage, { NODE_ENV: env });
    const res = fakeRes();
    await controller.stream(KEY, fakeReq(), asResponse(res));
    expect(res.statusCode).toBe(200);
  });

  it('sert le flux en production sur SOCIAL_CDN_PROXY=true explicite', async () => {
    const storage = makeStorage();
    storage.open.mockResolvedValue(objectBody('abc'));
    const controller = makeController(storage, {
      NODE_ENV: 'production',
      SOCIAL_CDN_PROXY: 'true',
    });
    const res = fakeRes();
    await controller.stream(KEY, fakeReq(), asResponse(res));
    expect(res.statusCode).toBe(200);
  });
});

describe('SocialCdnController — clés servies', () => {
  it.each([undefined, '', 'autre/objet.mp4', 'socialise/objet.mp4'])(
    'refuse une clé hors du domaine social (%s)',
    async (splat) => {
      const storage = makeStorage();
      const controller = makeController(storage, { NODE_ENV: 'development' });
      await expect(
        controller.stream(splat, fakeReq(), asResponse(fakeRes())),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.open).not.toHaveBeenCalled();
    },
  );

  it('recolle les segments du splat en clé', async () => {
    const storage = makeStorage();
    storage.open.mockResolvedValue(objectBody('abc'));
    const controller = makeController(storage, { NODE_ENV: 'development' });
    await controller.stream(
      ['social', 'video', 'u', 'abc.mp4'],
      fakeReq(),
      asResponse(fakeRes()),
    );
    expect(storage.open).toHaveBeenCalledWith(KEY, undefined);
  });
});

describe('SocialCdnController — streaming', () => {
  it('relaie le corps et les en-têtes publics immuables', async () => {
    const storage = makeStorage();
    storage.open.mockResolvedValue(objectBody('abcdef'));
    const controller = makeController(storage, { NODE_ENV: 'development' });
    const res = fakeRes();
    await controller.stream(KEY, fakeReq(), asResponse(res));
    expect(res.statusCode).toBe(200);
    expect(Buffer.concat(res.chunks).toString()).toBe('abcdef');
    expect(res.headers['Content-Type']).toBe('video/mp4');
    expect(res.headers['Content-Length']).toBe('6');
    expect(res.headers['Accept-Ranges']).toBe('bytes');
    expect(res.headers['Cache-Control']).toContain('immutable');
    expect(res.headers['ETag']).toBe('"abc"');
    expect(res.ended).toBe(true);
  });

  it('propage le Range et répond 206 avec Content-Range', async () => {
    const storage = makeStorage();
    const object = objectBody('abc');
    object.contentRange = 'bytes 0-2/10';
    storage.open.mockResolvedValue(object);
    const controller = makeController(storage, { NODE_ENV: 'development' });
    const res = fakeRes();
    await controller.stream(KEY, fakeReq('GET', 'bytes=0-2'), asResponse(res));
    expect(storage.open).toHaveBeenCalledWith(KEY, 'bytes=0-2');
    expect(res.statusCode).toBe(206);
    expect(res.headers['Content-Range']).toBe('bytes 0-2/10');
  });

  it.each([
    { name: 'NoSuchKey' },
    { name: 'NotFound' },
    { $metadata: { httpStatusCode: 404 } },
  ])('traduit une absence en 404 (%j)', async (error) => {
    const storage = makeStorage();
    storage.open.mockRejectedValue(error);
    const controller = makeController(storage, { NODE_ENV: 'development' });
    await expect(
      controller.stream(KEY, fakeReq(), asResponse(fakeRes())),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([{ name: 'InvalidRange' }, { $metadata: { httpStatusCode: 416 } }])(
    'répond 416 sur un Range hors limites (%j)',
    async (error) => {
      const storage = makeStorage();
      storage.open.mockRejectedValue(error);
      const controller = makeController(storage, { NODE_ENV: 'development' });
      const res = fakeRes();
      await controller.stream(
        KEY,
        fakeReq('GET', 'bytes=999999-'),
        asResponse(res),
      );
      expect(res.statusCode).toBe(416);
      expect(res.ended).toBe(true);
    },
  );

  it('répond au HEAD sans ouvrir le corps', async () => {
    const storage = makeStorage();
    storage.head.mockResolvedValue({ size: 42, contentType: 'video/mp4' });
    const controller = makeController(storage, { NODE_ENV: 'development' });
    const res = fakeRes();
    await controller.stream(KEY, fakeReq('HEAD'), asResponse(res));
    expect(storage.open).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Length']).toBe('42');
    expect(res.chunks).toHaveLength(0);
  });

  it('traduit un HEAD sur objet absent en 404', async () => {
    const storage = makeStorage();
    storage.head.mockResolvedValue(null);
    const controller = makeController(storage, { NODE_ENV: 'development' });
    await expect(
      controller.stream(KEY, fakeReq('HEAD'), asResponse(fakeRes())),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('coupe la connexion sans exception si le flux S3 casse en cours de transfert', async () => {
    const storage = makeStorage();
    const body = new Readable({
      read() {
        this.push(Buffer.from('x'));
        this.destroy(new Error('coupure S3'));
      },
    });
    storage.open.mockResolvedValue({ ...objectBody('x'), body });
    const controller = makeController(storage, { NODE_ENV: 'development' });
    const res = fakeRes();
    await expect(
      controller.stream(KEY, fakeReq(), asResponse(res)),
    ).resolves.toBeUndefined();
    expect(res.headersSent).toBe(true);
    expect(res.controllerDestroyed).toBe(true);
  });

  it('laisse le client partir sans bruit (connexion coupée côté réponse)', async () => {
    const storage = makeStorage();
    // Flux qui ne se termine jamais : le départ du client doit l'arrêter.
    const body = new Readable({ read() {} });
    storage.open.mockResolvedValue({ ...objectBody('x'), body });
    const controller = makeController(storage, { NODE_ENV: 'development' });
    const res = fakeRes();
    const pending = controller.stream(KEY, fakeReq(), asResponse(res));
    await new Promise((resolve) => setTimeout(resolve, 10));
    res.destroy();
    await expect(pending).resolves.toBeUndefined();
    expect(body.destroyed).toBe(true);
  });
});
