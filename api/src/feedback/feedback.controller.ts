import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import {
  FEEDBACK_KINDS,
  FEEDBACK_TARGETS,
  FeedbackService,
  type FeedbackKind,
  type FeedbackTarget,
} from './feedback.service.js';

class CreateFeedbackDto {
  @IsIn(FEEDBACK_TARGETS)
  targetType!: FeedbackTarget;

  @IsString()
  @Length(1, 64)
  targetId!: string;

  @IsOptional()
  @IsIn(FEEDBACK_KINDS)
  kind?: FeedbackKind;
}

/**
 * Signaux négatifs du fil. Les actions sont idempotentes : rejouer un « pas
 * intéressé » ne crée pas de doublon, le retirer ne fait rien s'il est absent.
 */
@Controller('feedback')
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async create(@CurrentUser() current: JwtPayload, @Body() body: CreateFeedbackDto) {
    return this.feedback.create(current.sub, body);
  }

  @Get()
  async list(@CurrentUser() current: JwtPayload) {
    return this.feedback.list(current.sub);
  }

  @Delete(':targetType/:targetId')
  async remove(
    @CurrentUser() current: JwtPayload,
    @Param('targetType') targetType: FeedbackTarget,
    @Param('targetId') targetId: string,
  ) {
    if (!(FEEDBACK_TARGETS as readonly string[]).includes(targetType)) {
      throw new BadRequestException('Cible inconnue.');
    }
    return this.feedback.remove(current.sub, targetType, targetId);
  }
}
