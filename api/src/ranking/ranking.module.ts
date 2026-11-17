import { Module } from '@nestjs/common';

import { RankingService } from './ranking.service.js';

/**
 * Recalcul du classement du fil. Pas de contrôleur : le service est exécuté par
 * le worker (`npm run worker:media`), pas par les requêtes HTTP.
 */
@Module({
  providers: [RankingService],
  exports: [RankingService],
})
export class RankingModule {}
