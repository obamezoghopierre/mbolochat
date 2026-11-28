import { eq, sql } from 'drizzle-orm';

import type { Database } from '../db/db.module.js';
import {
  hashtags,
  publicationHashtags,
  publicationTopics,
  userInterests,
} from '../db/schema.js';

type Executor = Pick<Database, 'select'>;

/**
 * Actions du spectateur qui nourrissent ses intérêts.
 *
 * Même logique qu'Instagram : l'**activité du spectateur** est le premier signal
 * de son classement (ce qu'il regarde, aime, enregistre, partage). Les poids sont
 * des valeurs de départ : Instagram ne publie pas les siens, et ils devront être
 * ajustés avec les données réelles.
 */
export type InterestAction =
  | 'watch'
  | 'complete'
  | 'like'
  | 'save'
  | 'share'
  | 'comment'
  | 'repost'
  | 'skip';

/**
 * Poids d'une action sur un sujet.
 *
 * - **Envoyer** à quelqu'un est le signal le plus fort : une recommandation
 *   personnelle (c'est ce que dit Instagram des envois).
 * - **Enregistrer** vient ensuite : le spectateur veut y revenir.
 * - **Terminer** un contenu vaut plus qu'un like : on ne regarde pas jusqu'au bout
 *   ce qui ne nous intéresse pas.
 * - **Zapper** (vue très courte) est négatif, mais faible : un swipe peut n'être
 *   qu'un mauvais moment.
 */
export const INTEREST_WEIGHTS: Readonly<Record<InterestAction, number>> = {
  share: 6,
  save: 4,
  repost: 4,
  comment: 3,
  complete: 3,
  like: 2,
  watch: 1,
  skip: -1,
};

/** Un score ne dépasse jamais cette borne : un sujet ne peut pas tout écraser. */
export const INTEREST_SCORE_MAX = 100;
/** Ni ne descend sous celle-ci : on n'efface pas un sujet sur un seul swipe. */
export const INTEREST_SCORE_MIN = -10;

/**
 * Demi-vie d'un intérêt, en jours. Après ce délai sans nouvelle action, un
 * intérêt vaut moitié moins : les goûts évoluent, et un sujet regardé une fois
 * il y a des mois ne doit plus orienter le fil.
 */
export const INTEREST_HALF_LIFE_DAYS = 14;
/** En dessous de cette valeur absolue, un intérêt décroît jusqu'à disparaître. */
export const INTEREST_FLOOR = 0.25;
/** Temps de visionnage minimal (ms) pour compter une vue comme un intérêt. */
export const WATCH_INTEREST_MIN_MS = 3_000;
/** Une vue plus courte que cela, non terminée, est un zap. */
export const SKIP_MAX_MS = 1_500;

/** Un sujet ciblé : hashtag explicite ou mot-clé implicite. */
export type InterestKind = 'hashtag' | 'topic';

/**
 * Action déduite d'une vue : zap, simple vue, ou vue terminée.
 *
 * Fonction pure. `null` : trop court pour être un signal exploitable (ni intérêt
 * ni désintérêt), par exemple une vue de 2 s.
 */
export function actionForView(
  watchedMs: number,
  completed: boolean,
): InterestAction | null {
  if (completed) {
    return 'complete';
  }
  if (watchedMs >= WATCH_INTEREST_MIN_MS) {
    return 'watch';
  }
  if (watchedMs <= SKIP_MAX_MS) {
    return 'skip';
  }
  return null;
}

/**
 * Valeur d'un score après décroissance.
 *
 * Demi-vie exponentielle : `score * 0.5^(jours / demi-vie)`. Un score devenu
 * négligeable tombe à zéro pour que la table ne se remplisse pas de sujets morts.
 */
export function decayedScore(
  score: number,
  elapsedMs: number,
  halfLifeDays: number = INTEREST_HALF_LIFE_DAYS,
): number {
  if (!Number.isFinite(score) || score === 0) {
    return 0;
  }
  const days = Math.max(0, elapsedMs) / 86_400_000;
  const value = score * Math.pow(0.5, days / halfLifeDays);
  return Math.abs(value) < INTEREST_FLOOR ? 0 : value;
}

