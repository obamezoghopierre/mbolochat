import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { FEED_DEFAULT_LIMIT, FeedService } from './feed.service.js';
import { MAX_COLLECTION_NAME, SaveCollectionsService } from './save-collections.service.js';

class CollectionNameDto {
  @IsString()
  @MaxLength(MAX_COLLECTION_NAME)
  name!: string;
}

class AssignCollectionDto {
  /** `null` sort la publication de toute collection. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  collectionId?: string | null;
}

/** Enregistrements et collections du compte connecté (privés). */
@Controller('saved')
@UseGuards(JwtAuthGuard)
export class SavedController {
  constructor(
    private readonly feed: FeedService,
    private readonly collections: SaveCollectionsService,
  ) {}

  /** Tous les enregistrements, ou ceux d'une collection (`?collection=`). */
  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async list(
    @CurrentUser() current: JwtPayload,
    @Query('limit', new DefaultValuePipe(FEED_DEFAULT_LIMIT), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
    @Query('collection') collection?: string,
  ) {
    return this.feed.listSaved(current.sub, limit, cursor, collection || undefined);
  }

  @Get('collections')
  async collectionsList(@CurrentUser() current: JwtPayload) {
    return this.collections.list(current.sub);
  }

  @Post('collections')
  async create(@CurrentUser() current: JwtPayload, @Body() body: CollectionNameDto) {
    return this.collections.create(current.sub, body.name);
  }

  @Patch('collections/:id')
  async rename(
    @CurrentUser() current: JwtPayload,
    @Param('id') id: string,
    @Body() body: CollectionNameDto,
  ) {
    return this.collections.rename(current.sub, id, body.name);
  }

  @Delete('collections/:id')
  async remove(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.collections.remove(current.sub, id);
  }

  /** Range une publication enregistrée dans une collection. */
  @Put(':publicationId/collection')
  async assign(
    @CurrentUser() current: JwtPayload,
    @Param('publicationId') publicationId: string,
    @Body() body: AssignCollectionDto,
  ) {
    return this.collections.assign(current.sub, publicationId, body.collectionId ?? null);
  }
}
