import { sql } from 'drizzle-orm';

import { publications } from '../db/schema.js';

/**
 * Classement du feed (plan §8).
 *
 * Le score est **matérialisé** dans `publications.hot_score` : un classement
 * recalculé à chaque requête avec `now()` dérive entre deux pages et rendrait la
 * pagination par curseur incohérente (lignes sautées ou répétées). Le worker de
 * la phase 1 le recalcule périodiquement ; en attendant, il est mis à jour à la
 * création et à chaque interaction.
 *
 * Formule : engagement pondéré, amorti par la fraîcheur.
 *   score = round( (likes*3 + commentaires*4 + reposts*5 + saves*2 + 1)
 *                  / (âge_en_heures + 2)^1.5 * 1e6 )
 * Le `+1` évite qu'une publication neuve sans interaction vaille zéro.
 */
export function computeHotScore(
  counts: { likes: number; comments: number; reposts: number; saves: number },
  createdAt: Date,
  now: Date = new Date(),
): number {
  const ageHours = Math.max(0, (now.getTime() - createdAt.getTime()) / 3_600_000);
  const engagement =
    counts.likes * 3 + counts.comments * 4 + counts.reposts * 5 + counts.saves * 2;
  return Math.round(((engagement + 1) / Math.pow(ageHours + 2, 1.5)) * 1_000_000);
}

/**
 * Même formule, exprimée en SQL sur les colonnes de la ligne. Utilisée après une
 * interaction, dans la transaction qui met à jour les compteurs.
 */
export function hotScoreSql() {
  return sql<number>`round(
    ((${publications.likeCount} * 3 + ${publications.commentCount} * 4
      + ${publications.repostCount} * 5 + ${publications.saveCount} * 2 + 1)
     / power(extract(epoch from (now() - ${publications.createdAt})) / 3600 + 2, 1.5))
    * 1000000
  )`;
}
