import {
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { ObjectStorageService } from './object-storage.service.js';

/** Contenu public immuable : un an de cache, comme le bucket/CDN de production. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Diffusion des médias publics via l'API (`/social-cdn/<clé>`).
 *
 * `SOCIAL_S3_PUBLIC_BASE_URL` peut pointer ici à la place du bucket : en
 * développement, le stockage objet n'est pas joignable de façon fiable
 * depuis l'émulateur, alors que l'API l'est. Le proxy relaie la requête —
 * `Range` inclus, indispensable à la lecture vidéo — sans copier les octets :
 * le corps S3 est transmis directement vers la réponse.
 *
 * Le proxy sert n'importe quelle clé du bucket sans signature : il n'est
 * ouvert qu'en développement/test, ou sur `SOCIAL_CDN_PROXY=true` explicite.
 * En production, l'URL publique pointe vers le bucket/CDN ; exposer ce proxy
 * transformerait chaque URL signée courte — dont la clé est visible dans le
 * chemin — en URL publique permanente, ce qui viole l'invariant « contenu
 * followers/privé = URL signée courte, jamais une clé S3 ».
 */
@Controller('social-cdn')
export class SocialCdnController {
  private readonly logger = new Logger(SocialCdnController.name);
  private readonly enabled: boolean;

  constructor(
    private readonly storage: ObjectStorageService,
    config: ConfigService,
  ) {
    const env = config.get<string>('NODE_ENV');
    this.enabled =
      config.get<string>('SOCIAL_CDN_PROXY') === 'true' ||
      env === 'development' ||
      env === 'test';
  }

  @Get('*splat')
  async stream(
    @Param('splat') splat: string | string[] | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.enabled) {
      throw new NotFoundException();
    }
    const key = Array.isArray(splat) ? splat.join('/') : splat;
    // Seules les clés du domaine social sont servies : le proxy ne doit pas
    // devenir une porte ouverte sur d'éventuels autres objets du bucket.
    if (!key || !key.startsWith('social/')) {
      throw new NotFoundException();
    }
    try {
      // HEAD : les lecteurs vidéo sondent parfois la taille avant de lire.
      // Inutile d'ouvrir un flux complet pour ne renvoyer que les en-têtes.
      if (req.method === 'HEAD') {
        const info = await this.storage.head(key);
        if (!info) {
          throw new NotFoundException();
        }
        res
          .status(200)
          .set({
            'Content-Type': info.contentType ?? 'application/octet-stream',
            'Content-Length': String(info.size),
            'Accept-Ranges': 'bytes',
            'Cache-Control': CACHE_CONTROL,
            Connection: 'close',
          })
          .end();
        return;
      }

      const object = await this.storage.open(key, req.headers.range);
      res.status(object.contentRange ? 206 : 200);
      res.set({
        'Content-Type': object.contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': CACHE_CONTROL,
        // `Connection: close` : les lecteurs vidéo (OkHttp/ExoPlayer) pooling
        // les connexions keep-alive finissent par réutiliser un socket dont le
        // corps précédent n'a pas été entièrement consommé (chargement avorté
        // lors d'un changement de page) — la lecture suivante reste alors
        // bloquée sur des données déjà reçues. Une connexion dédiée par
        // requête évite ce blocage.
        Connection: 'close',
      });
      if (object.contentLength !== undefined) {
        res.set('Content-Length', String(object.contentLength));
      }
      if (object.contentRange) {
        res.set('Content-Range', object.contentRange);
      }
      if (object.etag) {
        res.set('ETag', object.etag);
      }
      // `pipeline` plutôt que `pipe` : une erreur du flux S3 en cours de
      // transfert doit être prise en charge (sinon l'événement `error` non
      // capturé tue le processus), et un départ du client doit détruire la
      // source au lieu de laisser le téléchargement S3 courir dans le vide.
      await pipeline(object.body, res);
    } catch (error) {
      if (res.headersSent) {
        // Coupure en cours de transfert : les en-têtes sont déjà partis, on
        // coupe la connexion. Un client qui quitte le fil est un cas normal,
        // pas une anomalie à journaliser.
        if (!res.destroyed && !isPrematureClose(error)) {
          this.logger.warn(
            `Transfert interrompu pour « ${key} » : ${String(error)}`,
          );
        }
        res.destroy();
        return;
      }
      if (isMissing(error)) {
        throw new NotFoundException();
      }
      if (isInvalidRange(error)) {
        // Range hors limites : les lecteurs vidéo sondent parfois au-delà de
        // la fin du fichier ; la réponse attendue est 416, pas 500.
        res.status(416).set('Accept-Ranges', 'bytes').end();
        return;
      }
      throw error;
    }
  }
}

function isMissing(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

function isInvalidRange(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;
  return name === 'InvalidRange' || status === 416;
}

function isPrematureClose(error: unknown): boolean {
  return (error as { code?: string })?.code === 'ERR_STREAM_PREMATURE_CLOSE';
}
