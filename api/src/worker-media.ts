import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { MediaWorkerModule } from './social-media/media-worker.module.js';
import { MediaWorkerService } from './social-media/media-worker.service.js';

/**
 * Point d'entrée du worker média (`npm run worker:media`).
 *
 * Boucle simple : tant que le processus vit, il traite un lot puis attend
 * l'intervalle configuré. SIGINT/SIGTERM arrêtent proprement après le lot en
 * cours ; les jobs repris sont protégés par leur bail et leur jeton de fencing.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('MediaWorker');
  const app = await NestFactory.createApplicationContext(MediaWorkerModule, {
    logger: ['log', 'warn', 'error'],
  });
  const config = app.get(ConfigService);
  const worker = app.get(MediaWorkerService);
  const intervalMs = Number(config.get<string>('MEDIA_WORKER_INTERVAL_MS') ?? 2000);

  let running = true;
  const stop = () => {
    running = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  logger.log(`Worker média démarré (intervalle ${intervalMs} ms).`);
  while (running) {
    try {
      const result = await worker.runOnce();
      if (result.claimed > 0) {
        logger.log(
          `Jobs : ${result.done} terminés, ${result.failed} en erreur sur ${result.claimed}.`,
        );
      }
    } catch (error) {
      logger.error(`Boucle média interrompue : ${(error as Error).message}`);
    }
    if (running) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  await app.close();
  logger.log('Worker média arrêté.');
}

void bootstrap();
