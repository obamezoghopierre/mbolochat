import { BadRequestException } from '@nestjs/common';

export const COMMENT_SESSION_TTL_MS = 30 * 60 * 1000;

export function encodeCommentSessionCursor(
  sessionId: string,
  offset: number,
): string {
  return Buffer.from(`${sessionId}:${offset}`, 'utf8').toString('base64url');
}

export function decodeCommentSessionCursor(cursor: string): {
  sessionId: string;
  offset: number;
} {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = raw.lastIndexOf(':');
  const sessionId = raw.slice(0, separator);
  const offset = Number(raw.slice(separator + 1));
  if (
    separator <= 0 ||
    sessionId.length === 0 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    throw new BadRequestException('Curseur invalide.');
  }
  return { sessionId, offset };
}
