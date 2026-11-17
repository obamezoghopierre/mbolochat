import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '../db/db.module.js';
import { RankingModule } from '../ranking/ranking.module.js';
import { MediaWorkerService } from './media-worker.service.js';
import { ObjectStorageService } from './object-storage.service.js';

/**
 * Contexte du worker média : pas de contrôleurs, pas de gateway Socket.IO.
 * Il partage le schéma et le stockage avec l'API, mais s'exécute à part
 * (`npm run worker:media`) pour ne pas bloquer les requêtes.
 *
 * Le recalcul du classement vit dans le même processus (`RankingModule`) : les
 * deux tâches sont des boucles de fond peu coûteuses, et un seul worker à
 * exploiter vaut mieux que deux services à déployer en v1.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DbModule, RankingModule],
  providers: [MediaWorkerService, ObjectStorageService],
  exports: [MediaWorkerService],
})
export class MediaWorkerModule {}
