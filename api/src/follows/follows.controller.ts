import {
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { FOLLOW_LIST_DEFAULT_LIMIT, FollowsService } from './follows.service.js';

/**
 * Graphe social greffé sur `/users`. Les routes sont déclarées dans leur propre
 * contrôleur pour que le module `follows` reste autonome ; les chemins ne
 * chevauchent pas ceux de `UsersController` (segments distincts).
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Post(':id/follow')
  async follow(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.followsService.follow(current.sub, id);
  }

  @Delete(':id/follow')
  async unfollow(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.followsService.unfollow(current.sub, id);
  }

  @Get(':id/followers')
  async followers(
    @CurrentUser() current: JwtPayload,
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe(FOLLOW_LIST_DEFAULT_LIMIT), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.followsService.listFollowers(id, current.sub, limit, cursor);
  }

  @Get(':id/following')
  async following(
    @CurrentUser() current: JwtPayload,
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe(FOLLOW_LIST_DEFAULT_LIMIT), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.followsService.listFollowing(id, current.sub, limit, cursor);
  }

  /** Demandes d'abonnement reçues, pour un compte privé. */
  @Get('me/follow-requests')
  async requests(@CurrentUser() current: JwtPayload) {
    return this.followsService.listRequests(current.sub);
  }

  @Post('me/follow-requests/:followerId/accept')
  async accept(@CurrentUser() current: JwtPayload, @Param('followerId') followerId: string) {
    return this.followsService.respondToRequest(current.sub, followerId, true);
  }

  @Post('me/follow-requests/:followerId/reject')
  async reject(@CurrentUser() current: JwtPayload, @Param('followerId') followerId: string) {
    return this.followsService.respondToRequest(current.sub, followerId, false);
  }
}
