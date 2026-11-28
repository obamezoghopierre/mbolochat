import { discoverFr } from '@/i18n/discover-fr';
import { ApiError, refreshAccessToken } from '@/lib/api';
import { API_URL } from '@/lib/config';
import type { PublicationMedia, SocialAuthor } from '@/lib/types';

export interface DiscoverPublication {
  id: string;
  kind: 'post' | 'reel';
  format: 'text' | 'image' | 'carousel' | 'video';
  caption: string | null;
  createdAt: string;
  author: Pick<SocialAuthor, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'verified'>;
  media: PublicationMedia[];
  counters: {
    likes: number;
    comments: number;
    reposts: number;
    views: number;
  };
}

/** Sections paginables de `GET /discover/sections/:section`. */
export type DiscoverPagedSection = 'popular' | 'successful' | 'breakout' | 'nearby-friends';

export interface DiscoverSectionPage {
  items: DiscoverPublication[];
  /** Curseur opaque de la page suivante, `null` en fin de liste. */
  nextCursor: string | null;
}

const REQUEST_TIMEOUT_MS = 15_000;

async function requestSection(
  token: string,
  section: DiscoverPagedSection,
  query: string,
  retried = false,
): Promise<DiscoverSectionPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${API_URL}/discover/sections/${section}?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, discoverFr.sectionLoadFailed);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 && !retried) {
    try {
      return await requestSection(
        await refreshAccessToken(),
        section,
        query,
        true,
      );
    } catch {
      // La réponse initiale reste la source de l'erreur ci-dessous.
    }
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = (await response.json()) as { message?: string | string[] };
      if (data.message) {
        message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
      }
    } catch {
      // Garde le message par défaut.
    }
    throw new ApiError(response.status, message);
  }

  try {
    return (await response.json()) as DiscoverSectionPage;
  } catch {
    throw new ApiError(0, discoverFr.sectionInvalid);
  }
}

/** Page d'une section Découvrir ; `cursor` absent pour la première page. */
export function loadDiscoverSection(
  token: string,
  section: DiscoverPagedSection,
  cursor?: string,
  limit = 20,
): Promise<DiscoverSectionPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) {
    params.set('cursor', cursor);
  }
  return requestSection(token, section, params.toString());
}
