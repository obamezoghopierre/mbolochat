import { resolveMediaUrl } from '@/lib/media-url';
import type { FeedPost } from '@/lib/types';

/**
 * URL absolue de la vidéo et de son poster.
 *
 * Isolées de `feed-media.ts` (pur, testé sans React Native) parce que la
 * résolution dépend de `API_URL`, donc de `Platform` via `expo-constants`.
 *
 * Le préchargement détaché et la page active doivent résoudre **exactement** la
 * même URL : deux URL différentes pour la même vidéo créeraient deux entrées de
 * cache disque et un second téléchargement.
 */
export function videoSourceUrl(post: FeedPost): string | null {
  const media = (post.media ?? []).find((entry) => entry.kind === 'video' && entry.url);
  return resolveMediaUrl(media?.url ?? null);
}

/** Poster (image de couverture) de la vidéo, ou `null`. */
export function videoPosterUrl(post: FeedPost): string | null {
  const media = (post.media ?? []).find((entry) => entry.kind === 'video');
  return resolveMediaUrl(media?.posterUrl ?? null);
}
