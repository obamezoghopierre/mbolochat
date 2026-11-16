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
import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
  SEARCH_TYPES,
  SearchService,
  type SearchType,
} from './search.service.js';

@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  async find(
    @CurrentUser() current: JwtPayload,
    @Query('q') q: string | undefined,
    @Query('type') type: string | undefined,
    @Query('limit', new DefaultValuePipe(SEARCH_DEFAULT_LIMIT), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    const query = (q ?? '').trim();
    if (query.length < SEARCH_MIN_QUERY_LENGTH) {
      throw new BadRequestException(
        `La recherche doit contenir au moins ${SEARCH_MIN_QUERY_LENGTH} caractères.`,
      );
    }
    if (query.length > SEARCH_MAX_QUERY_LENGTH) {
      throw new BadRequestException(
        `La recherche ne peut pas dépasser ${SEARCH_MAX_QUERY_LENGTH} caractères.`,
      );
    }
    const selected = (type ?? 'all') as SearchType;
    if (!SEARCH_TYPES.includes(selected)) {
      throw new BadRequestException('Type de recherche inconnu.');
    }
    return this.search.search(current.sub, { q: query, type: selected, limit, cursor });
  }
}

/** Catalogue de hashtags : tendances pour l'onglet Découvrir. */
@Controller('hashtags')
@UseGuards(JwtAuthGuard)
export class HashtagsController {
  constructor(private readonly search: SearchService) {}

  @Get('trending')
  async trending(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.search.trending(limit);
  }
}
