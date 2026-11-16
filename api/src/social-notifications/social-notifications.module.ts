import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module.js';
import { SocialNotificationsController } from './social-notifications.controller.js';
import { SocialNotificationsService } from './social-notifications.service.js';

@Module({
  imports: [PushModule],
  controllers: [SocialNotificationsController],
  providers: [SocialNotificationsService],
  exports: [SocialNotificationsService],
})
export class SocialNotificationsModule {}
