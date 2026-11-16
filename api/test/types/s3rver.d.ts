declare module 's3rver' {
  import type { Server } from 'node:http';

  export interface S3rverOptions {
    port?: number;
    address?: string;
    silent?: boolean;
    directory: string;
    /** Buckets créés au démarrage, avec leur configuration éventuelle. */
    configureBuckets?: Array<{ name: string }>;
  }

  /**
   * Serveur S3 d'émulation, réservé aux tests : il permet de vérifier le flux
   * présigné réel (PUT HTTP) sans dépendre d'un MinIO ou d'un compte cloud.
   */
  export default class S3rver {
    constructor(options: S3rverOptions);
    run(): Promise<string>;
    close(): Promise<void>;
    getServer(): Server;
  }
}
