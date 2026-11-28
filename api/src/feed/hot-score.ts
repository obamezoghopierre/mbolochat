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
 * Poids d'un partage (discussion, feuille système, lien). C'est l'intention la
 * plus forte : on recommande un contenu à quelqu'un d'autre.
 */
const SHARE_WEIGHT = 6;

/**
 * Signaux de visionnage, lus dans `publication_views` (une ligne par compte).
 *
 * - **Complétion** : la vue a atteint la fin du média. Signal de qualité le plus
 *   fiable pour un Reel, indépendant de la taille de l'audience.
 * - **Temps de visionnage** : secondes regardées, plafonnées par vue pour qu'un
 *   écran laissé allumé (ou une boucle infinie) ne fabrique pas de score. Les
 *   revisionnages au-delà de la durée restent comptés jusqu'au plafond.
 * - **Swipe rapide** : vue courte et non terminée, signal négatif. Il ne peut
 *   que réduire l'engagement, jamais le rendre négatif.
 */
export const COMPLETION_WEIGHT = 2;
/** Poids d'une seconde regardée : 30 s ≈ un like. */
export const WATCH_SECOND_WEIGHT = 0.1;
/** Plafond de temps compté par vue, en millisecondes. */
export const WATCH_CAP_PER_VIEW_MS = 60_000;
/** En dessous, une vue non terminée est un swipe rapide. */
export const QUICK_SKIP_MS = 3_000;
/** Pénalité d'un swipe rapide. */
export const QUICK_SKIP_WEIGHT = 1;

/**
 * Signaux de visionnage agrégés pour une publication (voir `watchSignalsSql`).
 * Tous facultatifs : une publication neuve n'en a aucun.
 */
export interface WatchSignals {
  /** Vues ayant atteint la fin du média. */
  completions?: number;
  /** Somme des secondes regardées, déjà plafonnée par vue. */
  watchSeconds?: number;
  /** Vues courtes non terminées. */
  quickSkips?: number;
}

/**
 * Classement du feed (plan §8).
 *
 * Le score est **matérialisé** dans `publications.hot_score` : un classement
 * recalculé à chaque requête avec `now()` dérive entre deux pages et rendrait la
 * pagination par curseur incohérente (lignes sautées ou répétées). Il est écrit à
 * la création, à chaque interaction, et **recalculé périodiquement** par
 * `RankingService` — sans ce recalcul, la fraîcheur n'aurait aucun effet sur un
 * contenu sans interaction, et le temps de visionnage (qui évolue à chaque vue)
 * ne serait jamais pris en compte.
 *
 * Formule : engagement pondéré, amorti par la fraîcheur.
 *   engagement = likes*3 + commentaires*4 + reposts*5 + saves*2 + partages*6
 *              + vues*0.5
 *              + complétions*2 + secondes_regardées*0.1 − swipes_rapides*1
 *   score = round( (max(0, engagement) + 1) / (âge_en_heures + 2)^1.5 * 1e6 )
 * Le `+1` évite qu'une publication neuve sans interaction vaille zéro.
 */
export function computeHotScore(
  counts: {
    likes: number;
    comments: number;
    reposts: number;
    saves: number;
    /** Partages (facultatif). */
    shares?: number;
    /** Vues uniques, signal de portée (facultatif). */
    views?: number;
  } & WatchSignals,
  createdAt: Date,
  now: Date = new Date(),
): number {
  const ageHours = Math.max(
    0,
    (now.getTime() - createdAt.getTime()) / 3_600_000,
  );
  const engagement =
    counts.likes * 3 +
    counts.comments * 4 +
    counts.reposts * 5 +
    counts.saves * 2 +
    (counts.shares ?? 0) * SHARE_WEIGHT +
    (counts.views ?? 0) * VIEW_WEIGHT +
    (counts.completions ?? 0) * COMPLETION_WEIGHT +
    (counts.watchSeconds ?? 0) * WATCH_SECOND_WEIGHT -
    (counts.quickSkips ?? 0) * QUICK_SKIP_WEIGHT;
  const raw = Math.round(
    ((Math.max(0, engagement) + 1) / Math.pow(ageHours + 2, 1.5)) * 1_000_000,
  );
  return Math.min(HOT_SCORE_MAX, Math.max(0, raw));
}

/**
 * Contribution des vues de la ligne courante, en SQL : une seule sous-requête
 * corrélée, servie par l'index `publication_views_publication_idx`. Même
 * pondération que `computeHotScore` (complétions, secondes plafonnées, swipes).
 */
export function watchSignalsSql() {
  return sql`coalesce((
    select sum(
      case when v.completed then ${COMPLETION_WEIGHT}::numeric else 0 end
      + least(v.watch_ms, ${WATCH_CAP_PER_VIEW_MS}::int)::numeric / 1000
        * ${WATCH_SECOND_WEIGHT}::numeric
      - case when not v.completed and v.watch_ms < ${QUICK_SKIP_MS}::int
          then ${QUICK_SKIP_WEIGHT}::numeric else 0 end
    )
    from publication_views v
    where v.publication_id = ${publications.id}
  ), 0)`;
}

/**
 * Même formule, exprimée en SQL sur les colonnes de la ligne. Utilisée après une
 * interaction et par le recalcul périodique, toujours dans la transaction qui
 * met à jour les compteurs.
 */
export function hotScoreSql() {
  return sql`least(
    round(
      ((greatest(0,
          ${publications.likeCount}::numeric * 3 + ${publications.commentCount}::numeric * 4
          + ${publications.repostCount}::numeric * 5 + ${publications.saveCount}::numeric * 2
          + ${publications.shareCount}::numeric * ${SHARE_WEIGHT}::numeric
          + ${publications.viewCount}::numeric * ${VIEW_WEIGHT}::numeric
          + ${watchSignalsSql()}
        ) + 1)
       / power(extract(epoch from (now() - ${publications.createdAt})) / 3600 + 2, 1.5))
      * 1000000
    ),
    ${HOT_SCORE_MAX}::int
  )::int`;
}
