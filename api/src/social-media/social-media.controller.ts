import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsString, Min } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { SocialMediaService } from './social-media.service.js';

class CreateUploadDto {
  @IsIn(['image', 'video'])
  kind!: 'image' | 'video';

  @IsString()
  mime!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

/**
 * Upload social par URLs présignées. Le client n'envoie jamais les octets à
 * l'API : il crée le ticket, écrit directement dans S3/R2/MinIO, puis confirme.
 */
@Controller('media/uploads')
@UseGuards(JwtAuthGuard)
export class SocialMediaController {
  constructor(private readonly media: SocialMediaService) {}

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
