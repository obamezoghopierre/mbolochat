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
import {
  DISCOVER_PAGED_SECTIONS,
  DISCOVER_SECTION_DEFAULT_LIMIT,
  DiscoverService,
  type DiscoverPagedSection,
} from './discover.service.js';

@Controller('discover')
@UseGuards(JwtAuthGuard)
export class DiscoverController {
  constructor(private readonly discover: DiscoverService) {}

  /** Sections bornées pour l'accueil de Découvrir. */
  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async list(@CurrentUser() current: JwtPayload) {
    return this.discover.list(current.sub);
  }

  /**
   * Page d'une section (`popular`, `successful`, `nearby-friends`), pour le
   * « Voir tout » de chaque rail. Même forme de réponse que le fil :
   * `{ items, nextCursor }`.
   */
  @Get('sections/:section')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async section(
    @CurrentUser() current: JwtPayload,
    @Param('section') section: string,
    @Query(
      'limit',
      new DefaultValuePipe(DISCOVER_SECTION_DEFAULT_LIMIT),
      ParseIntPipe,
    )
    limit: number,
    @Query('cursor') cursor?: string,
  ) {
    if (!DISCOVER_PAGED_SECTIONS.includes(section as DiscoverPagedSection)) {
      throw new BadRequestException('Section inconnue.');
    }
    return this.discover.section(
      current.sub,
      section as DiscoverPagedSection,
      limit,
      cursor,
    );
  }
}
