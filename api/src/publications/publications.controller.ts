import {
  Body,
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
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { CreatePublicationDto } from './dto/create-publication.dto.js';
import { CreateCommentDto, ReactDto, RecordViewDto } from './dto/interactions.dto.js';
import { COMMENT_LIST_DEFAULT_LIMIT, PublicationsService } from './publications.service.js';

@Controller('publications')
@UseGuards(JwtAuthGuard)
export class PublicationsController {
  constructor(private readonly publications: PublicationsService) {}

  @Post()
  async create(@CurrentUser() current: JwtPayload, @Body() body: CreatePublicationDto) {
    return this.publications.create(current.sub, body);
  }

  @Get(':id')
  async get(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.publications.get(id, current.sub);
  }

  @Delete(':id')
  async remove(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.publications.remove(id, current.sub);
  }

  @Post(':id/like')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async react(
    @CurrentUser() current: JwtPayload,
    @Param('id') id: string,
    @Body() body: ReactDto,
  ) {
    return this.publications.react(id, current.sub, body ?? {});
  }

  @Delete(':id/like')
  async unreact(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.publications.unreact(id, current.sub);
  }

  @Post(':id/view')
  // Une vue par page affichée : plafond large, mais un client bogué ne doit pas
  // pouvoir gonfler indéfiniment les compteurs.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async view(
    @CurrentUser() current: JwtPayload,
    @Param('id') id: string,
    @Body() body: RecordViewDto,
  ) {
    return this.publications.recordView(id, current.sub, body ?? {});
  }

  @Post(':id/save')
  async save(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.publications.save(id, current.sub);
  }

  @Delete(':id/save')
  async unsave(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.publications.unsave(id, current.sub);
  }

  @Post(':id/repost')
  async repost(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.publications.repost(id, current.sub);
  }

  @Delete(':id/repost')
  async unrepost(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.publications.unrepost(id, current.sub);
  }

  @Post(':id/comments')
  async comment(
    @CurrentUser() current: JwtPayload,
    @Param('id') id: string,
    @Body() body: CreateCommentDto,
  ) {
    return this.publications.comment(id, current.sub, body);
  }

  @Get(':id/comments')
  async comments(
    @CurrentUser() current: JwtPayload,
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe(COMMENT_LIST_DEFAULT_LIMIT), ParseIntPipe)
    limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.publications.listComments(id, current.sub, limit, cursor);
  }
}

/** Suppression d'un commentaire : route séparée, ce n'est pas `/publications/...`. */
@Controller('comments')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly publications: PublicationsService) {}

  @Delete(':id')
  async remove(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.publications.removeComment(id, current.sub);
  }

  @Post(':id/like')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async like(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.publications.likeComment(id, current.sub, true);
  }

  @Delete(':id/like')
  async unlike(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.publications.likeComment(id, current.sub, false);
  }

  @Post(':id/dislike')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async dislike(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.publications.dislikeComment(id, current.sub, true);
  }

  @Delete(':id/dislike')
  async undislike(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.publications.dislikeComment(id, current.sub, false);
  }
}
