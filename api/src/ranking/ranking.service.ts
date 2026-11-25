import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DRIZZLE, type Database } from '../db/db.module.js';
import { commentSessions, feedSessions } from '../db/schema.js';
import { hotScoreSql } from '../feed/hot-score.js';

/** Nombre de lignes réécrites par passe, pour lisser la charge. */
export const RANKING_BATCH_SIZE = 2_000;
/**
 * Dérive relative tolérée avant de réécrire un score.
 *
 * Le score décroît en continu : exiger une égalité stricte réécrirait presque
 * toutes les lignes à chaque passe. En ne réécrivant qu'au-delà de 0,5 % d'écart
 * (ou 1 point), la fraîcheur reste effective et la charge reste bornée.
 */
export const RANKING_DRIFT_RATIO = 0.005;

@Injectable()
export class RankingService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Supprime les sessions expirées, indépendamment du succès du classement. */
  async pruneExpiredSessions(): Promise<{
    feedSessions: number;
    commentSessions: number;
  }> {
    return this.db.transaction(async (tx) => {
      const feed = await tx
        .delete(feedSessions)
        .where(sql`${feedSessions.expiresAt} <= now()`)
        .returning({ id: feedSessions.id });
      const comments = await tx
        .delete(commentSessions)
        .where(sql`${commentSessions.expiresAt} <= now()`)
        .returning({ id: commentSessions.id });
      return { feedSessions: feed.length, commentSessions: comments.length };
    });
  }

  /**
   * Recalcule un lot de scores, y compris les publications anciennes : leur
   * score continue de décroître avec la fraîcheur. La sélection et l'écriture
   * sont atomiques et les lignes verrouillées par un autre worker sont ignorées.
   */
  async recomputeHotScores(
    options: { batchSize?: number } = {},
  ): Promise<number> {
    const batchSize = clampInt(
      options.batchSize ?? RANKING_BATCH_SIZE,
      1,
      10_000,
    );
    const formula = hotScoreSql();
    const result = await this.db.execute<{ id: string }>(sql`
      with candidates as (
        select id
        from publications
        where deleted_at is null
          and abs(hot_score - (${formula}))
              >= greatest(1, hot_score * ${RANKING_DRIFT_RATIO}::numeric)
        order by created_at desc, id
        limit ${batchSize}
        for update skip locked
      )
      update publications
      set hot_score = ${formula}
      from candidates
      where publications.id = candidates.id
      returning publications.id
    `);
    return result.rows.length;
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
