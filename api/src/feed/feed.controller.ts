import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { FEED_DEFAULT_LIMIT, FEED_FORMATS, FEED_TABS, FeedService, type FeedTab } from './feed.service.js';

@Controller('feed')
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get()
  // Le fil est appelé à chaque swipe de page : plafond large mais borné, pour
  // qu'un script ne puisse pas aspirer tout le catalogue.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async list(
    @CurrentUser() current: JwtPayload,
    @Query('tab') tab: string | undefined,
    @Query('limit', new DefaultValuePipe(FEED_DEFAULT_LIMIT), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
    @Query('format') format?: string,
  ) {
    const selected = (tab ?? 'for-you') as FeedTab;
    if (!FEED_TABS.includes(selected)) {
      throw new BadRequestException('Onglet inconnu.');
    }
    // Filtre de format facultatif : `?format=video` sert le pager plein écran.
    if (format !== undefined && !(FEED_FORMATS as readonly string[]).includes(format)) {
      throw new BadRequestException('Format inconnu.');
    }
    return this.feed.list(
      current.sub,
      selected,
      limit,
      cursor,
      format as (typeof FEED_FORMATS)[number] | undefined,
    );
  }

  /** « Suggestions pour toi » : comptes à suivre (amis d'amis, populaires). */
  @Get('suggested-accounts')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async suggested(
    @CurrentUser() current: JwtPayload,
    @Query('limit', new DefaultValuePipe(12), ParseIntPipe) limit: number,
  ) {
    return this.feed.suggestedAccounts(current.sub, limit);
  }

  /** Publications d'un compte (grille du profil, épinglées d'abord). */
  @Get('authored/:userId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async authored(
    @CurrentUser() current: JwtPayload,
    @Param('userId') userId: string,
    @Query('limit', new DefaultValuePipe(FEED_DEFAULT_LIMIT), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.feed.listAuthored(userId, current.sub, limit, cursor);
  }

  /** Republications d'un compte, pour sa grille de profil. */
  @Get('reposts/:userId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async reposts(
    @CurrentUser() current: JwtPayload,
    @Param('userId') userId: string,
    @Query('limit', new DefaultValuePipe(FEED_DEFAULT_LIMIT), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.feed.listReposts(userId, current.sub, limit, cursor);
  }
}
