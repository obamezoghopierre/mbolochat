import { Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';
import { AdminController, ReportsController } from './moderation.controller.js';
import { ModerationService } from './moderation.service.js';

@Module({
  controllers: [ReportsController, AdminController],
  providers: [ModerationService, AdminGuard],
  exports: [ModerationService],
})
export class ModerationModule {}
