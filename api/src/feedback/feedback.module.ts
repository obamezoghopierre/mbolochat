import { Module } from '@nestjs/common';

import { FeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';

/** Signaux négatifs du fil (« Pas intéressé », auteur masqué). */
@Module({
  controllers: [FeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
