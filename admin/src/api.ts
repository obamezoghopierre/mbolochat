/** Client HTTP du back-office. Le jeton est conservé en session locale. */

const TOKEN_KEY = 'mbolochat-admin-token';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `Erreur ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: 'user' | 'moderator' | 'admin';
}

export interface ReportItem {
  id: string;
  targetType: 'publication' | 'comment' | 'story' | 'user';
  targetId: string;
  reason: string;
  details: string | null;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  createdAt: string;
  reporter: { id: string; username: string; displayName: string } | null;
  targetPreview: string | null;
  targetAuthorId: string | null;
}

export interface ReportPage {
  items: ReportItem[];
  nextCursor: string | null;
}

export interface AuditItem {
  id: string;
  targetType: string;
  targetId: string;
  action: string;
  notes: string | null;
  createdAt: string;
  moderatorId: string | null;
}

export interface FlaggedItem {
  id: string;
  format: 'text' | 'image' | 'carousel' | 'video';
  visibility: 'public' | 'followers' | 'private';
  createdAt: string;
  author: { id: string; username: string; displayName: string };
  preview: string | null;
  openReports: number;
}

export const api = {
  login(emailOrUsername: string, password: string) {
    return request<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ emailOrUsername, password }),
    });
  },

  me() {
    return request<AdminUser>('/users/me');
  },

  reports(status: string, cursor?: string) {
    const query = new URLSearchParams({ status, limit: '20' });
    if (cursor) query.set('cursor', cursor);
    return request<ReportPage>(`/admin/reports?${query.toString()}`);
  },

  decide(reportId: string, action: string, notes?: string) {
    return request<{ status: string }>(`/admin/reports/${reportId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ action, notes }),
    });
  },

  /** Publications en revue (mot bloqué ou masquées), signalées ou non. */
  flagged(cursor?: string) {
    const query = new URLSearchParams({ limit: '20' });
    if (cursor) query.set('cursor', cursor);
    return request<{ items: FlaggedItem[]; nextCursor: string | null }>(
      `/admin/flagged?${query.toString()}`,
    );
  },

  decideFlagged(publicationId: string, decision: 'approve' | 'remove') {
    return request<{ moderationStatus: string }>(`/admin/flagged/${publicationId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
  },

  users(query: string) {
    return request<
      Array<{
        id: string;
        username: string;
        displayName: string;
        role: string;
        verified: boolean;
        privateAccount: boolean;
        createdAt: string;
      }>
    >(`/admin/users?q=${encodeURIComponent(query)}`);
  },

  blockedWords() {
    return request<Array<{ id: string; word: string; active: boolean; createdAt: string }>>(
      '/admin/blocked-words',
    );
  },

  addBlockedWord(word: string) {
    return request<{ id: string; word: string }>('/admin/blocked-words', {
      method: 'POST',
      body: JSON.stringify({ word }),
    });
  },

  removeBlockedWord(id: string) {
    return request<{ deleted: true }>(`/admin/blocked-words/${id}`, { method: 'DELETE' });
  },

  audit(cursor?: string) {
    const query = new URLSearchParams({ limit: '20' });
    if (cursor) query.set('cursor', cursor);
    return request<{ items: AuditItem[]; nextCursor: string | null }>(
      `/admin/audit?${query.toString()}`,
    );
  },
};
