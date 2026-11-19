import { Module } from '@nestjs/common';
import { FollowsModule } from '../follows/follows.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { SocialMediaModule } from '../social-media/social-media.module.js';
import { SocialNotificationsModule } from '../social-notifications/social-notifications.module.js';
import { CommentsController, PublicationsController } from './publications.controller.js';
import { CommentsGateway } from './comments.gateway.js';
import { PublicationEvents } from './publication-events.js';
import { PublicationsService } from './publications.service.js';

@Module({
  imports: [FollowsModule, ModerationModule, SocialMediaModule, SocialNotificationsModule],
  controllers: [PublicationsController, CommentsController],
  providers: [PublicationsService, PublicationEvents, CommentsGateway],
  exports: [PublicationsService],
})
export class PublicationsModule {}
