import { ApiError, refreshAccessToken, type SuggestedAccount } from '@/lib/api';
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

export interface DiscoverResponse {
  cityKnown: boolean;
  sections: {
    nearbyFriends: DiscoverPublication[];
    popular: DiscoverPublication[];
    successful: DiscoverPublication[];
    trendingHashtags: Array<{
      id: string;
      tag: string;
      usageCount: number;
      trendScore: number;
    }>;
    suggestedAccounts: SuggestedAccount[];
  };
}

export type DiscoverSectionKey = keyof DiscoverResponse['sections'];

const REQUEST_TIMEOUT_MS = 15_000;

async function requestDiscover(token: string, retried = false): Promise<DiscoverResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${API_URL}/discover`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'Impossible de charger Découvrir. Vérifie ta connexion.');
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 && !retried) {
    try {
      return await requestDiscover(await refreshAccessToken(), true);
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
    return (await response.json()) as DiscoverResponse;
  } catch {
    throw new ApiError(0, 'Réponse Découvrir invalide. Réessaie.');
  }
}

export function loadDiscover(token: string): Promise<DiscoverResponse> {
  return requestDiscover(token);
}
