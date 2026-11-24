import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { FriendsSearchService } from './friends-search.service.js';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersFriendsController {
  constructor(private readonly friendsSearch: FriendsSearchService) {}

  /** Amis = abonnements acceptés dans les deux sens, hors blocages. */
  @Get('me/friends')
  searchFriends(
    @CurrentUser() current: JwtPayload,
    @Query('q') query = '',
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.friendsSearch.search(current.sub, query, limit);
  }
}
