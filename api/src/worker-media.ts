import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { RankingService } from './ranking/ranking.service.js';
import { MediaWorkerModule } from './social-media/media-worker.module.js';
import { MediaWorkerService } from './social-media/media-worker.service.js';

/**
 * Point d'entrée des tâches de fond (`npm run worker:media`).
 *
 * Deux boucles dans le même processus :
 * - **médias** : variantes, poster, transcodage, purge, toutes les
 *   `MEDIA_WORKER_INTERVAL_MS` ;
 * - **classement** : recalcul de `hot_score` sur la fenêtre chaude, toutes les
 *   `RANKING_INTERVAL_MS` (sans lui, la fraîcheur n'a aucun effet sur un contenu
 *   sans interaction).
 *
 * SIGINT/SIGTERM arrêtent proprement après le lot en cours ; les jobs repris sont
 * protégés par leur bail et leur jeton de fencing.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(MediaWorkerModule, {
    logger: ['log', 'warn', 'error'],
  });
  const config = app.get(ConfigService);
  const worker = app.get(MediaWorkerService);
  const ranking = app.get(RankingService);
  const intervalMs = Number(config.get<string>('MEDIA_WORKER_INTERVAL_MS') ?? 2000);
  const rankingIntervalMs = Number(config.get<string>('RANKING_INTERVAL_MS') ?? 60_000);

  let running = true;
  const stop = () => {
    running = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  logger.log(
    `Worker démarré (médias ${intervalMs} ms, classement ${rankingIntervalMs} ms).`,
  );
  let nextRankingAt = 0;
  while (running) {
    try {
      const result = await worker.runOnce();
      if (result.claimed > 0) {
        logger.log(
          `Jobs média : ${result.done} terminés, ${result.failed} en erreur sur ${result.claimed}.`,
        );
      }
    } catch (error) {
      logger.error(`Boucle média interrompue : ${(error as Error).message}`);
    }

    if (Date.now() >= nextRankingAt) {
      nextRankingAt = Date.now() + rankingIntervalMs;
      try {
        const updated = await ranking.recomputeHotScores();
        if (updated > 0) {
          logger.log(`Classement : ${updated} scores recalculés.`);
        }
        const pruned = await ranking.pruneExpiredFeedSessions();
        if (pruned > 0) {
          logger.log(`Sessions de fil : ${pruned} expirées supprimées.`);
        }
      } catch (error) {
        logger.error(`Recalcul du classement interrompu : ${(error as Error).message}`);
      }
    }

    if (running) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  await app.close();
  logger.log('Worker arrêté.');
}

void bootstrap();