/** Nouveau score : décroissance de l'ancien, ajout du poids, puis bornes. */
export function nextScore(
  current: number,
  elapsedMs: number,
  action: InterestAction,
): number {
  const aged = decayedScore(current, elapsedMs);
  const raw = aged + INTEREST_WEIGHTS[action];
  return Math.min(INTEREST_SCORE_MAX, Math.max(INTEREST_SCORE_MIN, raw));
}

/** Sujets (hashtags et mots-clés) rattachés à une publication. */
export async function loadPublicationSubjects(
  db: Executor,
  publicationId: string,
): Promise<Array<{ kind: InterestKind; subject: string }>> {
  const [tags, topics] = await Promise.all([
    db
      .select({ tag: hashtags.tag })
      .from(publicationHashtags)
      .innerJoin(hashtags, eq(hashtags.id, publicationHashtags.hashtagId))
      .where(eq(publicationHashtags.publicationId, publicationId)),
    db
      .select({ topic: publicationTopics.topic })
      .from(publicationTopics)
      .where(eq(publicationTopics.publicationId, publicationId)),
  ]);
  return [
    ...tags.map((row) => ({ kind: 'hashtag' as const, subject: row.tag })),
    ...topics.map((row) => ({ kind: 'topic' as const, subject: row.topic })),
  ];
}

/**
 * Enregistre une action du spectateur sur tous les sujets d'une publication.
 *
 * Une seule requête SQL (upsert) : la décroissance et les bornes sont calculées
 * côté base, avec la même formule que `nextScore`, pour que deux actions
 * simultanées du même utilisateur ne s'écrasent pas (pas de lecture puis
 * écriture côté application).
 *
 * Ne lève jamais : la collecte d'intérêts est secondaire, elle ne doit pas faire
 * échouer un like ou une vue. L'appelant l'exécute donc **hors de sa
 * transaction**, et l'échec est silencieux.
 */
export async function recordInterest(
  db: Database,
  userId: string,
  publicationId: string,
  action: InterestAction,
): Promise<void> {
  try {
    const subjects = await loadPublicationSubjects(db, publicationId);
    if (subjects.length === 0) {
      return;
    }
    const weight = INTEREST_WEIGHTS[action];
    const rows = subjects.map((entry) => ({
      userId,
      kind: entry.kind,
      subject: entry.subject,
      score: Math.min(
        INTEREST_SCORE_MAX,
        Math.max(INTEREST_SCORE_MIN, weight),
      ),
    }));
    const decayed = sql`${userInterests.score} * power(0.5,
      extract(epoch from (now() - ${userInterests.updatedAt})) / 86400
      / ${INTEREST_HALF_LIFE_DAYS}::numeric)`;
    await db
      .insert(userInterests)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          userInterests.userId,
          userInterests.kind,
          userInterests.subject,
        ],
        set: {
          score: sql`least(${INTEREST_SCORE_MAX}::numeric, greatest(${INTEREST_SCORE_MIN}::numeric,
            (case when abs(${decayed}) < ${INTEREST_FLOOR}::numeric then 0 else ${decayed} end)
            + ${weight}::numeric))`,
          updatedAt: sql`now()`,
        },
      });
  } catch {
    // Signal secondaire : un échec ne doit jamais remonter à l'utilisateur.
  }
}

/**
 * Purge des intérêts : retire ceux dont la valeur **décroissée** est négligeable.
 *
 * Appelée périodiquement par le worker (`RankingService`), jamais dans la
 * requête d'un utilisateur. La décroissance n'est appliquée qu'à l'écriture ; sans
 * cette purge, les sujets d'un utilisateur inactif resteraient indéfiniment avec
 * un score périmé.
 */
export async function purgeStaleInterests(db: Database): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    delete from user_interests
    where abs(
      score * power(0.5,
        extract(epoch from (now() - updated_at)) / 86400
        / ${INTEREST_HALF_LIFE_DAYS}::numeric)
    ) < ${INTEREST_FLOOR}::numeric
    returning id
  `);
  return result.rows.length;
}
