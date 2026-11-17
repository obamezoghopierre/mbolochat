import { Module } from '@nestjs/common';
import { SocialMediaModule } from '../social-media/social-media.module.js';
import { FeedController } from './feed.controller.js';
import { FeedService } from './feed.service.js';

@Module({
  imports: [SocialMediaModule],
  controllers: [FeedController],
  providers: [FeedService],
  exports: [FeedService],
})
export class FeedModule {}
