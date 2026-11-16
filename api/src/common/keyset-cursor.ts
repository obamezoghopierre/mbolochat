import { BadRequestException } from '@nestjs/common';

/**
 * Curseur de pagination keyset, opaque pour le client : `(createdAt, id)` en
 * base64url.
 *
 * `createdAt` doit être la **représentation texte PostgreSQL** (microsecondes
 * comprises), pas un `Date` JavaScript : `toISOString()` tronque à la
 * milliseconde et, la valeur tronquée étant plus petite que la valeur stockée,
 * la ligne du curseur réapparaîtrait dans la page suivante.
 */
export function encodeKeysetCursor(createdAtText: string, id: string): string {
  return Buffer.from(`${createdAtText}|${id}`, 'utf8').toString('base64url');
}

export interface KeysetCursor {
  /** Valeur brute, à recaster en `timestamptz` dans la comparaison SQL. */
  raw: string;
  id: string;
  /** Date de contrôle (permet de rejeter un curseur forgé). */
  date: Date;
}

export function decodeKeysetCursor(cursor: string): KeysetCursor {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.lastIndexOf('|');
  if (separator <= 0) {
    throw new BadRequestException('Curseur invalide.');
  }
  const raw = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  const date = new Date(raw);
  if (!id || Number.isNaN(date.getTime())) {
    throw new BadRequestException('Curseur invalide.');
  }
  return { raw, id, date };
}
