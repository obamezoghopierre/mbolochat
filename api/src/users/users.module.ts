import { Module } from '@nestjs/common';
import { FollowsModule } from '../follows/follows.module.js';
import { UsersFriendsController } from './users-friends.controller.js';
import { FriendsSearchService } from './friends-search.service.js';
import { UsersController } from './users.controller.js';
import { GeocodingService } from './geocoding.service.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [FollowsModule],
  controllers: [UsersController, UsersFriendsController],
  providers: [UsersService, GeocodingService, FriendsSearchService],
  exports: [UsersService],
})
export class UsersModule {}
