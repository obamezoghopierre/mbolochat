import { Module } from '@nestjs/common';
import { SocialMediaModule } from '../social-media/social-media.module.js';
import { FeedController } from './feed.controller.js';
import { FeedService } from './feed.service.js';
import { SavedController } from './saved.controller.js';
import { SaveCollectionsService } from './save-collections.service.js';

@Module({
  imports: [SocialMediaModule],
  controllers: [FeedController, SavedController],
  providers: [FeedService, SaveCollectionsService],
  exports: [FeedService],
})
export class FeedModule {}
