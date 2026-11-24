import { ApiError } from './api';
import { API_URL } from './config';
import { messagesSearchFr } from '@/i18n/messages-search-fr';
import { refreshAccessToken } from './token-refresh';
import type { Gender } from './types';

export interface FriendSearchResult {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  gender: Gender | null;
}

const FRIEND_SEARCH_TIMEOUT_MS = 15_000;

/** Recherche les abonnements mutuels acceptés, sans utiliser la recherche globale. */
export async function searchFriends(
  token: string,
  query: string,
): Promise<FriendSearchResult[]> {
  const params = new URLSearchParams({ q: query.trim(), limit: '20' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FRIEND_SEARCH_TIMEOUT_MS);
  const send = (accessToken: string) =>
    fetch(`${API_URL}/users/me/friends?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'include',
      signal: controller.signal,
    });

  try {
    let response: Response;
    try {
      response = await send(token);
    } catch {
      throw new ApiError(0, messagesSearchFr.offline);
    }

    if (response.status === 401) {
      let freshToken: string;
      try {
        freshToken = await refreshAccessToken();
      } catch {
        throw new ApiError(401, messagesSearchFr.error);
      }
      try {
        response = await send(freshToken);
      } catch {
        throw new ApiError(0, messagesSearchFr.offline);
      }
    }

    if (!response.ok) {
      let message = messagesSearchFr.error;
      try {
        const body = (await response.json()) as { message?: string | string[] };
        if (body.message) {
          message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
        }
      } catch {
        // Le message local reste disponible si la réponse n'est pas du JSON.
      }
      throw new ApiError(response.status, message);
    }

    try {
      return (await response.json()) as FriendSearchResult[];
    } catch {
      throw new ApiError(0, messagesSearchFr.error);
    }
  } finally {
    clearTimeout(timeout);
  }
}
