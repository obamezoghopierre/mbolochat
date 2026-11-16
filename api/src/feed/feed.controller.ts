import {
  BadRequestException,
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
import { FEED_DEFAULT_LIMIT, FEED_TABS, FeedService, type FeedTab } from './feed.service.js';

@Controller('feed')
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get()
  async list(
    @CurrentUser() current: JwtPayload,
    @Query('tab') tab: string | undefined,
    @Query('limit', new DefaultValuePipe(FEED_DEFAULT_LIMIT), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    const selected = (tab ?? 'for-you') as FeedTab;
    if (!FEED_TABS.includes(selected)) {
      throw new BadRequestException('Onglet inconnu.');
    }
    return this.feed.list(current.sub, selected, limit, cursor);
  }
}
