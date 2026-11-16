import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import {
  NOTIFICATION_DEFAULT_LIMIT,
  SocialNotificationsService,
} from './social-notifications.service.js';

class MarkReadDto {
  /** Absent = tout marquer comme lu. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  ids?: string[];
}

@Controller('social/notifications')
@UseGuards(JwtAuthGuard)
export class SocialNotificationsController {
  constructor(private readonly notifications: SocialNotificationsService) {}

  @Get()
  async list(
    @CurrentUser() current: JwtPayload,
    @Query('limit', new DefaultValuePipe(NOTIFICATION_DEFAULT_LIMIT), ParseIntPipe)
    limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.notifications.list(current.sub, limit, cursor);
  }

  @Post('read')
  async markRead(@CurrentUser() current: JwtPayload, @Body() body: MarkReadDto) {
    return this.notifications.markRead(current.sub, body?.ids);
  }
}
