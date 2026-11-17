import { sql } from 'drizzle-orm';

import { publications } from '../db/schema.js';

/**
 * Plafond du score matérialisé.
 *
 * `publications.hot_score` est un `integer` (max 2 147 483 647) et la formule
 * multiplie par `1e6` : un contenu viral très jeune dépassait la borne et faisait
 * échouer l'écriture du score (donc la réaction, dans la même transaction). On
 * borne donc explicitement des deux côtés, en TypeScript comme en SQL.
 */
export const HOT_SCORE_MAX = 2_000_000_000;

/** Poids de la portée (vues uniques) dans l'engagement. Volontairement faible. */
const VIEW_WEIGHT = 0.5;

/**
 * Classement du feed (plan §8).
 *
 * Le score est **matérialisé** dans `publications.hot_score` : un classement
 * recalculé à chaque requête avec `now()` dérive entre deux pages et rendrait la
 * pagination par curseur incohérente (lignes sautées ou répétées). Il est écrit à
 * la création, à chaque interaction, et **recalculé périodiquement** par
 * `RankingService` — sans ce recalcul, la fraîcheur n'aurait aucun effet sur un
 * contenu sans interaction.
 *
 * Formule : engagement pondéré, amorti par la fraîcheur.
 *   score = round( (likes*3 + commentaires*4 + reposts*5 + saves*2 + vues*0.5 + 1)
 *                  / (âge_en_heures + 2)^1.5 * 1e6 )
 * Le `+1` évite qu'une publication neuve sans interaction vaille zéro.
 */
export function computeHotScore(
  counts: {
    likes: number;
    comments: number;
    reposts: number;
    saves: number;
    /** Vues uniques, signal de portée (facultatif). */
    views?: number;
  },
  createdAt: Date,
  now: Date = new Date(),
): number {
  const ageHours = Math.max(0, (now.getTime() - createdAt.getTime()) / 3_600_000);
  const engagement =
    counts.likes * 3 +
    counts.comments * 4 +
    counts.reposts * 5 +
    counts.saves * 2 +
    (counts.views ?? 0) * VIEW_WEIGHT;
  const raw = Math.round(((engagement + 1) / Math.pow(ageHours + 2, 1.5)) * 1_000_000);
  return Math.min(HOT_SCORE_MAX, Math.max(0, raw));
}

/**
 * Même formule, exprimée en SQL sur les colonnes de la ligne. Utilisée après une
 * interaction et par le recalcul périodique, toujours dans la transaction qui
 * met à jour les compteurs.
 */
export function hotScoreSql() {
  return sql`least(
    round(
      ((${publications.likeCount} * 3 + ${publications.commentCount} * 4
        + ${publications.repostCount} * 5 + ${publications.saveCount} * 2
        + ${publications.viewCount} * ${VIEW_WEIGHT}::numeric + 1)
       / power(extract(epoch from (now() - ${publications.createdAt})) / 3600 + 2, 1.5))
      * 1000000
    ),
    ${HOT_SCORE_MAX}::int
  )::int`;
}
