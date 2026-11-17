import { Inject, Injectable } from '@nestjs/common';
import { and, inArray, isNull, sql } from 'drizzle-orm';

import { DRIZZLE, type Database } from '../db/db.module.js';
import { feedSessions, publications } from '../db/schema.js';
import { hotScoreSql } from '../feed/hot-score.js';

/** Fenêtre « chaude » recalculée : au-delà, la fraîcheur n'a plus d'effet utile. */
export const RANKING_WINDOW_DAYS = 7;
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

/**
 * Recalcul périodique du classement (plan §8, phase 4).
 *
 * Le score matérialisé ne se dégrade pas tout seul : sans ce worker, une
 * publication sans nouvelle interaction gardait à vie le score de sa création,
 * si bien que « Pour toi » était en pratique trié par engagement cumulé et non
 * par fraîcheur. Le worker réécrit les scores de la fenêtre chaude ; la condition
 * `hot_score is distinct from <formule>` évite de réécrire des lignes inutiles, et
 * le lot borné empêche une passe de bloquer la base.
 *
 * Idempotent : rejouer une passe ne change pas le résultat.
 */
@Injectable()
export class RankingService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Supprime les sessions de fil expirées. Maintenance, appelée par le worker :
   * une session porte jusqu'à 200 identifiants, elle ne doit pas s'accumuler.
   */
  async pruneExpiredFeedSessions(): Promise<number> {
    const deleted = await this.db
      .delete(feedSessions)
      .where(sql`${feedSessions.expiresAt} <= now()`)
      .returning({ id: feedSessions.id });
    return deleted.length;
  }

  async recomputeHotScores(options: {
    windowDays?: number;
    batchSize?: number;
    now?: Date;
  } = {}): Promise<number> {
    const windowDays = clampInt(options.windowDays ?? RANKING_WINDOW_DAYS, 1, 30);
    const batchSize = clampInt(options.batchSize ?? RANKING_BATCH_SIZE, 1, 10_000);
    const formula = hotScoreSql();
    // `now()` est lu dans la transaction PostgreSQL : la borne de fenêtre et la
    // formule partagent donc exactement la même horloge.
    void options.now;

    const candidates = await this.db
      .select({ id: publications.id })
      .from(publications)
      .where(
        and(
          isNull(publications.deletedAt),
          sql`${publications.createdAt} > now() - (${windowDays} * interval '1 day')`,
          sql`abs(${publications.hotScore} - (${formula}))
              >= greatest(1, ${publications.hotScore} * ${RANKING_DRIFT_RATIO}::numeric)`,
        ),
      )
      .limit(batchSize);

    if (candidates.length === 0) {
      return 0;
    }

    await this.db
      .update(publications)
      .set({ hotScore: formula })
      .where(
        inArray(
          publications.id,
          candidates.map((row) => row.id),
        ),
      );
    return candidates.length;
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
