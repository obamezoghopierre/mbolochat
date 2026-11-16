import { Module } from '@nestjs/common';
import { HashtagsController, SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  controllers: [SearchController, HashtagsController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
