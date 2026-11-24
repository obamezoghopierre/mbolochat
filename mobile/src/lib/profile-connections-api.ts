import { ApiError, refreshAccessToken } from './api';
import { API_URL } from './config';
import { fr } from '@/i18n/fr';

export interface ProfileConnection {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  verified: boolean;
}

export interface ProfileConnectionsPage {
  items: ProfileConnection[];
  nextCursor: string | null;
}

const REQUEST_TIMEOUT_MS = 15_000;

export async function loadProfileConnections(
  token: string,
  userId: string,
  kind: 'followers' | 'following',
  cursor?: string,
): Promise<ProfileConnectionsPage> {
  const params = new URLSearchParams({ limit: '20' });
  if (cursor) params.set('cursor', cursor);
  const path = `/users/${encodeURIComponent(userId)}/${kind}?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const send = (accessToken: string) =>
    fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'include',
      signal: controller.signal,
    });

  try {
    let response: Response;
    try {
      response = await send(token);
    } catch {
      throw new ApiError(0, fr.social.discoverError);
    }

    if (response.status === 401) {
      try {
        response = await send(await refreshAccessToken());
      } catch {
        throw new ApiError(0, fr.social.discoverError);
      }
    }

    if (!response.ok) {
      let message: string = fr.social.followError;
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

    return (await response.json()) as ProfileConnectionsPage;
  } finally {
    clearTimeout(timeout);
  }
}
