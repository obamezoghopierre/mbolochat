import { Module } from '@nestjs/common';
import { FollowsModule } from '../follows/follows.module.js';
import { CommentsController, PublicationsController } from './publications.controller.js';
import { PublicationsService } from './publications.service.js';

@Module({
  imports: [FollowsModule],
  controllers: [PublicationsController, CommentsController],
  providers: [PublicationsService],
  exports: [PublicationsService],
})
export class PublicationsModule {}
