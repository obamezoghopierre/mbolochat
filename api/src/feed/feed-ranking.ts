import { BadRequestException } from '@nestjs/common';

/** Publication candidate au classement, réduite à ce dont l'ordre a besoin. */
export interface RankedCandidate {
  id: string;
  authorId: string;
}

/** Une publication d'exploration insérée tous les N éléments classés. */
export const EXPLORATION_EVERY = 7;
/** Nombre maximal de publications consécutives du même auteur. */
export const MAX_AUTHOR_RUN = 2;

/**
 * Insère une publication « d'exploration » (auteur non suivi) tous les `every`
 * éléments classés.
 *
 * Sans cette part d'aléatoire, « Pour toi » se réduisait aux auteurs déjà suivis
 * et aux contenus déjà virals : aucun nouveau créateur ne pouvait émerger. Les
 * éléments d'exploration sont déjà triés de façon déterministe par l'appelant
 * (hash de la session), pour que deux chargements d'une même session donnent le
 * même ordre.
 */
export function interleaveExploration(
  ranked: RankedCandidate[],
  exploration: RankedCandidate[],
  every: number = EXPLORATION_EVERY,
): RankedCandidate[] {
  if (exploration.length === 0 || every <= 0) {
    return [...ranked];
  }
  const emitted = new Set(ranked.map((item) => item.id));
  const extras: RankedCandidate[] = [];
  for (const item of exploration) {
    if (!emitted.has(item.id)) {
      extras.push(item);
      emitted.add(item.id);
    }
  }

  const result: RankedCandidate[] = [];
  let next = 0;
  for (let index = 0; index < ranked.length; index += 1) {
    result.push(ranked[index]!);
    const boundary = (index + 1) % every === 0;
    if (boundary && next < extras.length) {
      result.push(extras[next]!);
      next += 1;
    }
  }
  // Le reste de la réserve est ajouté à la fin : la session ne perd rien.
  for (; next < extras.length; next += 1) {
    result.push(extras[next]!);
  }
  return result;
}

/**
 * Répartit les publications pour qu'un même auteur n'occupe pas plus de
 * `maxRun` positions consécutives.
 *
 * Une publication qui dépasserait la limite est reportée à la première place
 * disponible après un autre auteur : la portée des gros comptes baisse sans que
 * leur contenu disparaisse.
 */
export function diversifyAuthors(
  items: RankedCandidate[],
  maxRun: number = MAX_AUTHOR_RUN,
): RankedCandidate[] {
  if (maxRun <= 0) {
    return [...items];
  }
  const result: RankedCandidate[] = [];
  const deferred: RankedCandidate[] = [];

  for (const item of items) {
    if (wouldExceedRun(result, item.authorId, maxRun)) {
      deferred.push(item);
      continue;
    }
    result.push(item);
    // Les reports sont replacés dès qu'ils redeviennent valides, en repartant du
    // début de la file : insérer un élément peut rouvrir la place du suivant.
    let inserted = true;
    while (inserted) {
      inserted = false;
      for (let index = 0; index < deferred.length; index += 1) {
        const candidate = deferred[index]!;
        if (!wouldExceedRun(result, candidate.authorId, maxRun)) {
          result.push(candidate);
          deferred.splice(index, 1);
          inserted = true;
          break;
        }
      }
    }
  }
  // Ce qui reste ne pouvait pas être placé : il garde son ordre relatif.
  return [...result, ...deferred];
}

function wouldExceedRun(
  result: RankedCandidate[],
  authorId: string,
  maxRun: number,
): boolean {
  let run = 0;
  for (let index = result.length - 1; index >= 0; index -= 1) {
    if (result[index]!.authorId !== authorId) {
      break;
    }
    run += 1;
  }
  return run >= maxRun;
}

/**
 * Ordre final d'une session : classement, part d'exploration, puis diversité
 * d'auteurs. Déterministe : mêmes entrées, même ordre.
 */
export function buildSessionOrder(
  ranked: RankedCandidate[],
  exploration: RankedCandidate[],
): string[] {
  return diversifyAuthors(interleaveExploration(ranked, exploration)).map((item) => item.id);
}

/** Curseur d'une session : identifiant + décalage dans l'ordre figé. */
export function encodeSessionCursor(sessionId: string, offset: number): string {
  return Buffer.from(`${sessionId}:${offset}`, 'utf8').toString('base64url');
}

export function decodeSessionCursor(cursor: string): {
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
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    throw new BadRequestException('Curseur invalide.');
  }
  return { sessionId, offset };
}

/** Curseur chronologique `(created_at, id)` de l'onglet Abonnements. */
export function encodeFeedTimeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeFeedTimeCursor(cursor: string): { createdAt: Date; id: string } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = raw.lastIndexOf('|');
  const createdAt = new Date(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (separator <= 0 || id.length === 0 || Number.isNaN(createdAt.getTime())) {
    throw new BadRequestException('Curseur invalide.');
  }
  return { createdAt, id };
}
