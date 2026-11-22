export interface SenderInfo {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /** Genre déclaré, pour l'avatar par défaut quand il n'y a pas de photo. */
  gender: Gender | null;
  /** Libellé libre quand le genre déclaré est « Personnalisé ». */
  genderCustom: string | null;
}

/** Membre d'une conversation, avec son dernier accusé de lecture. */
export interface MemberInfo extends SenderInfo {
  lastReadAt: string | null;
  /** Admin : il peut renommer le groupe, inviter et exclure. */
  role: 'admin' | 'member';
}

export type Gender = 'FEMALE' | 'MALE' | 'CUSTOM';

export interface User {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  /** Genre déclaré à l'inscription, pour l'avatar par défaut. */
  gender: Gender | null;
  /** Libellé libre quand le genre déclaré est « Personnalisé ». */
  genderCustom: string | null;
  /** Notifications dans l'application (badges de non-lus). */
  notificationsEnabled: boolean;
  /** Son des notifications poussées. */
  notificationSound: boolean;
  /** Aperçu du texte dans les notifications. */
  notificationPreview: boolean;
  createdAt: string;
}

/** Profil public : infos + âge/ville filtrés + statistiques. */
export interface UserProfile extends User {
  isMe: boolean;
  /** Âge révolu calculé par le serveur ; null si masqué par la confidentialité. */
  age: number | null;
  city: string | null;
  country: string | null;
  birthdateSet: boolean;
  stats: {
    /** Nombre de messages envoyés. */
    messages: number;
    /** Nombre de discussions partagées avec le visiteur. */
    conversations: number;
  };
  /**
   * Identité sociale (ADR-0001). Absent d'un profil mis en cache avant
   * l'ajout du social, d'où le `?`.
   */
  social?: SocialProfileSummary;
}

export interface SocialProfileSummary {
  verified: boolean;
  privateAccount: boolean;
  followerCount: number;
  followingCount: number;
  publicationCount: number;
  reelCount: number;
  /** Relation du visiteur : aucune, demande envoyée, ou abonné. */
  followStatus: 'none' | 'pending' | 'accepted';
  /** Ce compte suit le visiteur. */
  followsViewer: boolean;
  /** Le contenu social est-il visible pour le visiteur ? */
  contentVisible: boolean;
  canInteract: boolean;
}

export interface FollowState {
  status: 'none' | 'pending' | 'accepted';
  followerCount: number;
}

/** Qui peut voir ou faire quoi. */
export type Visibility = 'everyone' | 'contacts' | 'nobody';

export interface UserSettings {
  privacy: {
    profile: Visibility;
    write: Visibility;
    groupAdd: Visibility;
    call: Visibility;
    discoverability: Visibility;
  };
  readReceipts: boolean;
  typingIndicator: boolean;
  notifications: {
    enabled: boolean;
    messages: boolean;
    groups: boolean;
    mentions: boolean;
    calls: boolean;
    reactions: boolean;
    sound: boolean;
    preview: boolean;
  };
  quietHours: {
    enabled: boolean;
    startMinute: number;
    endMinute: number;
    utcOffsetMinutes: number;
  };
  city: string | null;
  country: string | null;
  cityUpdatedAt: string | null;
  birthdateSet: boolean;
  age: number | null;
}

