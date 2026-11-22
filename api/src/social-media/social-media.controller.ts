import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { SocialMediaService } from './social-media.service.js';

class CreateUploadDto {
  @IsIn(['image', 'video', 'audio'])
  kind!: 'image' | 'video' | 'audio';

  @IsString()
  mime!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  /** Durée réelle pour l'audio (commentaire vocal) — jamais déduite du fichier. */
  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number;
}

/**
 * Upload social par URLs présignées. Le client n'envoie jamais les octets à
 * l'API : il crée le ticket, écrit directement dans S3/R2/MinIO, puis confirme.
 */
@Controller('media/uploads')
@UseGuards(JwtAuthGuard)
export class SocialMediaController {
  constructor(private readonly media: SocialMediaService) {}

  /** Recherche GIPHY (tendances sans `q`). Doit précéder `:id`. */
  @Get('gifs/search')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async gifs(@Query('q') q?: string, @Query('offset') offset?: string) {
    return this.media.searchGifs(q ?? '', Number(offset) || 0);
  }

  /** Importe un GIF choisi comme média du compte (commentaire). */
  @Post('gifs/:giphyId')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async importGif(@CurrentUser() current: JwtPayload, @Param('giphyId') giphyId: string) {
    return this.media.importGif(current.sub, giphyId);
  }

  @Post()
  async create(@CurrentUser() current: JwtPayload, @Body() body: CreateUploadDto) {
    return this.media.createUpload(current.sub, body);
  }

  @Post(':id/complete')
  async complete(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.media.complete(current.sub, id);
  }

  @Get(':id')
  async get(@CurrentUser() current: JwtPayload, @Param('id') id: string) {
    return this.media.get(current.sub, id);
  }
}
