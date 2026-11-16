import { Module } from '@nestjs/common';
import { SocialNotificationsModule } from '../social-notifications/social-notifications.module.js';
import { FollowsController } from './follows.controller.js';
import { FollowsService } from './follows.service.js';

@Module({
  imports: [SocialNotificationsModule],
  controllers: [FollowsController],
  providers: [FollowsService],
  exports: [FollowsService],
})
export class FollowsModule {}
