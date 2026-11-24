import { Module } from '@nestjs/common';
import { SocialMediaModule } from '../social-media/social-media.module.js';
import { DiscoverController } from './discover.controller.js';
import { DiscoverService } from './discover.service.js';
import { FeedController } from './feed.controller.js';
import { FeedService } from './feed.service.js';
import { SavedController } from './saved.controller.js';
import { SaveCollectionsService } from './save-collections.service.js';

@Module({
  imports: [SocialMediaModule],
  controllers: [FeedController, SavedController, DiscoverController],
  providers: [FeedService, SaveCollectionsService, DiscoverService],
  exports: [FeedService],
})
export class FeedModule {}
