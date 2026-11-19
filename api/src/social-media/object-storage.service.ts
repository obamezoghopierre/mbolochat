import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

/** Durée de vie d'une URL d'upload : courte, à usage unique de fait. */
export const UPLOAD_URL_TTL_SECONDS = 300;

/**
 * Durée de vie d'une URL de lecture signée (contenu non public : `followers`,
 * privé, en revue, supprimé, ou compte privé). Volontairement courte : elle est
 * redemandée à chaque chargement de page du fil.
 */
export const READ_URL_TTL_SECONDS = 600;

export interface StoredObjectInfo {
  size: number;
  contentType: string | null;
}

/**
 * Accès au stockage objet du réseau social (S3, R2, MinIO).
 *
 * Séparé de `MediaService` (chat) : celui-ci signe des chemins locaux, celui-là
 * présigne des URLs vers un stockage distant. Le client n'écrit jamais sans
 * autorisation serveur, et la clé est toujours calculée par l'API.
 */
@Injectable()
export class ObjectStorageService {
  private client: S3Client | null = null;
  private readonly bucket: string | null;
  private readonly publicBaseUrl: string | null;

  constructor(private readonly config: ConfigService) {
    const bucket = config.get<string>('SOCIAL_S3_BUCKET');
    const accessKeyId = config.get<string>('SOCIAL_S3_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('SOCIAL_S3_SECRET_ACCESS_KEY');
    this.publicBaseUrl = config.get<string>('SOCIAL_S3_PUBLIC_BASE_URL') ?? null;
    this.bucket = bucket && accessKeyId && secretAccessKey ? bucket : null;

    if (!this.bucket) {
      return;
    }
    const endpoint = config.get<string>('SOCIAL_S3_ENDPOINT');
    this.client = new S3Client({
      region: config.get<string>('SOCIAL_S3_REGION') ?? 'us-east-1',
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
      // MinIO et beaucoup de proxys exposent le bucket dans le chemin.
      forcePathStyle: config.get<string>('SOCIAL_S3_FORCE_PATH_STYLE') !== 'false',
      // Le SDK récent signe un CRC32 par défaut que les S3 compatibles
      // (LocalStack, MinIO ancien) rejettent sur les PUT présignés : on ne
      // l'exige que lorsque le service le demande.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      ...(endpoint ? { endpoint } : {}),
    });
  }

  /** Le stockage est-il configuré ? Sinon les routes répondent 503. */
  isConfigured(): boolean {
    return this.client !== null && this.bucket !== null;
  }

  /** URL présignée d'écriture, liée au type de contenu et à la clé exacte. */
  async presignPut(key: string, contentType: string): Promise<string> {
    const { client, bucket } = this.require();
    return getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
  }

  /**
   * URL présignée de lecture, pour un contenu qui ne doit pas être public
   * (publication `followers`/privée, en revue, compte privé).
   *
   * Le client ne reçoit jamais la clé : seulement une URL qui expire.
   */
  async presignGet(key: string, expiresIn = READ_URL_TTL_SECONDS): Promise<string> {
    const { client, bucket } = this.require();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn,
    });
  }

  /**
   * Retrouve la clé d'un objet à partir de son URL publique du bucket.
   *
   * Les variantes antérieures à l'ajout du champ `key` ne stockent que leur URL :
   * cette conversion permet de les signer rétroactivement sans migration de
   * données. `null` si l'URL vient d'ailleurs (CDN tiers, valeur inattendue).
   */
  keyFromPublicUrl(url: string): string | null {
    if (!url.includes('://')) {
      // Variante historiquement enregistrée sous forme de clé nue.
      return url;
    }
    if (!this.publicBaseUrl) return null;
    const base = `${this.publicBaseUrl.replace(/\/$/, '')}/`;
    return url.startsWith(base) ? url.slice(base.length) : null;
  }

  /** Métadonnées de l'objet, `null` s'il n'existe pas. */
  async head(key: string): Promise<StoredObjectInfo | null> {
    const { client, bucket } = this.require();
    try {
      const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return {
        size: response.ContentLength ?? 0,
        contentType: response.ContentType ?? null,
      };
    } catch (error) {
      if (this.isNotFound(error)) return null;
      throw error;
    }
  }

  /** Premiers octets de l'objet, pour vérifier la signature binaire. */
  async readHead(key: string, bytes: number): Promise<Buffer | null> {
    const { client, bucket } = this.require();
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
      );
      return this.streamToBuffer(response.Body);
    } catch (error) {
      if (this.isNotFound(error)) return null;
      throw error;
    }
  }

  /** Contenu complet de l'objet, `null` s'il n'existe pas. */
  async download(key: string): Promise<Buffer | null> {
    const { client, bucket } = this.require();
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return this.streamToBuffer(response.Body);
    } catch (error) {
      if (this.isNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * Écrit l'objet dans un fichier, sans passer par la mémoire.
   *
   * Une vidéo de 100 Mio téléchargée en `Buffer` multiplie l'empreinte du worker
   * par son nombre de jobs concurrents : le transcodage travaille sur un
   * fichier temporaire, comme le fait déjà ffmpeg.
   *
   * @returns `false` si l'objet n'existe pas.
   */
  async downloadToFile(key: string, path: string): Promise<boolean> {
    const { client, bucket } = this.require();
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) {
        return false;
      }
      await pipeline(
        response.Body as unknown as NodeJS.ReadableStream,
        createWriteStream(path),
      );
      return true;
    } catch (error) {
      if (this.isNotFound(error)) return false;
      throw error;
    }
  }

  /** Écrit un objet produit par le serveur (variantes, poster, transcodage). */
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const { client, bucket } = this.require();
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async delete(key: string): Promise<void> {
    const { client, bucket } = this.require();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  /** URL publique d'un asset publié (CDN ou endpoint public du bucket). */
  publicUrl(key: string): string | null {
    if (!this.publicBaseUrl) return null;
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }

  private require(): { client: S3Client; bucket: string } {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException('Stockage média non configuré.');
    }
    return { client: this.client, bucket: this.bucket };
  }

  private isNotFound(error: unknown): boolean {
    const name = (error as { name?: string })?.name;
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode;
    return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
  }

  private async streamToBuffer(body: unknown): Promise<Buffer> {
    if (!body) return Buffer.alloc(0);
    if (body instanceof Uint8Array) return Buffer.from(body);
    const stream = body as AsyncIterable<Uint8Array>;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
