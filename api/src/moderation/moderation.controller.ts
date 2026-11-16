import {
  BadRequestException,
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
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { AdminGuard } from './admin.guard.js';
import {
  MODERATION_ACTIONS,
  QUEUE_DEFAULT_LIMIT,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  ModerationService,
  type ModerationActionKind,
  type ReportReason,
  type ReportStatus,
  type ReportTargetType,
} from './moderation.service.js';

class CreateReportDto {
  @IsIn(REPORT_TARGET_TYPES)
  targetType!: ReportTargetType;

  @IsString()
  @Length(1, 128)
  targetId!: string;

  @IsIn(REPORT_REASONS)
  reason!: ReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

class DecisionDto {
  @IsIn(MODERATION_ACTIONS)
  action!: ModerationActionKind;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

class BlockedWordDto {
  @IsString()
  @Length(2, 64)
  word!: string;
}

/** Signalement ouvert à tout compte authentifié. */
@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly moderation: ModerationService) {}

  @Post()
  async create(@CurrentUser() current: JwtPayload, @Body() body: CreateReportDto) {
    return this.moderation.report(current.sub, body);
  }
}

/** Back-office de modération : file, décisions, audit, mots bloqués. */
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('reports')
  async queue(
    @Query('status') status: string | undefined,
    @Query('limit', new DefaultValuePipe(QUEUE_DEFAULT_LIMIT), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    const selected = status ?? 'open';
    if (!(REPORT_STATUSES as readonly string[]).includes(selected)) {
      throw new BadRequestException('Statut inconnu.');
    }
    return this.moderation.queue(selected as ReportStatus, limit, cursor);
  }

  @Post('reports/:id/decision')
  async decide(
    @CurrentUser() current: JwtPayload,
    @Param('id') id: string,
    @Body() body: DecisionDto,
  ) {
    return this.moderation.decide(current.sub, id, body.action, body.notes);
  }

  @Get('users')
  async users(
    @Query('q') q: string | undefined,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.moderation.findUsers(q ?? '', limit);
  }

  @Get('blocked-words')
  async blockedWords() {
    return this.moderation.listBlockedWords();
  }

  @Post('blocked-words')
  async addBlockedWord(@CurrentUser() current: JwtPayload, @Body() body: BlockedWordDto) {
    return this.moderation.addBlockedWord(body.word, current.sub);
  }

  @Delete('blocked-words/:id')
  async removeBlockedWord(@Param('id') id: string) {
    return this.moderation.removeBlockedWord(id);
  }

  @Get('audit')
  async audit(
    @Query('limit', new DefaultValuePipe(QUEUE_DEFAULT_LIMIT), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.moderation.audit(limit, cursor);
  }
}
