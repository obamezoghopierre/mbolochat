import { Module } from '@nestjs/common';
import { FollowsModule } from '../follows/follows.module.js';
import { UsersController } from './users.controller.js';
import { GeocodingService } from './geocoding.service.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [FollowsModule],
  controllers: [UsersController],
  providers: [UsersService, GeocodingService],
  exports: [UsersService],
})
export class UsersModule {}
