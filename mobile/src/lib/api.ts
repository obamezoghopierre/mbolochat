import { File } from 'expo-file-system';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { API_URL } from './config';
import { refreshAccessToken } from './token-refresh';
import type {
  AuthResult,
  CommentPage,
  CommentReactionKind,
  CommentSort,
  ConversationLinkItem,
  ConversationMediaItem,
  ConversationSearchHit,
  ConversationSummary,
  DeviceSession,
  FeedPage,
  FeedTab,
  SaveCollection,
  FollowState,
  ForgotPasswordResult,
  Gender,
  LocationUpdateResult,
  GroupInvite,
  InvitePreview,
  JoinInviteResult,
  JoinRequest,
  Message,
  MessageReceipt,
  PresenceSettings,
  PublicationComment,
  PresenceSnapshot,
  SocialMediaAsset,
  SocialUploadTicket,
  ReportReason,
  ResetPasswordResult,
  SearchHashtag,
  SearchResult,
  SocialNotificationPage,
  SocialReaction,
  SocialVisibility,
  FeedPost,
  UploadResult,
  User,
  UserProfile,
  UserSettings,
} from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  _retried?: boolean;
}

/** Nom lisible de l'appareil, pour la liste des sessions. */
function deviceHeaders(): Record<string, string> {
  return {
    'x-device-name': (Device.modelName ?? Device.deviceName ?? 'Appareil').slice(0, 80),
    'x-platform': Platform.OS,
  };
}

const REQUEST_TIMEOUT_MS = 15000;

export { refreshAccessToken } from './token-refresh';

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.headers ?? {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'include',
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    throw new ApiError(
      0,
      `Impossible de contacter le serveur (${API_URL || 'même origine'}). Vérifie ta connexion et que l'API est démarrée.`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 && !options._retried && path !== '/auth/refresh' && path !== '/auth/login' && path !== '/auth/register') {
    try {
      const newToken = await refreshAccessToken();
      return request<T>(path, { ...options, token: newToken, _retried: true });
    } catch {
      // fall through to throw original
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
      // keep default message
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const contentType = response.headers.get('content-type') ?? 'type inconnu';
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new ApiError(
      0,
      `Réponse inattendue (statut ${response.status}, ${contentType}) — début : « ${preview} »`,
    );
  }
}

/** MIME probable d'un fichier local d'après son extension. */
function guessMime(uri: string, kind: 'image' | 'video' | 'audio'): string {
  const ext = (uri.split('?')[0].split('.').pop() ?? '').toLowerCase();
  const table: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    avif: 'image/avif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    '3gp': 'video/3gpp',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
  };
  return table[ext] ?? (kind === 'image' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'audio/mp4');
}

/** Résultat de recherche GIF (aperçu léger + version envoyée). */
export interface GifResult {
  id: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
  title: string;
}

/** Compte proposé dans « Suggestions pour toi ». */
export interface SuggestedAccount {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
  followerCount: number;
  /** Nombre de tes abonnements qui suivent ce compte. */
  mutualCount: number;
}

