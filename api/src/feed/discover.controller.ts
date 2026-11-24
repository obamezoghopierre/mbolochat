import { Controller, Get, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { DiscoverService } from './discover.service.js';

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
}