/** Appareil connecté (session de rafraîchissement valide). */
export interface DeviceSession {
  id: string;
  deviceName: string | null;
  platform: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export interface LocationUpdateResult {
  updated: boolean;
  city: string | null;
  country: string | null;
  cityUpdatedAt: string | null;
  reason?: 'same-city' | 'too-soon' | 'teleport' | 'no-city' | 'geocode';
}

export type MessageAttachmentType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | 'GIF' | 'STICKER';

/** Texte Unicode normal, sticker référencé, ou message système d'appel. */
export type MessageType = 'text' | 'sticker' | 'call' | 'system';

/** Pièce jointe d'un message (photo pour l'instant). */
export interface MessageAttachment {
  type: MessageAttachmentType;
  /** Chemin relatif signé et éphémère renvoyé par l'API (« /media?f=… »), ou
   *  URI locale pendant l'envoi optimiste, ou URL absolue externe (GIPHY :
   *  `https://media*.giphy.com/…`) chargée directement depuis les CDN. */
  url: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  /** Durée d'un message vocal, en millisecondes. */
  duration?: number;
  /** Forme d'onde d'un message vocal (valeurs 0..1), pour la bulle. */
  waveform?: number[];
  name?: string;
  /** GIF GIPHY : sticker animé transparent (sinon GIF plein cadre). */
  sticker?: boolean;
  /** Identifiant du GIF côté GIPHY. */
  giphyId?: string;
  /** Compte GIPHY source (attribution). */
  username?: string;
  /** Titre du GIF GIPHY. */
  title?: string;
  /** Aperçu statique remplaçant l'animation le temps du chargement. */
  stillUrl?: string;
  /** Sticker Mbolo : identifiant stable dans le catalogue. */
  stickerId?: string;
  /** Pack d'origine (catalogue local ou stickers personnels). */
  stickerPackId?: string;
  /** Nom accessible du sticker. */
  stickerName?: string;
}

/** Métadonnées envoyées avec un sticker importé comme image. */
export interface StickerSendPayload {
  id: string;
  packId: string;
  name?: string;
  /** Dimensions de l'image locale, pour un aperçu optimiste fidèle. */
  width?: number;
  height?: number;
}

/** Payload GIF GIPHY transmis du panneau à la file d'attente puis au serveur.
 *  Le serveur revalide l'URL (allowlist media*.giphy.com) avant stockage. */
export interface GifSendPayload {
  /** Rendu d'envoi (`fixed_width`, WebP) — URL GIPHY jamais altérée. */
  url: string;
  width?: number;
  height?: number;
  /** Sticker animé transparent. */
  sticker?: boolean;
  giphyId?: string;
  username?: string;
  title?: string;
  /** Aperçu statique (mêmes règles d'allowlist). */
  stillUrl?: string;
}

export interface UploadResult extends MessageAttachment {
  id: string;
}

/** Aperçu du message cité par une réponse. */
export interface MessageQuote {
  id: string;
  senderName: string;
  content: string;
  type: MessageType;
  attachmentType: MessageAttachmentType | null;
  /** L'original a été retiré depuis. */
  deleted: boolean;
}

export interface ReactionSummary {
  /** Référence de sticker panthère (« mbolo-panther-2d/amour »). */
  reaction: string;
  count: number;
  /** J'ai réagi avec ce sticker. */
  mine: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  type: MessageType;
  content: string;
  /** `none` ou enveloppe Olm `v1`. */
  encryption?: 'none' | 'v1';
  /** Enveloppe chiffrée base64 (null pour un message en clair). */
  payload?: string | null;
  /** Type d'enveloppe Olm (premier message ou normal). */
  payloadType?: 'prekey' | 'normal' | null;
  /** Appareil émetteur, métadonnée de l'enveloppe. */
  senderDeviceId?: string | null;
  /** Référence de catalogue d'un sticker (« mbolo/merci »), sinon null. */
  stickerRef: string | null;
  attachment: MessageAttachment | null;
  /**
   * Pièce jointe chiffrée de bout en bout : le serveur n'en connaît que
   * l'identifiant d'upload. Le type, la taille et la clé voyagent dans
   * l'enveloppe Olm (`payload`), jamais ici.
   */
  encryptedAttachment?: { uploadId: string } | null;
  /** Clé d'idempotence de l'appareil émetteur (null pour l'historique ancien). */
  clientId: string | null;
  /** Retiré pour tous : contenu et pièce jointe ne sont plus nulle part. */
  deleted: boolean;
  /** Message cité par une réponse. */
  replyTo: MessageQuote | null;
  /** Réactions emoji agrégées. */
  reactions: ReactionSummary[];
  /** Envoi silencieux : aucune notification sonore ni vibration. */
  silent?: boolean;
  /** Lecture unique : le contenu est masqué jusqu’à ouverture. */
  viewOnce?: boolean;
  /** Date locale planifiée, présente seulement dans la file d’envoi. */
  scheduledAt?: string | null;
  createdAt: string;
  sender: SenderInfo;
}

/** Charge utile de l'événement temps réel « message:reaction ». */
export interface MessageReactionEvent {
  conversationId: string;
  messageId: string;
  reactions: ReactionSummary[];
}

/** Accusé de réception d'un message envoyé par moi, par destinataire. */
export interface MessageReceipt {
  messageId: string;
  userId: string;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface ConversationSummary {
  id: string;
  type: 'DIRECT' | 'GROUP';
  name: string | null;
  /** Photo du groupe (URL signée) ; null s'il n'y en a pas. */
  avatarUrl: string | null;
  /** Identité de repli du groupe quand il n'y a pas de photo. */
  emoji: string | null;
  color: string | null;
  description: string | null;
  /** Créateur du groupe : badge propriétaire. */
  ownerId: string | null;
  /** Qui peut écrire / ajouter des membres. */
  whoCanSend: 'all' | 'admins';
  whoCanAdd: 'all' | 'admins';
  createdAt: string;
  updatedAt: string;
  /** Date de bascule E2EE (null pour une conversation en clair). */
  e2eeSince: string | null;
  members: MemberInfo[];
  lastMessage: Message | null;
  unreadCount: number;
  /** Épinglée par l'utilisateur courant. */
  pinned: boolean;
  /** Muette par l'utilisateur courant. */
  muted: boolean;
  /** Masquée par l'utilisateur courant (absente de la liste principale). */
  hidden: boolean;
  /** Mon rôle : seuls les administrateurs pilotent un groupe. */
  myRole: 'admin' | 'member';
  /** J'ai bloqué l'autre membre (discussion directe). */
  blockedByMe: boolean;
  /** L'autre membre m'a bloqué (discussion directe) : saisie désactivée. */
  blockedByThem: boolean;
}

export type LastSeenVisibility = 'everyone' | 'contacts' | 'nobody';
export type OnlineVisibility = 'everyone' | 'same_as_last_seen';

export interface PresenceSettings {
  lastSeenVisibility: LastSeenVisibility;
  onlineVisibility: OnlineVisibility;
}

/** Un champ absent signifie que le serveur ne l'a pas autorisé. */
export interface PresenceEntry {
  userId: string;
  online?: boolean;
  lastSeenAt?: string | null;
}

export interface PresenceSnapshot {
  serverNow: string;
  presence: PresenceEntry[];
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface ForgotPasswordResult {
  message: string;
  devCode?: string;
}

export interface ResetPasswordResult {
  message: string;
}

/* ------------------------------- groupes -------------------------------- */

export type InviteStatus = 'ok' | 'expired' | 'revoked' | 'exhausted' | 'full';

/** Invitation telle que la voit un membre du groupe. */
export interface GroupInvite {
  id: string;
  token: string;
  conversationId: string;
  expiresAt: string;
  maxUses: number | null;
  uses: number;
  requiresApproval: boolean;
  createdAt: string;
  status: InviteStatus;
}

/** Aperçu public d'une invitation : aucune identité de membre. */
export interface InvitePreview {
  group: {
    id: string;
    name: string | null;
    description: string | null;
    emoji: string | null;
    color: string | null;
    avatarUrl: string | null;
    memberCount: number;
  };
  requiresApproval: boolean;
  expiresAt: string;
  status: InviteStatus;
}

export interface JoinRequest {
  id: string;
  inviteId: string;
  createdAt: string;
  user: SenderInfo;
}

export interface JoinInviteResult {
  status: 'joined' | 'pending' | 'rejected';
  conversationId: string;
  requestId?: string;
}

/** État diffusé en temps réel sur le salon du groupe. */
export interface GroupInfo {
  id: string;
  name: string | null;
  description: string | null;
  emoji: string | null;
  color: string | null;
  avatarUrl: string | null;
  ownerId: string | null;
  whoCanSend: 'all' | 'admins';
  whoCanAdd: 'all' | 'admins';
  memberCount: number;
  updatedAt: string;
}

export interface GroupUpdatedEvent {
  conversationId: string;
  group: GroupInfo;
  members: MemberInfo[];
}

export interface MembersChangedEvent extends GroupUpdatedEvent {
  action: 'added' | 'removed' | 'left' | 'role';
  actorId: string;
  userIds: string[];
}

export interface ConversationRemovedEvent {
  conversationId: string;
  reason: 'removed' | 'left';
}

/* ------------------------- médias et recherche -------------------------- */

export interface ConversationMediaItem {
  messageId: string;
  type: MessageAttachmentType;
  url: string;
  mime: string;
  name: string | null;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: string;
  senderName: string;
}

export interface ConversationLinkItem {
  messageId: string;
  url: string;
  createdAt: string;
  senderName: string;
}

export interface ConversationSearchHit {
  messageId: string;
  content: string;
  createdAt: string;
  senderName: string;
}

/** Carte d'auteur d'une publication : aucune donnée personnelle. */
export interface SocialAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
  /** Présent sur les commentaires : état du graphe social avec le lecteur. */
  following?: boolean;
  followedBy?: boolean;
}

export type SocialReaction = 'like' | 'love' | 'fire' | 'clap';

/** Motifs de signalement acceptés par l'API (`POST /reports`). */
export type ReportReason =
  | 'spam'
  | 'harassment'
  | 'hate'
  | 'nudity'
  | 'violence'
  | 'misinformation'
  | 'other';

export type SocialVisibility = 'public' | 'followers' | 'private';

export interface PublicationMedia {
  assetId: string;
  kind: 'image' | 'video' | 'audio';
  mime: string;
  position: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  url: string | null;
  /** Variante basse qualité d'une vidéo (flux mobile). `null` si absente. */
  lowUrl?: string | null;
  posterUrl: string | null;
  altText: string | null;
}

/** Résumé de la publication citée par une citation (« Citer »). */
export interface QuotedPost {
  id: string;
  authorUsername: string;
  authorDisplayName: string;
  caption: string | null;
}

/** Publication du fil social (posts et reels unifiés côté API). */
export interface FeedPost {
  id: string;
  /** Dernière retouche du texte par l'auteur (ISO), `null` = jamais modifiée. */
  editedAt?: string | null;
  kind: 'post' | 'reel';
  format: 'text' | 'image' | 'carousel' | 'video';
  caption: string | null;
  /** Fond choisi pour un post texte (`FeedTextPost.backgrounds`), `null` = défaut. */
  textBackground?: string | null;
  /** Pages d'un post texte multi-cartes, `null` pour une publication classique. */
  pages?: string[] | null;
  /**
   * Style propre à chaque page (fond/couleur), aligné sur `pages`.
   * `null` = la page garde le rendu par défaut.
   */
  pageStyles?: ({ background?: string; color?: string; font?: string; align?: string; size?: number } | null)[] | null;
  /** Police choisie pour un post texte (clé de `TEXT_FONTS`), `null` = système. */
  textFont?: string | null;
  /** Alignement d'un post texte (`left`/`center`/`right`), `null` = centré. */
  textAlign?: string | null;
  /** Couleur du texte d'un post texte (clé de `TEXT_COLORS`), `null` = thème. */
  textColor?: string | null;
  /** Titre dédié d'un post texte, `null` = déduit de la première ligne. */
  textTitle?: string | null;
  /** Taille manuelle d'un post texte (points), `null` = auto-ajustement. */
  textSize?: number | null;
  /** Lieu facultatif d'un post texte, `null` = pas de localisation. */
  location?: string | null;
  /** Aperçu OG du premier lien du texte, `null` = pas de lien exploitable. */
  linkPreview?: {
    url: string;
    host: string;
    title: string;
    description: string;
    imageUrl: string | null;
  } | null;
  /** Filtre visuel d'une publication média (clé de `MEDIA_FILTERS`), `null` = brut. */
  mediaFilter?: string | null;
  visibility: SocialVisibility;
  createdAt: string;
  author: SocialAuthor;
  /** Médias attachés, dans l'ordre du carrousel (vide pour un post texte). */
  media?: PublicationMedia[];
  counters: {
    likes: number;
    comments: number;
    reposts: number;
    saves: number;
    /** Partages comptés côté serveur (envoi, feuille système, copie). */
    shares?: number;
    views: number;
  };
  viewer: {
    reaction: SocialReaction | null;
    /** Le visiteur suit l'auteur (abonnement accepté). */
    followingAuthor: boolean;
    /** Le visiteur a enregistré la publication. */
    saved?: boolean;
    /** Le visiteur a republié la publication. */
    reposted?: boolean;
  };
  /** Publication citée, `null` pour une publication classique. */
  quoted?: QuotedPost | null;
  /**
   * Compte suivi qui a republié cette publication dans le fil
   * « Abonnements » (attribution « X a republié »). `null` sinon.
   */
  repostedBy?: SocialAuthor | null;
  /**
   * « Aimé par X et N autres » : compte suivi qui a réagi le plus récemment.
   * `null` si aucun compte suivi n'a réagi (on affiche alors le nombre seul).
   */
  likedBy?: SocialAuthor | null;
}

export interface FeedPage {
  items: FeedPost[];
  nextCursor: string | null;
}

export type FeedTab = 'for-you' | 'following' | 'local';

/** Kinds de réaction emoji sur un commentaire (alignés sur l'API). */
export type CommentReactionKind = 'heart' | 'laugh' | 'wow' | 'fire' | 'clap';

/** Réaction emoji agrégée sur un commentaire. */
export interface CommentReaction {
  kind: CommentReactionKind;
  count: number;
}

/** Tri des commentaires : pertinence ou plus récents. */
export type CommentSort = 'top' | 'recent';

/** Nature d'un commentaire : texte, vocal, photo ou sticker. */
export type CommentKind = 'text' | 'audio' | 'image' | 'sticker';

/** Pièce jointe d'un commentaire, résolue côté serveur. */
export interface CommentAttachment {
  kind: 'image' | 'audio' | 'sticker';
  /** URL signée du média ; `null` pour un sticker de catalogue. */
  url: string | null;
  mime: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** Référence catalogue (`pack/sticker`) pour `kind: 'sticker'`. */
  stickerRef: string | null;
  /** Note vocale jointe en légende d'une photo ou d'un sticker. */
  voice: {
    url: string | null;
    mime: string;
    durationMs: number | null;
  } | null;
}

/** Ticket d'upload présigné du pipeline média social. */
export interface SocialUploadTicket {
  id: string;
  status: 'pending';
  uploadUrl: string;
  expiresIn: number;
  contentType: string;
  maxBytes: number;
}

/** Asset média social après confirmation. */
export interface SocialMediaAsset {
  id: string;
  kind: 'image' | 'video' | 'audio';
  mime: string;
  sizeBytes: number;
  status: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  publicUrl: string | null;
  createdAt: string;
}

/** Commentaire ou réponse à une publication. */
export interface PublicationComment {
  id: string;
  publicationId: string;
  parentId: string | null;
  kind: CommentKind;
  body: string;
  attachment: CommentAttachment | null;
  createdAt: string;
  author: SocialAuthor;
  likeCount: number;
  /** Nombre de réponses directes. */
  replyCount: number;
  /** Le visiteur a aimé ce commentaire. */
  viewerLiked: boolean;
  /** Le visiteur a marqué ce commentaire « Je n'aime pas ». */
  viewerDisliked: boolean;
  /** Nombre de « Je n'aime pas ». */
  dislikeCount: number;
  /** Pertinence : likes − dislikes, plancher à 0 (sert au classement serveur). */
  score: number;
  /** Épinglé par l'auteur de la publication. */
  pinned: boolean;
  /** Réactions emoji agrégées. */
  reactions: CommentReaction[];
  /** Réaction emoji du visiteur, `null` s'il n'a pas réagi. */
  viewerReaction: CommentReactionKind | null;
}

export interface CommentPage {
  /** Commentaires racines épinglés, affichés en tête de fil. */
  pinned: PublicationComment[];
  items: PublicationComment[];
  nextCursor: string | null;
}

export type SocialNotificationType =
  | 'like'
  | 'comment'
  | 'reply'
  | 'mention'
  | 'repost'
  | 'follow'
  | 'follow_request'
  | 'follow_accepted'
  | 'story_reply'
  | 'moderation';

export interface SocialNotification {
  id: string;
  type: SocialNotificationType;
  publicationId: string | null;
  commentId: string | null;
  storyId: string | null;
  readAt: string | null;
  createdAt: string;
  actor: SocialAuthor | null;
}

export interface SocialNotificationPage {
  items: SocialNotification[];
  unreadCount: number;
  nextCursor: string | null;
}

export interface SearchUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
  privateAccount: boolean;
}

export interface SearchPublication {
  id: string;
  kind: 'post' | 'reel';
  caption: string | null;
  createdAt: string;
  author: SocialAuthor;
}

export interface SearchHashtag {
  id: string;
  tag: string;
  usageCount: number;
  trendScore: number;
}

export interface SearchBlock<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SearchResult {
  users: SearchBlock<SearchUser>;
  publications: SearchBlock<SearchPublication>;
  hashtags: SearchBlock<SearchHashtag>;
}
