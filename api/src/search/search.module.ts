import { Module } from '@nestjs/common';
import { SocialMediaModule } from '../social-media/social-media.module.js';
import { HashtagsController, SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [SocialMediaModule],
  controllers: [SearchController, HashtagsController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
