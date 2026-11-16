import { Module } from '@nestjs/common';
import { FollowsModule } from '../follows/follows.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { SocialNotificationsModule } from '../social-notifications/social-notifications.module.js';
import { CommentsController, PublicationsController } from './publications.controller.js';
import { PublicationsService } from './publications.service.js';

@Module({
  imports: [FollowsModule, ModerationModule, SocialNotificationsModule],
  controllers: [PublicationsController, CommentsController],
  providers: [PublicationsService],
  exports: [PublicationsService],
})
export class PublicationsModule {}
