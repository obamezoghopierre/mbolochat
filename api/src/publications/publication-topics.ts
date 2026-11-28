import { eq, inArray, sql } from 'drizzle-orm';

import { extractHashtags, extractTopics } from '../common/social-tags.js';
import type { Database } from '../db/db.module.js';
import {
  hashtags,
  publicationHashtags,
  publicationTopics,
} from '../db/schema.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * En dessous de ce nombre de hashtags explicites, on complète avec des sujets
 * extraits de la légende. Un auteur qui hashtague déjà bien n'en a pas besoin :
 * ses tags sont plus fiables que des mots tirés d'un texte.
 */
export const MIN_EXPLICIT_HASHTAGS = 3;

/**
 * Sujets d'une publication à partir de son texte (légende et pages).
 *
 * Fonction pure : hashtags explicites toujours, mots-clés seulement si les
 * hashtags sont rares (`MIN_EXPLICIT_HASHTAGS`). Un mot déjà présent comme
 * hashtag n'est pas répété comme sujet.
 */
export function topicsForText(text: string): {
  hashtags: string[];
  topics: string[];
} {
  const explicit = extractHashtags(text);
  if (explicit.length >= MIN_EXPLICIT_HASHTAGS) {
    return { hashtags: explicit, topics: [] };
  }
  const taken = new Set(explicit);
  return {
    hashtags: explicit,
    topics: extractTopics(text).filter((topic) => !taken.has(topic)),
  };
}

/**
 * Remplace les sujets d'une publication par ceux de son texte, dans la
 * transaction de l'appelant.
 *
 * - Les liens sont **remplacés**, pas empilés : un tag retiré de la légende à
 *   la modification ne doit pas rester.
 * - Le catalogue `hashtags` (recherche, tendances) n'est compté qu'une fois par
 *   publication **publique** : un post `followers` ou `private` ne doit pas
 *   faire monter un hashtag visible de tous. Le lien est écrit dans tous les
 *   cas, le classement en a besoin.
 * - Le compteur ne monte que pour les tags **nouvellement rattachés** (absents
 *   des liens précédents) : à la création, tous ; à la modification, seulement
 *   ceux que la retouche ajoute. Retoucher une faute de frappe ne gonfle donc
 *   pas les tendances.
 */
export async function syncPublicationTopics(
  tx: Tx,
  publicationId: string,
  text: string,
  options: { isPublic: boolean },
): Promise<void> {
  const { hashtags: tags, topics } = topicsForText(text);

  const previous = await tx
    .select({ hashtagId: publicationHashtags.hashtagId })
    .from(publicationHashtags)
    .where(eq(publicationHashtags.publicationId, publicationId));
  const previousIds = new Set(previous.map((row) => row.hashtagId));

  await tx
    .delete(publicationHashtags)
    .where(eq(publicationHashtags.publicationId, publicationId));
  await tx
    .delete(publicationTopics)
    .where(eq(publicationTopics.publicationId, publicationId));

  if (tags.length > 0) {
    // Le catalogue : crée les tags manquants sans toucher à leur compteur.
    await tx
      .insert(hashtags)
      .values(tags.map((tag) => ({ tag, usageCount: 0 })))
      .onConflictDoNothing();
    const rows = await tx
      .select({ id: hashtags.id })
      .from(hashtags)
      .where(inArray(hashtags.tag, tags));
    if (rows.length > 0) {
      await tx
        .insert(publicationHashtags)
        .values(
          rows.map((row) => ({ publicationId, hashtagId: row.id })),
        )
        .onConflictDoNothing();
    }
    if (options.isPublic) {
      const fresh = rows.filter((row) => !previousIds.has(row.id));
      if (fresh.length > 0) {
        await tx
          .update(hashtags)
          .set({
            usageCount: sql`${hashtags.usageCount} + 1`,
            updatedAt: new Date(),
          })
          .where(
            inArray(
              hashtags.id,
              fresh.map((row) => row.id),
            ),
          );
      }
    }
  }

  if (topics.length > 0) {
    await tx
      .insert(publicationTopics)
      .values(topics.map((topic) => ({ publicationId, topic })))
      .onConflictDoNothing();
  }
}
