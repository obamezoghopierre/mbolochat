import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
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
}
