import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '../db/db.module.js';
import { MediaWorkerService } from './media-worker.service.js';
import { ObjectStorageService } from './object-storage.service.js';

/**
 * Contexte du worker média : pas de contrôleurs, pas de gateway Socket.IO.
 * Il partage le schéma et le stockage avec l'API, mais s'exécute à part
 * (`npm run worker:media`) pour ne pas bloquer les requêtes.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DbModule],
  providers: [MediaWorkerService, ObjectStorageService],
  exports: [MediaWorkerService],
})
export class MediaWorkerModule {}