export const api = {
  register(body: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    birthday: string;
    gender: Gender;
    /** Libellé libre, envoyé uniquement pour le genre « Personnalisé ». */
    genderCustom?: string;
  }) {
    return request<AuthResult>('/auth/register', {
      method: 'POST',
      body,
      headers: deviceHeaders(),
    });
  },

  login(body: { emailOrUsername: string; password: string }) {
    return request<AuthResult>('/auth/login', {
      method: 'POST',
      body,
      headers: deviceHeaders(),
    });
  },

  /** Suit un compte ; un compte privé renvoie `pending`. */
  followUser(token: string, userId: string) {
    return request<FollowState>(`/users/${userId}/follow`, { method: 'POST', token });
  },

  /** Ne plus suivre, ou annule une demande en attente. */
  unfollowUser(token: string, userId: string) {
    return request<FollowState>(`/users/${userId}/follow`, { method: 'DELETE', token });
  },

  /** Détail d'une publication (visibilité vérifiée par le serveur). */
  publication(token: string, publicationId: string) {
    return request<FeedPost>(`/publications/${publicationId}`, { token });
  },

  /**
   * Crée une publication. `quotedPublicationId` en fait une citation
   * (« Citer ») : les médias de l'originale sont copiés côté serveur.
   * Idempotent par `clientId`.
   */
  createPublication(
    token: string,
    body: {
      clientId: string;
      caption?: string;
      quotedPublicationId?: string;
      visibility?: SocialVisibility;
      /** Médias déjà téléversés et `ready` (image/vidéo, jamais mélangés). */
      assetIds?: string[];
      /** Post texte : fond de carte, pages (multi-cartes), police, alignement. */
      textBackground?: string;
      textPages?: string[];
      /** Style par page (fond/couleur), aligné sur `textPages`. */
      textPageStyles?: ({ background?: string; color?: string; font?: string; align?: string; size?: number } | null)[];
      textFont?: string;
      textAlign?: string;
      textColor?: string;
      /** Titre facultatif du post texte (champ dédié). */
      textTitle?: string;
      /** Taille manuelle du post texte en points (16–64), absent = auto. */
      textSize?: number;
      /** Lieu facultatif du post texte (≤ 100 caractères). */
      location?: string;
      commentsDisabled?: boolean;
      hideLikeCount?: boolean;
      /** Filtre visuel d'une publication média (clé de `MEDIA_FILTERS`). */
      mediaFilter?: string;
    },
  ) {
    return request<FeedPost>('/publications', { method: 'POST', token, body });
  },

  /**
   * Modifie sa propre publication : tous les champs sont optionnels
   * (`undefined` = inchangé, `textTitle: null` efface le titre).
   */
  updatePublication(
    token: string,
    publicationId: string,
    body: {
      caption?: string;
      /** Médias gardés, dans le nouvel ordre (retirer / réordonner seulement). */
      mediaAssetIds?: string[];
      commentsDisabled?: boolean;
      hideLikeCount?: boolean;
      textPages?: string[];
      /** Style par page, aligné sur `textPages` (ou pages existantes). */
      textPageStyles?: ({ background?: string; color?: string; font?: string; align?: string; size?: number } | null)[];
      textTitle?: string | null;
      textBackground?: string;
      textFont?: string;
      textAlign?: string;
      textColor?: string | null;
      /** Taille manuelle en points ; `null` revient à l'auto-ajustement. */
      textSize?: number | null;
      /** Lieu du post texte ; `null` ou vide l'efface. */
      location?: string | null;
    },
  ) {
    return request<FeedPost>(`/publications/${publicationId}`, {
      method: 'PATCH',
      token,
      body,
    });
  },

  /** Géocodage inverse : nom de ville/pays pour taguer un lieu. */
  reverseGeo(token: string, latitude: number, longitude: number) {
    return request<{ city: string; country: string | null } | null>(
      `/users/geo/reverse?latitude=${latitude}&longitude=${longitude}`,
      { token },
    );
  },

  /** Suggestions de villes pour le champ lieu du compositeur. */
  geoSearch(token: string, query: string) {
    return request<{ city: string; country: string | null }[]>(
      `/users/geo/search?q=${encodeURIComponent(query)}`,
      { token },
    );
  },

  /** Supprime sa propre publication. */
  deletePublication(token: string, publicationId: string) {
    return request<{ deleted: true }>(`/publications/${publicationId}`, {
      method: 'DELETE',
      token,
    });
  },

  /** Signale un contenu ou un compte (file de modération côté serveur). */
  report(token: string, targetType: 'publication' | 'comment' | 'story' | 'user', targetId: string, reason: ReportReason, details?: string) {
    return request<{ id: string }>('/reports', {
      method: 'POST',
      token,
      body: { targetType, targetId, reason, details },
    });
  },

  /** Commentaires d'une publication : `top` (pertinence) ou `recent`. */
  comments(
    token: string,
    publicationId: string,
    options?: { cursor?: string; sort?: CommentSort },
  ) {
    const params = new URLSearchParams();
    if (options?.cursor) {
      params.set('cursor', options.cursor);
    }
    if (options?.sort && options.sort !== 'top') {
      params.set('sort', options.sort);
    }
    const query = params.size > 0 ? `?${params.toString()}` : '';
    return request<CommentPage>(`/publications/${publicationId}/comments${query}`, { token });
  },

  /** Réponses directes d'un commentaire, du plus ancien au plus récent. */
  commentReplies(token: string, commentId: string, cursor?: string) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return request<CommentPage>(`/comments/${commentId}/replies${query}`, { token });
  },

  /** Épingle ou désépingle un commentaire racine (auteur de la publication). */
  pinComment(token: string, commentId: string, pinned: boolean) {
    return request<PublicationComment>(`/comments/${commentId}/pin`, {
      method: pinned ? 'POST' : 'DELETE',
      token,
    });
  },

  /** Réaction emoji sur un commentaire ; `null` retire la réaction du visiteur. */
  reactComment(token: string, commentId: string, kind: CommentReactionKind | null) {
    return request<PublicationComment>(`/comments/${commentId}/react`, {
      method: kind === null ? 'DELETE' : 'POST',
      token,
      body: kind === null ? undefined : { kind },
    });
  },

  /** Suppression d'un commentaire (auteur ou auteur de la publication). */
  deleteComment(token: string, commentId: string) {
    return request<{ deleted: true }>(`/comments/${commentId}`, { method: 'DELETE', token });
  },

  /** J'aime sur un commentaire, idempotent côté serveur. */
  likeComment(token: string, commentId: string, liked: boolean) {
    return request<PublicationComment>(`/comments/${commentId}/like`, {
      method: liked ? 'POST' : 'DELETE',
      token,
    });
  },

  /** « Je n'aime pas » sur un commentaire, idempotent et exclusif du j'aime. */
  dislikeComment(token: string, commentId: string, disliked: boolean) {
    return request<PublicationComment>(`/comments/${commentId}/dislike`, {
      method: disliked ? 'POST' : 'DELETE',
      token,
    });
  },

  /** Ajout d'un commentaire, idempotent par `clientId`. */
  addComment(
    token: string,
    publicationId: string,
    input: {
      clientId: string;
      body?: string;
      parentId?: string;
      mediaAssetId?: string;
      voiceMediaAssetId?: string;
      stickerRef?: string;
    },
  ) {
    return request<PublicationComment>(`/publications/${publicationId}/comments`, {
      method: 'POST',
      token,
      body: input,
    });
  },

  /** Ticket d'écriture présignée pour un média social (image, vidéo, audio). */
  createSocialUpload(
    token: string,
    input: {
      kind: 'image' | 'video' | 'audio';
      mime: string;
      sizeBytes: number;
      durationMs?: number;
    },
  ) {
    return request<SocialUploadTicket>('/media/uploads', {
      method: 'POST',
      token,
      body: input,
    });
  },

  /** Confirme l'upload : le serveur vérifie taille et signature réelles. */
  completeSocialUpload(token: string, assetId: string) {
    return request<SocialMediaAsset>(`/media/uploads/${assetId}/complete`, {
      method: 'POST',
      token,
    });
  },

  /** État d'un asset : `uploaded` puis `ready` quand le worker a fini. */
  socialMediaAsset(token: string, assetId: string) {
    return request<SocialMediaAsset>(`/media/uploads/${assetId}`, { token });
  },

  /**
   * Upload complet d'un média social pour commentaire : ticket → PUT
   * présigné → confirmation. Renvoie l'asset `ready` à référencer par
   * `mediaAssetId`.
   */
  async uploadSocialMedia(
    token: string,
    input: {
      uri: string;
      kind: 'image' | 'video' | 'audio';
      mime: string;
      durationMs?: number;
      sizeBytes?: number;
    },
  ): Promise<SocialMediaAsset> {
    let asset = input;
    // Photo HEIC/HEIF/AVIF (iPhone, Android récents) : convertie en JPEG sur
    // l'appareil, comme Instagram, pour être lue partout.
    if (asset.kind === 'image' && /hei[cf]|avif/i.test(`${asset.mime} ${asset.uri}`)) {
      const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
      const converted = await manipulateAsync(asset.uri, [], {
        compress: 0.9,
        format: SaveFormat.JPEG,
      });
      asset = { ...asset, uri: converted.uri, mime: 'image/jpeg', sizeBytes: undefined };
    }
    // MIME manquant ou générique : déduit de l'extension. Le serveur lit de
    // toute façon les octets réels et corrige l'étiquette.
    if (!asset.mime || asset.mime === 'application/octet-stream' || !asset.mime.includes('/')) {
      asset = { ...asset, mime: guessMime(asset.uri, asset.kind) };
    }
    const sizeBytes = asset.sizeBytes ?? new File(asset.uri).size ?? 0;
    const ticket = await api.createSocialUpload(token, {
      kind: asset.kind,
      mime: asset.mime,
      sizeBytes,
      durationMs: asset.durationMs,
    });
    // PUT présigné : le fichier part directement au stockage, hors de l'API.
    // `uploadAsync` (API legacy) est le seul chemin RN qui envoie un binaire
    // avec une méthode PUT explicite.
    const { uploadAsync, FileSystemUploadType } = await import(
      'expo-file-system/legacy'
    );
    const result = await uploadAsync(ticket.uploadUrl, asset.uri, {
      httpMethod: 'PUT',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': ticket.contentType },
    });
    if (result.status < 200 || result.status >= 300) {
      throw new ApiError(result.status, 'Envoi du média impossible.');
    }
    return api.completeSocialUpload(token, ticket.id);
  },

  /** GIF (GIPHY via l'API) : tendances sans `query`. */
  searchGifs(token: string, query: string, offset = 0) {
    const params = new URLSearchParams({ q: query, offset: String(offset) });
    return request<{ items: GifResult[]; nextOffset: number | null }>(
      `/media/uploads/gifs/search?${params.toString()}`,
      { token },
    );
  },

  /** Importe un GIF choisi comme média du compte (commentaire). */
  importGif(token: string, giphyId: string) {
    return request<SocialMediaAsset>(`/media/uploads/gifs/${encodeURIComponent(giphyId)}`, {
      method: 'POST',
      token,
    });
  },

  /** « Suggestions pour toi » : comptes à suivre. */
  suggestedAccounts(token: string, limit = 12) {
    return request<SuggestedAccount[]>(`/feed/suggested-accounts?limit=${limit}`, { token });
  },

  /** Épingle / désépingle une publication en tête de son profil. */
  pinPublication(token: string, publicationId: string, pinned: boolean) {
    return request<FeedPost>(`/publications/${publicationId}/pin`, {
      method: pinned ? 'POST' : 'DELETE',
      token,
    });
  },

  /**
   * Recherche unifiée : comptes, publications et hashtags. `type: 'all'` rend
   * un aperçu de chaque bloc ; un type précis se pagine avec `cursor`.
   */
  search(
    token: string,
    query: string,
    type: 'all' | 'users' | 'publications' | 'hashtags' = 'all',
    options: { cursor?: string; limit?: number } = {},
  ) {
    const params = new URLSearchParams({
      q: query,
      type,
      limit: String(options.limit ?? 10),
    });
    if (options.cursor) {
      params.set('cursor', options.cursor);
    }
    return request<SearchResult>(`/search?${params.toString()}`, { token });
  },

  /** Hashtags les plus utilisés, pour l'écran Découvrir. */
  trendingHashtags(token: string) {
    return request<SearchHashtag[]>('/hashtags/trending?limit=20', { token });
  },

  /** Activité : notifications sociales, du plus récent au plus ancien. */
  notifications(token: string, cursor?: string) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return request<SocialNotificationPage>(`/social/notifications${query}`, { token });
  },

  /** Marque tout comme lu, ou seulement les identifiants fournis. */
  markNotificationsRead(token: string, ids?: string[]) {
    return request<{ updated: number }>('/social/notifications/read', {
      method: 'POST',
      token,
      body: ids ? { ids } : {},
    });
  },

  /**
   * Fil social : Pour toi, Abonnements ou Local, avec curseur. `format`
   * filtre côté serveur (`video` = fil dédié des Reels).
   */
  feed(token: string, tab: FeedTab, cursor?: string, format?: 'video') {
    const query = new URLSearchParams({ tab, limit: '20' });
    if (cursor) {
      query.set('cursor', cursor);
    }
    if (format) {
      query.set('format', format);
    }
    return request<FeedPage>(`/feed?${query.toString()}`, { token });
  },

  /** Réaction à une publication (une seule par compte, type modifiable). */
  reactToPublication(token: string, publicationId: string, kind: SocialReaction = 'like') {
    return request<{ reaction: SocialReaction; likeCount: number }>(
      `/publications/${publicationId}/like`,
      { method: 'POST', token, body: { kind } },
    );
  },

  removeReaction(token: string, publicationId: string) {
    return request<{ reaction: null; likeCount: number }>(
      `/publications/${publicationId}/like`,
      { method: 'DELETE', token },
    );
  },

  /** Enregistre la publication dans les signets, idempotent. */
  savePublication(token: string, publicationId: string) {
    return request<{ saved: boolean; saveCount: number }>(
      `/publications/${publicationId}/save`,
      { method: 'POST', token },
    );
  },

  unsavePublication(token: string, publicationId: string) {
    return request<{ saved: boolean; saveCount: number }>(
      `/publications/${publicationId}/save`,
      { method: 'DELETE', token },
    );
  },

  /** « Pas intéressé » : la publication ne revient plus dans le fil. */
  notInterested(token: string, publicationId: string) {
    return request<unknown>('/feedback', {
      method: 'POST',
      token,
      body: { targetType: 'publication', targetId: publicationId },
    });
  },

  /** Retire un « pas intéressé » (le contenu peut revenir). */
  removeNotInterested(token: string, publicationId: string) {
    return request<{ removed: boolean }>(`/feedback/publication/${publicationId}`, {
      method: 'DELETE',
      token,
    });
  },

  /** Masque toutes les publications d'un auteur dans le fil. */
  muteAuthor(token: string, authorId: string) {
    return request<unknown>('/feedback', {
      method: 'POST',
      token,
      body: { targetType: 'author', targetId: authorId },
    });
  },

  /** Lève le masquage d'un auteur. */
  unmuteAuthor(token: string, authorId: string) {
    return request<{ removed: boolean }>(`/feedback/author/${authorId}`, {
      method: 'DELETE',
      token,
    });
  },

  /**
   * Enregistre une vue et le temps de visionnage cumulé.
   *
   * Idempotent côté serveur : une seule vue par compte et par publication, temps
   * croissant. Appelé au moment où la page quitte l'écran, pas à chaque tick.
   */
  recordView(
    token: string,
    publicationId: string,
    input: { watchedMs: number; completed?: boolean },
  ) {
    return request<{
      viewCount: number;
      watchMs: number;
      completed: boolean;
      firstView: boolean;
    }>(`/publications/${publicationId}/view`, { method: 'POST', token, body: input });
  },

  /** Compte un partage de la publication (discussion, feuille OS, copie). */
  sharePublication(token: string, publicationId: string) {
    return request<{ shareCount: number }>(`/publications/${publicationId}/share`, {
      method: 'POST',
      token,
    });
  },

  /** Republie la publication sur son propre profil, idempotent. */
  repostPublication(token: string, publicationId: string) {
    return request<{ reposted: boolean; repostCount: number }>(
      `/publications/${publicationId}/repost`,
      { method: 'POST', token },
    );
  },

  unrepostPublication(token: string, publicationId: string) {
    return request<{ reposted: boolean; repostCount: number }>(
      `/publications/${publicationId}/repost`,
      { method: 'DELETE', token },
    );
  },

  /** Enregistrements du compte connecté (tous, ou ceux d'une collection). */
  saved(token: string, options: { cursor?: string; collectionId?: string } = {}) {
    const query = new URLSearchParams({ limit: '30' });
    if (options.cursor) query.set('cursor', options.cursor);
    if (options.collectionId) query.set('collection', options.collectionId);
    return request<FeedPage>(`/saved?${query.toString()}`, { token });
  },

  saveCollections(token: string) {
    return request<SaveCollection[]>('/saved/collections', { token });
  },

  createSaveCollection(token: string, name: string) {
    return request<SaveCollection>('/saved/collections', {
      method: 'POST',
      token,
      body: { name },
    });
  },

  renameSaveCollection(token: string, collectionId: string, name: string) {
    return request<SaveCollection>(`/saved/collections/${collectionId}`, {
      method: 'PATCH',
      token,
      body: { name },
    });
  },

  deleteSaveCollection(token: string, collectionId: string) {
    return request<{ deleted: true }>(`/saved/collections/${collectionId}`, {
      method: 'DELETE',
      token,
    });
  },

  /** Range une publication enregistrée (`null` = hors collection). */
  assignSaveCollection(token: string, publicationId: string, collectionId: string | null) {
    return request<{ publicationId: string; collectionId: string | null }>(
      `/saved/${publicationId}/collection`,
      { method: 'PUT', token, body: { collectionId } },
    );
  },

  /** Publications d'un compte (grille du profil, épinglées d'abord). */
  userPublications(token: string, userId: string, cursor?: string) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return request<FeedPage>(`/feed/authored/${userId}${query}`, { token });
  },

  /** Republications d'un compte (grille de profil), paginé par curseur. */
  userReposts(token: string, userId: string, cursor?: string) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return request<FeedPage>(`/feed/reposts/${userId}${query}`, { token });
  },

  refresh(refreshToken: string) {
    return request<{ accessToken: string; refreshToken?: string }>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
    });
  },

  logout(refreshToken: string | undefined, token?: string) {
    return request<void>('/auth/logout', { method: 'POST', token, body: { refreshToken } });
  },

  me(token: string) {
    return request<User>('/auth/me', { token });
  },

  /* ------------------------- réglages et compte ------------------------- */

  getUserSettings(token: string) {
    return request<UserSettings>('/users/me/settings', { token });
  },

  updateUserSettings(
    token: string,
    body: {
      privacy?: Partial<UserSettings['privacy']>;
      readReceipts?: boolean;
      typingIndicator?: boolean;
      notifications?: Partial<UserSettings['notifications']>;
      quietHours?: Partial<UserSettings['quietHours']>;
    },
  ) {
    return request<UserSettings>('/users/me/settings', { method: 'PATCH', token, body });
  },

  setBirthdate(token: string, birthday: string) {
    return request<UserSettings>('/users/me/birthdate', {
      method: 'POST',
      token,
      body: { birthday },
    });
  },

  updateLocation(token: string, input: { latitude: number; longitude: number; mocked?: boolean }) {
    return request<LocationUpdateResult>('/users/me/location', {
      method: 'POST',
      token,
      body: input,
    });
  },

  listSessions(token: string) {
    return request<DeviceSession[]>('/auth/sessions', { token });
  },

  revokeSession(token: string, id: string) {
    return request<{ revoked: boolean }>(`/auth/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      token,
    });
  },

  changePassword(token: string, currentPassword: string, newPassword: string) {
    return request<{ changed: boolean; signedOut: boolean }>('/auth/change-password', {
      method: 'POST',
      token,
      body: { currentPassword, newPassword },
    });
  },

  deleteAccount(token: string, password: string) {
    return request<{ scheduled: boolean; deleteAt: string }>('/auth/account', {
      method: 'DELETE',
      token,
      body: { password },
    });
  },

  updateProfile(token: string, body: { displayName?: string; bio?: string }) {
    return request<User>('/users/me', { method: 'PATCH', token, body });
  },

  getUserProfile(token: string, id: string) {
    return request<UserProfile>(`/users/${encodeURIComponent(id)}`, { token });
  },

  /** Profil à partir d'un nom d'utilisateur (ouverture d'une `@mention`). */
  getUserProfileByUsername(token: string, username: string) {
    return request<UserProfile>(`/users/by-username/${encodeURIComponent(username)}`, { token });
  },

  uploadAvatar(token: string, data: string, mimeType: string) {
    return request<User>('/users/me/avatar', { method: 'POST', token, body: { data, mimeType } });
  },

  deleteAvatar(token: string) {
    return request<User>('/users/me/avatar', { method: 'DELETE', token });
  },

  /**
   * Importe une image (multipart) et renvoie son identifiant, à joindre à un
   * message. Le corps est un FormData : React Native gère seul le boundary,
   * il ne faut donc pas fixer Content-Type.
   */
  /** Import d'un média — photo ou message vocal — avant son envoi. */
  async uploadMedia(
    token: string,
    asset: {
      uri: string;
      mimeType?: string | null;
      fileName?: string | null;
      width?: number;
      height?: number;
      durationMs?: number;
      /** Import chiffré de bout en bout : le corps est déjà du ciphertext. */
      encrypted?: boolean;
      /** Conversation déclarée, vérifiée par le serveur avant tout enregistrement. */
      conversationId?: string;
      /** Nature du clair d'origine (IMAGE, VIDEO…), pour l'affichage. */
      kind?: string;
      /**
       * Clé d'idempotence : rejouer le même envoi après un timeout rend le même
       * identifiant, sans créer de second blob côté serveur.
       */
      idempotencyKey?: string;
    },
    onProgress?: (fraction: number, uploadedBytes: number, totalBytes: number) => void,
  ): Promise<UploadResult> {
    const buildForm = () => {
      const form = new FormData();
      // `File` d'expo-file-system implémente Blob et lit le fichier à la
      // demande ; le boundary multipart reste géré par la plateforme.
      form.append('file', new File(asset.uri) as unknown as Blob);
      if (asset.mimeType) form.append('mime', asset.mimeType);
      if (asset.fileName) form.append('name', asset.fileName);
      if (asset.width) form.append('width', String(Math.round(asset.width)));
      if (asset.height) form.append('height', String(Math.round(asset.height)));
      if (asset.durationMs) form.append('duration', String(Math.round(asset.durationMs)));
      if (asset.encrypted) form.append('encrypted', '1');
      if (asset.conversationId) form.append('conversationId', asset.conversationId);
      if (asset.kind) form.append('kind', asset.kind);
      return form;
    };

    // XHR est le seul transport RN qui expose la progression d'un FormData.
    const post = (accessToken: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}/uploads`);
        xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
        if (asset.idempotencyKey) {
          xhr.setRequestHeader('Idempotency-Key', asset.idempotencyKey);
        }
        xhr.timeout = 120_000;
        if (onProgress && xhr.upload) {
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && event.total > 0) {
              onProgress(event.loaded / event.total, event.loaded, event.total);
            }
          };
        }
        xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
        xhr.onerror = () => reject(new Error('network'));
        xhr.ontimeout = () => reject(new Error('timeout'));
        xhr.onabort = () => reject(new Error('aborted'));
        xhr.send(buildForm());
      });

    // Certains builds natifs gèrent mal FormData/File avec XHR : le transport
    // fetch historique reste le repli sans progression.
    const postWithFetch = async (accessToken: string): Promise<UploadResult> => {
      const send = (tokenToUse: string) =>
        fetch(`${API_URL}/uploads`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenToUse}`,
            ...(asset.idempotencyKey ? { 'Idempotency-Key': asset.idempotencyKey } : {}),
          },
          body: buildForm(),
        });
      let response = await send(accessToken);
      if (response.status === 401) {
        response = await send(await refreshAccessToken());
      }
      if (!response.ok) {
        let message = `Envoi impossible (${response.status})`;
        try {
          const data = (await response.json()) as { message?: string | string[] };
          if (data.message) {
            message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
          }
        } catch {
          // garde le message par défaut
        }
        throw new ApiError(response.status, message);
      }
      return (await response.json()) as UploadResult;
    };

    const networkError = new ApiError(
      0,
      "Impossible d'envoyer le fichier. Vérifie ta connexion.",
    );
    let result: { status: number; body: string };
    try {
      result = await post(token);
    } catch {
      try {
        return await postWithFetch(token);
      } catch (fallbackError) {
        if (fallbackError instanceof ApiError) throw fallbackError;
        throw networkError;
      }
    }
    if (result.status === 401) {
      const fresh = await refreshAccessToken();
      try {
        result = await post(fresh);
      } catch {
        throw networkError;
      }
    }
    if (result.status < 200 || result.status >= 300) {
      let message = `Envoi impossible (${result.status})`;
      try {
        const data = JSON.parse(result.body) as { message?: string | string[] };
        if (data.message) {
          message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
        }
      } catch {
        // garde le message par défaut
      }
      throw new ApiError(result.status, message);
    }
    try {
      return JSON.parse(result.body) as UploadResult;
    } catch {
      throw new ApiError(result.status, 'Réponse du serveur invalide.');
    }
  },

  forgotPassword(body: { emailOrUsername: string }) {
    return request<ForgotPasswordResult>('/auth/forgot-password', { method: 'POST', body });
  },

  resetPassword(body: { emailOrUsername: string; code: string; newPassword: string }) {
    return request<ResetPasswordResult>('/auth/reset-password', { method: 'POST', body });
  },

  searchUsers(token: string, query: string) {
    return request<User[]>(`/users/search?q=${encodeURIComponent(query)}`, { token });
  },

  /** Suggestions : récents puis alphabétique, hors comptes bloqués. */
  suggestContacts(token: string, limit = 50) {
    return request<{ recent: User[]; contacts: User[] }>(
      `/users/suggestions?limit=${limit}`,
      { token },
    );
  },

  listConversations(token: string) {
    return request<ConversationSummary[]>('/conversations', { token });
  },

  getConversation(token: string, id: string) {
    return request<ConversationSummary>(`/conversations/${id}`, { token });
  },

  createConversation(
    token: string,
    body: {
      memberIds: string[];
      name?: string;
      type?: 'DIRECT' | 'GROUP';
      emoji?: string;
      color?: string;
      description?: string;
    },
  ) {
    return request<ConversationSummary>('/conversations', { method: 'POST', token, body });
  },

  updateGroup(
    token: string,
    id: string,
    body: {
      name?: string;
      description?: string;
      emoji?: string;
      color?: string;
      whoCanSend?: 'all' | 'admins';
      whoCanAdd?: 'all' | 'admins';
    },
  ) {
    return request<ConversationSummary>(`/conversations/${id}`, { method: 'PATCH', token, body });
  },

  uploadGroupPhoto(token: string, id: string, data: string, mimeType: string) {
    return request<ConversationSummary>(`/conversations/${id}/photo`, {
      method: 'POST',
      token,
      body: { data, mimeType },
    });
  },

  deleteGroupPhoto(token: string, id: string) {
    return request<ConversationSummary>(`/conversations/${id}/photo`, {
      method: 'DELETE',
      token,
    });
  },

  updateMemberRole(token: string, id: string, userId: string, role: 'admin' | 'member') {
    return request<ConversationSummary>(
      `/conversations/${id}/members/${encodeURIComponent(userId)}/role`,
      { method: 'PATCH', token, body: { role } },
    );
  },

  addConversationMembers(token: string, id: string, memberIds: string[]) {
    return request<ConversationSummary>(`/conversations/${id}/members`, { method: 'POST', token, body: { memberIds } });
  },

  removeConversationMember(token: string, id: string, userId: string) {
    return request<void>(`/conversations/${id}/members/${userId}`, { method: 'DELETE', token });
  },

  /* ----------------------------- invitations ----------------------------- */

  createInvite(
    token: string,
    id: string,
    body: { expiresInHours?: number; maxUses?: number; requiresApproval?: boolean },
  ) {
    return request<GroupInvite>(`/conversations/${id}/invites`, {
      method: 'POST',
      token,
      body,
    });
  },

  listInvites(token: string, id: string) {
    return request<GroupInvite[]>(`/conversations/${id}/invites`, { token });
  },

  revokeInvite(token: string, id: string, inviteId: string) {
    return request<void>(`/conversations/${id}/invites/${encodeURIComponent(inviteId)}`, {
      method: 'DELETE',
      token,
    });
  },

  /** Aperçu public d'une invitation : fonctionne sans être connecté. */
  previewInvite(inviteToken: string) {
    return request<InvitePreview>(`/invites/${encodeURIComponent(inviteToken)}`);
  },

  joinInvite(token: string, inviteToken: string) {
    return request<JoinInviteResult>(`/invites/${encodeURIComponent(inviteToken)}/join`, {
      method: 'POST',
      token,
    });
  },

  listJoinRequests(token: string, id: string) {
    return request<JoinRequest[]>(`/conversations/${id}/join-requests`, { token });
  },

  resolveJoinRequest(
    token: string,
    id: string,
    requestId: string,
    action: 'approve' | 'reject',
  ) {
    return request<JoinInviteResult>(
      `/conversations/${id}/join-requests/${encodeURIComponent(requestId)}/resolve`,
      { method: 'POST', token, body: { action } },
    );
  },

  listMessages(
    token: string,
    conversationId: string,
    options: { before?: string; after?: string; limit?: number } = {},
  ) {
    const params = new URLSearchParams();
    if (options.before) params.set('before', options.before);
    if (options.after) params.set('after', options.after);
    if (options.limit) params.set('limit', String(options.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<Message[]>(`/conversations/${conversationId}/messages${query}`, { token });
  },

  /**
   * Tout ce qui est arrivé depuis un curseur, toutes discussions confondues.
   * C'est ce qui rattrape une coupure réseau. Le message servant de curseur peut
   * être renvoyé : les identifiants sont à comparer.
   */
  syncSince(token: string, since: string) {
    return request<Message[]>(`/conversations/sync?since=${encodeURIComponent(since)}`, { token });
  },

  /** Médias (pièces jointes) et liens partagés dans la conversation. */
  listConversationMedia(token: string, conversationId: string) {
    return request<{
      attachments: ConversationMediaItem[];
      links: ConversationLinkItem[];
    }>(`/conversations/${conversationId}/media`, { token });
  },

  /** Recherche simple dans l'historique de la conversation. */
  searchConversation(token: string, conversationId: string, query: string) {
    return request<ConversationSearchHit[]>(
      `/conversations/${conversationId}/search?q=${encodeURIComponent(query)}`,
      { token },
    );
  },

  /** Accusés de réception des messages que j'ai envoyés (coches reçue / lue). */
  listReceipts(token: string, conversationId: string) {
    return request<MessageReceipt[]>(`/conversations/${conversationId}/receipts`, { token });
  },

  markRead(token: string, conversationId: string) {
    return request<void>(`/conversations/${conversationId}/read`, { method: 'POST', token });
  },

  /**
   * Marque comme lus ces messages, et eux seulement : le écran chiffré ne
   * déclare « Ouvert » que pour les messages réellement visibles à l'écran.
   */
  markMessagesRead(token: string, conversationId: string, messageIds: string[]) {
    return request<void>(`/conversations/${conversationId}/messages/read`, {
      method: 'POST',
      token,
      body: { messageIds },
    });
  },

  markAllRead(token: string) {
    return request<void>('/conversations/read-all', { method: 'POST', token });
  },

  setConversationPreferences(
    token: string,
    conversationId: string,
    body: { pinned?: boolean; muted?: boolean; hidden?: boolean },
  ) {
    return request<ConversationSummary>(`/conversations/${conversationId}/preferences`, {
      method: 'PATCH',
      token,
      body,
    });
  },

  listHiddenConversations(token: string) {
    return request<ConversationSummary[]>('/conversations/hidden', { token });
  },

  listBlockedUsers(token: string) {
    return request<User[]>('/users/blocked', { token });
  },

  blockUser(token: string, id: string) {
    return request<{ blocked: boolean }>(`/users/${encodeURIComponent(id)}/block`, {
      method: 'POST',
      token,
    });
  },

  unblockUser(token: string, id: string) {
    return request<{ blocked: boolean }>(`/users/${encodeURIComponent(id)}/block`, {
      method: 'DELETE',
      token,
    });
  },

  setNotificationsEnabled(token: string, enabled: boolean) {
    return this.setNotificationPreferences(token, { notificationsEnabled: enabled });
  },

  setNotificationPreferences(
    token: string,
    prefs: {
      notificationsEnabled?: boolean;
      notificationSound?: boolean;
      notificationPreview?: boolean;
    },
  ) {
    return request<User>('/users/me', {
      method: 'PATCH',
      token,
      body: prefs,
    });
  },

  registerPushToken(token: string, pushToken: string, platform = 'android') {
    return request<{ registered: boolean }>('/users/me/push-token', {
      method: 'POST',
      token,
      body: { token: pushToken, platform, apiBaseUrl: API_URL },
    });
  },

  getE2eeStatus(token: string) {
    return request<{
      deviceId: string | null;
      registered: boolean;
      prekeysRemaining?: number;
      fallbackAvailable?: boolean;
    }>('/e2ee/status', { token });
  },

  addE2eePrekeys(
    token: string,
    oneTimeKeys: { keyId: string; key: string; signature: string }[],
  ) {
    return request<{ added: number }>('/e2ee/devices/prekeys', {
      method: 'POST',
      token,
      body: { oneTimeKeys },
    });
  },

  registerE2eeDevice(
    token: string,
    body: {
      identityKey: string;
      signingKey: string;
      fallbackPrekey?: string;
      fallbackPrekeySignature?: string;
      fallbackPrekeyKeyId?: string;
      deviceName?: string;
      platform?: string;
      oneTimeKeys: { keyId: string; key: string; signature: string }[];
    },
  ) {
    return request<{ deviceId: string; replaced: boolean }>('/e2ee/devices', {
      method: 'POST',
      token,
      body: {
        ...body,
        deviceName:
          body.deviceName ?? (Device.modelName ?? Device.deviceName ?? 'Appareil').slice(0, 80),
        platform: body.platform ?? Platform.OS,
      },
    });
  },

  getE2eeKeyBundle(token: string, userId: string, consume = true) {
    return request<{
      deviceId: string;
      identityKey: string;
      signingKey: string;
      signedPrekey: string | null;
      signedPrekeySignature: string | null;
      oneTimeKey: { keyId: string; key: string; signature: string | null } | null;
      fallback: { keyId: string; key: string; signature: string | null } | null;
    }>(`/e2ee/users/${encodeURIComponent(userId)}/keys?consume=${consume ? 'true' : 'false'}`, {
      token,
    });
  },

  removePushToken(token: string, pushToken: string) {
    return request<{ registered: boolean }>('/users/me/push-token', {
      method: 'DELETE',
      token,
      body: { token: pushToken },
    });
  },

  getPresenceSettings(token: string) {
    return request<PresenceSettings>('/me/presence-settings', { token });
  },

  updatePresenceSettings(token: string, body: Partial<PresenceSettings>) {
    return request<PresenceSettings>('/me/presence-settings', {
      method: 'PATCH',
      token,
      body,
    });
  },

  getPresence(token: string, ids: string[]) {
    return request<PresenceSnapshot>(
      `/presence?ids=${encodeURIComponent(ids.join(','))}`,
      { token },
    );
  },
};
