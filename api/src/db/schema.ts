import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  customType,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const conversationTypeEnum = pgEnum('conversation_type', ['DIRECT', 'GROUP']);

export const lastSeenVisibilityEnum = pgEnum('last_seen_visibility', [
  'everyone',
  'contacts',
  'nobody',
]);
export const onlineVisibilityEnum = pgEnum('online_visibility', [
  'everyone',
  'same_as_last_seen',
]);

/** Qui peut voir / faire quoi : tout le monde, mes contacts, personne. */
export const privacyVisibilityEnum = pgEnum('privacy_visibility', [
  'everyone',
  'contacts',
  'nobody',
]);

/**
 * Rôle du compte dans le produit social. `moderator` et `admin` donnent accès au
 * back-office (voir `AdminGuard`, phase 1) ; l'ordre du tableau est l'ordre
 * croissant des privilèges, à ne pas réordonner.
 */
export const userRoleEnum = pgEnum('user_role', ['user', 'moderator', 'admin']);

/**
 * Vecteur de recherche plein texte PostgreSQL. Type non natif de Drizzle :
 * la colonne est générée par la base (`GENERATED ALWAYS AS ... STORED`), donc
 * jamais écrite par l'application.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  bio: text('bio'),
  /** Notifications dans l'application (badges, compteurs de non-lus). */
  notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  /** Son des notifications poussées (les appels sonnent toujours). */
  notificationSound: boolean('notification_sound').notNull().default(true),
  /** Aperçu du texte des messages dans les notifications. */
  notificationPreview: boolean('notification_preview').notNull().default(true),
  passwordHash: text('password_hash').notNull(),
  avatarUrl: text('avatar_url'),
  birthday: date('birthday'),
  gender: text('gender'),
  /** Libellé libre saisi quand le genre choisi est « Personnalisé ». */
  genderCustom: text('gender_custom'),
  /** Dernier passage en ligne → hors ligne, en UTC. */
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  lastSeenVisibility: lastSeenVisibilityEnum('last_seen_visibility')
    .notNull()
    .default('contacts'),
  onlineVisibility: onlineVisibilityEnum('online_visibility')
    .notNull()
    .default('same_as_last_seen'),
  /** Ville vérifiée par géocodage serveur : jamais de coordonnées stockées. */
  city: text('city'),
  country: text('country'),
  cityUpdatedAt: timestamp('city_updated_at', { withTimezone: true }),
  /** La ville est masquée aux autres par défaut pour les mineurs. */
  cityVisible: boolean('city_visible').notNull().default(true),
  /** Photo, bio, ville et âge : même visibilité pour ces quatre champs. */
  profileVisibility: privacyVisibilityEnum('profile_visibility').notNull().default('everyone'),
  /** Qui peut m'écrire (nouvelle conversation directe). */
  writePermission: privacyVisibilityEnum('write_permission').notNull().default('everyone'),
  /** Qui peut m'ajouter à un groupe. */
  groupAddPermission: privacyVisibilityEnum('group_add_permission').notNull().default('everyone'),
  /** Qui peut m'appeler. */
  callPermission: privacyVisibilityEnum('call_permission').notNull().default('everyone'),
  /** Qui peut me trouver par nom d'utilisateur. */
  discoverability: privacyVisibilityEnum('discoverability').notNull().default('everyone'),
  /** Accusés de lecture diffusés aux autres (la lecture locale reste vraie). */
  readReceipts: boolean('read_receipts').notNull().default(true),
  /** Indicateur « en train d'écrire » diffusé aux autres. */
  typingIndicator: boolean('typing_indicator').notNull().default(true),
  notifyMessages: boolean('notify_messages').notNull().default(true),
  notifyGroups: boolean('notify_groups').notNull().default(true),
  notifyMentions: boolean('notify_mentions').notNull().default(true),
  notifyCalls: boolean('notify_calls').notNull().default(true),
  notifyReactions: boolean('notify_reactions').notNull().default(true),
  quietHoursEnabled: boolean('quiet_hours_enabled').notNull().default(false),
  /** Minutes depuis minuit, heure locale du compte. */
  quietStartMinute: integer('quiet_start_minute').notNull().default(1320),
  quietEndMinute: integer('quiet_end_minute').notNull().default(420),
  quietUtcOffsetMinutes: integer('quiet_utc_offset_minutes').notNull().default(0),
  /** Suppression demandée : anonymisation après 30 jours, annulable avant. */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /**
   * Identité sociale (ADR-0001). Le compte reste le même : le rôle et les
   * compteurs vivent sur `users`, pas dans une table de profil séparée, pour
   * qu'une seule jointure suffise à autoriser une action ou à rendre un profil.
   */
  role: userRoleEnum('role').notNull().default('user'),
  /** Badge de vérification, attribué manuellement par la modération. */
  verified: boolean('verified').notNull().default(false),
  /** Compte privé : les abonnements passent par une demande (`follows.status`). */
  privateAccount: boolean('private_account').notNull().default(false),
  /** Compteurs dénormalisés, écrits uniquement par l'API en transaction. */
  followerCount: integer('follower_count').notNull().default(0),
  followingCount: integer('following_count').notNull().default(0),
  publicationCount: integer('publication_count').notNull().default(0),
  reelCount: integer('reel_count').notNull().default(0),
  /** Total de réactions reçues sur les publications de ce compte. */
  likeReceivedCount: integer('like_received_count').notNull().default(0),
  /** Dernier changement de `username` : sert de base au cooldown. */
  usernameUpdatedAt: timestamp('username_updated_at', { withTimezone: true }),
},
  (table) => [
    // Autocomplétion de la recherche par pseudo et par nom affiché.
    index('users_username_trgm_idx').using('gin', sql`${table.username} gin_trgm_ops`),
    index('users_display_name_trgm_idx').using('gin', sql`${table.displayName} gin_trgm_ops`),
  ],
);

export const conversations = pgTable('conversations', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  type: conversationTypeEnum('type').notNull(),
  name: text('name'),
  /** Photo du groupe (même stockage que les avatars utilisateurs). */
  avatarUrl: text('avatar_url'),
  /** Identité de repli quand il n'y a pas de photo. */
  emoji: text('emoji'),
  color: text('color'),
  description: text('description'),
  /** Créateur du groupe : badge « propriétaire », non révocable par les autres. */
  ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
  /** Qui peut écrire : `all` (défaut) ou `admins`. */
  sendPermission: text('send_permission').notNull().default('all'),
  /** Qui peut ajouter des membres : `all` (défaut) ou `admins`. */
  addPermission: text('add_permission').notNull().default('all'),
  /** Bascule irréversible vers le chiffrement de bout en bout. */
  e2eeSince: timestamp('e2ee_since', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conversationRoleEnum = pgEnum('conversation_role', ['admin', 'member']);

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    mutedAt: timestamp('muted_at', { withTimezone: true }),
    /** Discussion masquée : elle n'apparaît plus dans la liste. */
    hidden: boolean('hidden').notNull().default(false),
    /**
     * Qui pilote le groupe. Sans rôle, le premier arrivé pouvait renommer la
     * discussion de tout le monde et en expulser n'importe qui.
     */
    role: conversationRoleEnum('role').notNull().default('member'),
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.userId] })],
);

/**
 * Lien d'invitation à rejoindre un groupe. Le jeton est la seule chose que
 * porte le lien partagé : il ne permet rien d'autre que de demander l'entrée.
 */
export const conversationInvites = pgTable(
  'conversation_invites',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** `null` = illimité. */
    maxUses: integer('max_uses'),
    uses: integer('uses').notNull().default(0),
    /** L'admin doit approuver chaque demande avant l'entrée. */
    requiresApproval: boolean('requires_approval').notNull().default(false),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('conversation_invites_conversation_idx').on(table.conversationId)],
);

export const joinRequestStatusEnum = pgEnum('join_request_status', [
  'pending',
  'approved',
  'rejected',
]);

/** Demande d'entrée déposée via un lien d'invitation. */
export const conversationJoinRequests = pgTable(
  'conversation_join_requests',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    inviteId: text('invite_id')
      .notNull()
      .references(() => conversationInvites.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: joinRequestStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedById: text('resolved_by_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    uniqueIndex('conversation_join_requests_invite_user_idx').on(
      table.inviteId,
      table.userId,
    ),
    index('conversation_join_requests_conversation_status_idx').on(
      table.conversationId,
      table.status,
    ),
  ],
);

/** Comptes bloqués par un utilisateur. */
export const blocks = pgTable(
  'blocks',
  {
    blockerId: text('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: text('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.blockerId, table.blockedId] })],
);

/**
 * Jetons de notification push (Expo Push Service) par appareil.
 *
 * La clé est le couple (compte, appareil) — jamais le jeton seul : un jeton est
 * une valeur publique une fois qu'un appareil l'a envoyée quelque part, et un
 * compte ne doit pas pouvoir la rattacher à lui pour détourner les alertes d'un
 * autre, ni la supprimer pour les faire taire.
 */
export const pushTokens = pgTable(
  'push_tokens',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform').notNull().default('android'),
    /** Appareil propriétaire du jeton (JWT), pour le nettoyage ciblé. */
    deviceId: text('device_id'),
    /** Adresse de l'API telle que l'appareil la joint (pour les images). */
    baseUrl: text('base_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('push_tokens_user_idx').on(table.userId),
    uniqueIndex('push_tokens_user_token_idx').on(table.userId, table.token),
  ],
);

export type MessageAttachmentType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | 'GIF' | 'STICKER';

/** Pièce jointe d'un message (photo pour l'instant, extensible). */
export interface MessageAttachment {
  type: MessageAttachmentType;
  /** Chemin relatif servi par l'API (« /uploads/… »), ou URL absolue externe
   *  (GIPHY : `https://media*.giphy.com/…`) chargée directement par l'app. */
  url: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  /** Durée d'un message vocal, en millisecondes. */
  duration?: number;
  /** Forme d'onde d'un message vocal (au plus 40 valeurs 0..1) : métadonnée
   *  d'affichage du chemin clair, bornée par le gateway. */
  waveform?: number[];
  /** Nom d'origine (fichiers). */
  name?: string;
  /** GIF GIPHY : sticker animé transparent (sinon GIF plein cadre). */
  sticker?: boolean;
  /** Identifiant du GIF côté GIPHY. */
  giphyId?: string;
  /** Compte GIPHY source (attribution). */
  username?: string;
  /** Titre du GIF GIPHY. */
  title?: string;
  /** Aperçu statique (lenteur réseau) — même domaine allowlisté que `url`. */
  stillUrl?: string;
  /** Sticker Mbolo : identifiant stable dans le catalogue local. */
  stickerId?: string;
  /** Pack d'origine du sticker (local, personnel, futur pack téléchargé). */
  stickerPackId?: string;
  /** Nom accessible du sticker, affiché par les lecteurs d'écran. */
  stickerName?: string;
}

/**
 * Pièce jointe chiffrée de bout en bout : une **référence** vers un fichier
 * opaque. Le serveur ne connaît que l'existence du blob et de quel droit on peut
 * le lire ; ni URL, ni clé, ni nonce, ni empreinte, ni nature. Le contenu et sa
 * description (type, nom, dimensions) vivent exclusivement dans l'enveloppe Olm,
 * que le serveur ne lit jamais.
 *
 * Le champ `url` est délibérément absent : `MediaUrlInterceptor` ne réécrit que
 * les chaînes « /uploads/… », donc une référence chiffrée lui échappe — voulu.
 */
export interface E2eeAttachmentRef {
  /** Identifiant de l'upload chiffré, servi par `GET /uploads/:id`. */
  uploadId: string;
}

/** Fichier importé par un utilisateur, avant (ou après) son envoi. */
export const uploads = pgTable(
  'uploads',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    /** Nom d'origine du fichier, affiché pour les documents. */
    name: text('name'),
    width: integer('width'),
    height: integer('height'),
    /** Durée d'un vocal ou d'une vidéo importée, en millisecondes. */
    durationMs: integer('duration_ms'),
    /**
     * true pour un fichier chiffré de bout en bout : le serveur ne sait pas le
     * décoder, ne le sert que par `GET /uploads/:id` et à un membre de la
     * conversation liée. Ces fichiers ne passent jamais par la route signée des
     * médias en clair.
     */
    encrypted: boolean('encrypted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('uploads_user_idx').on(table.userId)],
);

/**
 * Clé d'**idempotence** d'un téléversement de média chiffré.
 *
 * Le client fournit une clé stable (dérivée de l'identité durable de sa
 * préparation média) ; rejouer la même requête après un timeout, une coupure ou
 * un redémarrage doit rendre le **même** `uploadId` sans créer un second blob.
 *
 * La clé primaire est `(user_id, key)` : deux comptes ne peuvent pas se marcher
 * dessus, et une clé n'est jamais réutilisable hors de son propriétaire. La
 * ligne porte aussi le contexte autorisé (`conversation_id`) et l'empreinte du
 * ciphertext **calculée par le serveur** : une même clé avec un autre contenu
 * est un conflit, jamais un remplacement silencieux.
 *
 * `stored_url` est le chemin alloué **avant** l'écriture du fichier : une reprise
 * réécrit exactement le même chemin, donc un arrêt entre l'écriture et la
 * validation SQL ne laisse pas d'orphelin.
 */
export const uploadIdempotency = pgTable(
  'upload_idempotency',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Clé fournie par le client, opaque et stable pour une même opération. */
    key: text('key').notNull(),
    /** Conversation déclarée au premier envoi : le contexte ne peut pas changer. */
    conversationId: text('conversation_id').notNull(),
    /** Empreinte SHA-256 du ciphertext, calculée à partir des octets reçus. */
    contentSha256: text('content_sha256').notNull(),
    size: integer('size').notNull(),
    /** Chemin relatif réservé avant écriture (« /uploads/2026/11/<uuid>.bin »). */
    storedUrl: text('stored_url').notNull(),
    /** Nature du clair d'origine : rend la réponse de rejeu identique à l'originale. */
    kind: text('kind').notNull(),
    /**
     * Jeton de **fencing** : régénéré à chaque reprise. Une tentative ne peut
     * valider ou nettoyer que si la ligne porte encore *son* jeton ; une
     * tentative périmée devient inoffensive, quel que soit son retard.
     */
    attemptToken: text('attempt_token').notNull(),
    /** `pending` tant que le blob et la ligne ne sont pas validés ensemble. */
    state: text('state').notNull().default('pending'),
    uploadId: text('upload_id').references(() => uploads.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.key] }),
    uniqueIndex('upload_idempotency_upload_idx').on(table.uploadId),
    index('upload_idempotency_state_idx').on(table.state, table.updatedAt),
  ],
);

/**
 * Journal durable des **effets secondaires** d'un message : ce qui doit être
 * diffusé une fois, et une seule, même si la requête d'envoi est répétée ou si
 * le serveur tombe entre l'écriture du message et la diffusion.
 *
 * Trois natures de ligne, distinguées par `kind` :
 * - `socket` : l'événement `message:new` (une ligne par message) ;
 * - `push_fanout` : le calcul des destinataires de notification (une ligne) ;
 * - `push` : une notification **par destinataire**, matérialisée par le fan-out.
 *
 * L'unicité `(message_id, kind, user_id)` est l'arbitre : la réémission d'un
 * message déjà enregistré ne crée aucune ligne, donc aucun nouvel envoi.
 * Les lignes sont écrites dans la **même transaction** que le message.
 */
export const messageEvents = pgTable(
  'message_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id').notNull(),
    kind: text('kind').notNull(),
    /** Destinataire d'un push. Chaîne vide pour les lignes portées par le message. */
    userId: text('user_id').notNull().default(''),
    /** `pending` tant que l'effet n'est pas réputé produit. */
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /**
     * Bail du worker qui traite la ligne. Une ligne dont le bail est expiré
     * peut être reprise : c'est la reprise après redémarrage.
     */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /**
     * Jeton de **fencing** : régénéré à chaque prise de bail. Une tentative ne
     * peut clore, reporter ou libérer que si la ligne porte encore *son* jeton.
     * Un worker dont le bail a expiré devient donc inoffensif, même s'il
     * termine son envoi après coup.
     */
    claimToken: text('claim_token'),
    /** Report d'une tentative en échec (fournisseur indisponible…). */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('message_events_dedupe_idx').on(table.messageId, table.kind, table.userId),
    index('message_events_pending_idx').on(table.status, table.nextAttemptAt),
  ],
);

/**
 * Lien fichier chiffré ↔ conversation. C'est une **métadonnée** (qui a le droit
 * de télécharger), jamais le contenu : le serveur ne peut pas rattacher un
 * ciphertext à sa conversation, alors le client le déclare à l'envoi et le
 * serveur vérifie l'appartenance avant de l'enregistrer.
 */
export const uploadConversations = pgTable(
  'upload_conversations',
  {
    uploadId: text('upload_id')
      .primaryKey()
      .references(() => uploads.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('upload_conversations_conversation_idx').on(table.conversationId)],
);

export const messages = pgTable(
  'messages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: text('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    /** `none` (historique en clair) ou `v1` (enveloppe chiffrée opaque). */
    encryption: text('encryption').notNull().default('none'),
    /** Enveloppe chiffrée base64 ; le serveur ne la déchiffre jamais. */
    payload: text('payload'),
    /** `prekey` pour le premier message d'une session, `normal` ensuite. */
    payloadType: text('payload_type'),
    /** Appareil émetteur (JWT) pour rattacher l'enveloppe à ses clés. */
    senderDeviceId: text('sender_device_id'),
    /** Texte Unicode normal, ou sticker référencé par son catalogue local. */
    type: text('type').notNull().default('text'),
    /** Référence de catalogue d'un sticker (« pack/sticker »), null sinon. */
    stickerRef: text('sticker_ref'),
    /** Pièce jointe (photo, vidéo…), null pour un message texte. */
    attachment: jsonb('attachment').$type<MessageAttachment>(),
    /**
     * Référence d'une pièce jointe chiffrée : le ciphertext, dont la clé voyage
     * dans `payload`. Alternative de `attachment` : un message n'a jamais les
     * deux. Aucune URL ici, donc rien que l'intercepteur de médias puisse signer.
     */
    encryptedAttachment: jsonb('encrypted_attachment').$type<E2eeAttachmentRef>(),
    /**
     * Identifiant d'envoi généré par l'appareil émetteur. Une reprise après
     * une coupure renvoie le même message au lieu d'en créer un doublon.
     */
    clientId: text('client_id'),
    /**
     * Message cité par une « réponse ». Un lien et non une copie : la citation
     * suit le fil, et l'original garde sa place.
     */
    replyToId: text('reply_to_id'),
    /** Envoi silencieux : pas de son ni de vibration à la réception. */
    silent: boolean('silent').notNull().default(false),
    /** Lecture unique : le client masque le contenu jusqu’à ouverture. */
    viewOnce: boolean('view_once').notNull().default(false),
    /**
     * Supprimé pour tous. Le contenu et la pièce jointe sont effacés avec cette
     * date ; sans elle, un message vide ressemblerait à un message supprimé.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('messages_conversation_created_idx').on(table.conversationId, table.createdAt),
    uniqueIndex('messages_sender_client_idx').on(table.senderId, table.clientId),
  ],
);

/**
 * Accusés de réception, par membre et par message : ce que l'appareil du
 * destinataire a effectivement reçu (`delivered_at`) et ce qu'il a lu
 * (`read_at`). C'est ce qui distingue la coche « envoyée », « reçue » et « lue ».
 */
export const messageReceipts = pgTable(
  'message_receipts',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId] }),
    index('message_receipts_user_idx').on(table.userId),
  ],
);

/** Réactions emoji : une par membre et par emoji sur un message. */
export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Référence de sticker (« mbolo-panther-2d/amour »). La colonne garde son
     *  ancien nom SQL `emoji` : aucun changement de schéma n'est nécessaire. */
    reaction: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId, table.reaction] }),
    index('message_reactions_message_idx').on(table.messageId),
  ],
);

/**
 * Messages retirés de la vue d'un seul membre (« supprimer pour moi »). La ligne
 * reste en base : les autres membres continuent de la lire. C'est une liste
 * d'interdits par compte, pas une suppression.
 */
export const messageHides = pgTable(
  'message_hides',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId] }),
    index('message_hides_user_idx').on(table.userId),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('password_reset_tokens_user_idx').on(table.userId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    /** Appareil lisible (« Samsung Galaxy A54 · Android 14 ») pour la liste des sessions. */
    deviceName: text('device_name'),
    platform: text('platform'),
    /** Identifiant d'appareil porté par le JWT (appareil unique actif). */
    deviceId: text('device_id'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('refresh_tokens_user_idx').on(table.userId)],
);

/**
 * Cache du géocodage inverse : une cellule arrondie (jamais la position
 * exacte d'un utilisateur) donne le nom de la ville et le pays. Les
 * coordonnées ne servent qu'au calcul de distance (anti-téléport) et ne sont
 * rattachées à aucun compte.
 */
export const geoCityCache = pgTable('geo_city_cache', {
  cell: text('cell').primaryKey(),
  city: text('city').notNull(),
  country: text('country'),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Appareil E2EE actif : seules les clés publiques sont stockées. */
export const e2eeDevices = pgTable(
  'e2ee_devices',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Identifiant d'appareil issu du JWT, stable entre les refresh tokens. */
    deviceId: text('device_id').notNull(),
    identityKey: text('identity_key').notNull(),
    signingKey: text('signing_key').notNull(),
    signedPrekey: text('signed_prekey'),
    signedPrekeySignature: text('signed_prekey_signature'),
    /** Clé de secours signée, utilisée quand la réserve est épuisée. */
    fallbackPrekey: text('fallback_prekey'),
    fallbackPrekeySignature: text('fallback_prekey_signature'),
    fallbackPrekeyKeyId: text('fallback_prekey_key_id'),
    deviceName: text('device_name'),
    platform: text('platform'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('e2ee_devices_user_device_idx').on(table.userId, table.deviceId),
    uniqueIndex('e2ee_devices_active_user_idx')
      .on(table.userId)
      .where(sql`${table.revokedAt} is null`),
  ],
);

/** Clés publiques à usage unique, consommées à la création d'une session Olm. */
export const e2eeOneTimePrekeys = pgTable(
  'e2ee_one_time_prekeys',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    deviceRowId: text('device_row_id')
      .notNull()
      .references(() => e2eeDevices.id, { onDelete: 'cascade' }),
    keyId: text('key_id').notNull(),
    publicKey: text('public_key').notNull(),
    /** Signature Ed25519 de la clé publique par l'identité de l'appareil. */
    signature: text('signature'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('e2ee_prekeys_device_key_idx').on(table.deviceRowId, table.keyId),
    index('e2ee_prekeys_device_used_idx').on(table.deviceRowId, table.usedAt),
  ],
);

// ---------------------------------------------------------------------------
// Social (ADR-0001) — plan de données séparé du chat E2EE.
// Aucune table de cette section ne référence `uploads`, `messages` ou les
// enveloppes chiffrées : la séparation des plans est structurelle.
// ---------------------------------------------------------------------------

/** Qui peut interagir (commenter, mentionner, reposter) avec un compte. */
export const socialInteractorEnum = pgEnum('social_interactor', [
  'everyone',
  'followers',
  'following',
  'nobody',
]);

/** `pending` = demande d'abonnement à un compte privé, en attente d'accord. */
export const followStatusEnum = pgEnum('follow_status', ['accepted', 'pending']);

/** Posts et reels partagent le même agrégat ; seul le rendu diffère. */
export const publicationKindEnum = pgEnum('publication_kind', ['post', 'reel']);

export const publicationFormatEnum = pgEnum('publication_format', [
  'text',
  'image',
  'carousel',
  'video',
]);

export const publicationVisibilityEnum = pgEnum('publication_visibility', [
  'public',
  'followers',
  'private',
]);

/** Statut de modération, filtré dans les requêtes de feed et de détail. */
export const moderationStatusEnum = pgEnum('moderation_status', [
  'pending',
  'approved',
  'flagged',
  'removed',
]);

export const reactionKindEnum = pgEnum('reaction_kind', ['like', 'love', 'fire', 'clap']);

export const storyAudienceEnum = pgEnum('story_audience', ['everyone', 'followers']);

export const mediaKindEnum = pgEnum('media_kind', ['image', 'video', 'audio']);

export const mediaStatusEnum = pgEnum('media_status', [
  'pending',
  'uploaded',
  'processing',
  'ready',
  'failed',
]);

export const mediaJobKindEnum = pgEnum('media_job_kind', [
  'image_variants',
  'video_poster',
  'video_transcode',
  'cleanup',
]);

export const mediaJobStatusEnum = pgEnum('media_job_status', [
  'pending',
  'running',
  'done',
  'failed',
]);

export const socialNotificationTypeEnum = pgEnum('social_notification_type', [
  'like',
  'comment',
  'reply',
  'mention',
  'repost',
  'follow',
  'follow_request',
  'follow_accepted',
  'story_reply',
  'moderation',
]);

export const reportTargetTypeEnum = pgEnum('report_target_type', [
  'publication',
  'comment',
  'story',
  'user',
]);

export const reportReasonEnum = pgEnum('report_reason', [
  'spam',
  'harassment',
  'hate',
  'nudity',
  'violence',
  'misinformation',
  'other',
]);

export const reportStatusEnum = pgEnum('report_status', [
  'open',
  'reviewing',
  'resolved',
  'dismissed',
]);

export const moderationActionEnum = pgEnum('moderation_action', [
  'hide',
  'remove',
  'restore',
  'warn',
  'suspend',
  'dismiss',
]);

export type User = typeof users.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageReceipt = typeof messageReceipts.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type PushToken = typeof pushTokens.$inferSelect;
export type Upload = typeof uploads.$inferSelect;
export type MessageEvent = typeof messageEvents.$inferSelect;
export type GeoCityCache = typeof geoCityCache.$inferSelect;

/**
 * Préférences sociales, séparées des réglages de confidentialité du chat
 * (`users.write_permission`, `call_permission`…) : un compte peut être ouvert
 * aux commentaires sans changer qui peut lui écrire.
 */
export const userSocialSettings = pgTable('user_social_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Qui peut commenter les publications. */
  commentPermission: socialInteractorEnum('comment_permission').notNull().default('everyone'),
  /** Qui peut mentionner le compte dans une publication ou un commentaire. */
  mentionPermission: socialInteractorEnum('mention_permission').notNull().default('everyone'),
  /** Qui peut reposter le contenu du compte. */
  repostPermission: socialInteractorEnum('repost_permission').notNull().default('everyone'),
  /** Audience par défaut des stories. */
  storyAudience: storyAudienceEnum('story_audience').notNull().default('followers'),
  notifyLikes: boolean('notify_likes').notNull().default(true),
  notifyComments: boolean('notify_comments').notNull().default(true),
  notifyFollows: boolean('notify_follows').notNull().default(true),
  notifyMentions: boolean('notify_mentions').notNull().default(true),
  notifyReposts: boolean('notify_reposts').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Graphe social orienté : `followerId` suit `followingId`.
 *
 * La clé primaire composite rend un abonnement unique par couple. Pour un compte
 * privé, la ligne naît `pending` et passe à `accepted` sur approbation ; un
 * compte public écrit directement `accepted`.
 */
export const follows = pgTable(
  'follows',
  {
    followerId: text('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followingId: text('following_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: followStatusEnum('status').notNull().default('accepted'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followingId] }),
    index('follows_following_status_idx').on(table.followingId, table.status),
    index('follows_follower_status_idx').on(table.followerId, table.status),
  ],
);

/** Variante générée d'un média social (vignette, poster, rendu plus léger). */
export interface MediaVariant {
  /** Libellé technique (« thumb », « poster », « 720p »), stable pour le client. */
  label: string;
  width: number;
  height: number;
  /** URL publique du CDN, dérivée de la clé de stockage. */
  url: string;
  sizeBytes: number;
  /**
   * Clé de l'objet dans le stockage. Indispensable pour signer une variante
   * dont la publication n'est pas publique ; absente des lignes antérieures,
   * auquel cas elle est redéduite de `url` (`keyFromPublicUrl`).
   */
  key?: string;
}

/**
 * Objet média du réseau social (S3/R2), distinct de `uploads` (chat).
 *
 * Le client ne crée jamais la ligne : `POST /media/uploads` la crée `pending` et
 * rend une URL présignée ; la confirmation (`complete`) vérifie les octets réels
 * avant `uploaded`, puis le worker média passe à `processing` / `ready`.
 * Une publication ne peut référencer qu'un asset `ready` appartenant à l'auteur.
 */
export const mediaAssets = pgTable(
  'media_assets',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Bucket logique de la configuration stockage (« social-public », …). */
    bucket: text('bucket').notNull(),
    /** Clé de l'objet, immuable : jamais réécrite pour un même asset. */
    storageKey: text('storage_key').notNull(),
    kind: mediaKindEnum('kind').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    /** Durée d'une vidéo ou d'un son, en millisecondes. */
    durationMs: integer('duration_ms'),
    status: mediaStatusEnum('status').notNull().default('pending'),
    /** Variantes générées par le worker (`sharp` / `ffmpeg`). */
    variants: jsonb('variants').$type<MediaVariant[]>(),
    /** Empreinte SHA-256 calculée côté serveur à la confirmation. */
    checksum: text('checksum'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Suppression logique avant purge de l'objet S3 et du cache CDN. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('media_assets_storage_key_idx').on(table.storageKey),
    index('media_assets_owner_created_idx').on(table.ownerId, table.createdAt),
    index('media_assets_status_idx').on(table.status, table.updatedAt),
  ],
);

/**
 * File de travail du pipeline média, en PostgreSQL (pas de Redis en v1).
 *
 * Reprend le motif de `message_events` : bail `locked_until` + `claim_token` de
 * fencing, pour qu'un worker dont le bail a expiré ne puisse pas clore un job
 * repris par un autre. Les workers prennent les lignes avec
 * `FOR UPDATE SKIP LOCKED` (index `status, next_attempt_at`).
 */
export const mediaJobs = pgTable(
  'media_jobs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    assetId: text('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    kind: mediaJobKindEnum('kind').notNull(),
    status: mediaJobStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    claimToken: text('claim_token'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('media_jobs_pending_idx').on(table.status, table.nextAttemptAt),
    index('media_jobs_asset_idx').on(table.assetId),
    // Un seul job par asset et par type : rejouer une demande de purge ou de
    // variante ne doit pas empiler des lignes identiques.
    uniqueIndex('media_jobs_asset_kind_idx').on(table.assetId, table.kind),
  ],
);

/**
 * Catalogue des sons de reels. Le son est un média audio appartenant au compte
 * qui l'a déposé ; `usageCount` est tenu par l'API, jamais par le client.
 */
export const sounds = pgTable(
  'sounds',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text('title').notNull(),
    assetId: text('asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    /** Auteur du son, `null` pour un son de catalogue ou orphelin. */
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    durationMs: integer('duration_ms'),
    usageCount: integer('usage_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sounds_usage_idx').on(table.usageCount),
    index('sounds_created_by_idx').on(table.createdById),
  ],
);

/**
 * Style d'une page de post texte multi-cartes : fond et couleur de texte
 * propres à la carte (clés des catalogues mobiles). Toutes les clés sont
 * optionnelles ; une page sans style garde le rendu par défaut.
 */
export interface TextPageStyle {
  background?: string;
  color?: string;
  /** Police propre à la page (clé du catalogue mobile). */
  font?: string;
  /** Alignement propre à la page (`left`/`center`/`right`). */
  align?: string;
  /** Taille manuelle de la page (points), absente = auto-partagée. */
  size?: number;
}

/**
 * Publication unifiée : post ou reel.
 *
 * Un seul agrégat pour les deux kinds (ADR-0001 §2.2) : interactions, compteurs,
 * commentaires et modération sont écrits une fois. `clientId` rend la création
 * idempotente par auteur ; `hotScore` est alimenté par le worker de classement et
 * n'est jamais accepté depuis le client.
 */
export const publications = pgTable(
  'publications',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: publicationKindEnum('kind').notNull().default('post'),
    format: publicationFormatEnum('format').notNull().default('text'),
    /** Légende / texte du post. Le média est décrit par `publication_media`. */
    caption: text('caption'),
    /**
     * Fond du post texte : clé de palette choisie par l'auteur
     * (`FeedTextPost.backgrounds` côté mobile). `null` = dégradé par défaut.
     * Ignoré pour les publications avec média.
     */
    textBackground: text('text_background'),
    /**
     * Pages d'un post texte multi-cartes (carrousel de textes). `null` pour
     * une publication classique : `caption` porte alors tout le texte.
     * Quand présent, `caption` reflète la première page (recherche, extraits).
     */
    textPages: jsonb('text_pages').$type<string[]>(),
    /**
     * Style par page d'un post texte multi-cartes, aligné sur `text_pages`
     * (même index). `null` ou entrée sans clé = style par défaut de la page.
     * Chaque carte est indépendante, comme les carrousels Instagram.
     */
    textPageStyles: jsonb('text_page_styles').$type<Array<TextPageStyle | null>>(),
    /**
     * Police du post texte (clé du catalogue mobile : `classic`, `modern`,
     * `typewriter`, `bold`, `elegant`). `null` = police système par défaut.
     * Ignorée pour les publications avec média.
     */
    textFont: text('text_font'),
    /**
     * Alignement du texte d'un post texte : `left`, `center` ou `right`.
     * `null` = centré, le rendu historique.
     */
    textAlign: text('text_align'),
    /**
     * Couleur du texte d'un post texte (clé du catalogue mobile : `white`,
     * `cream`, `yellow`…). `null` = couleur du thème, le rendu historique.
     */
    textColor: text('text_color'),
    /**
     * Titre facultatif d'un post texte, saisi dans un champ dédié. `null` =
     * pas de titre : le client retombe sur la convention « première ligne ».
     * Ignoré pour les publications avec média.
     */
    textTitle: text('text_title'),
    /**
     * Taille de police choisie à la main pour un post texte (points),
     * `null` = auto-ajustement selon le contenu. Ignoré pour les
     * publications avec média.
     */
    textSize: integer('text_size'),
    /**
     * Lieu facultatif d'un post texte (nom de ville/lieu saisi ou détecté
     * par géocodage inverse). `null` = pas de localisation.
     */
    location: text('location'),
    /**
     * Aperçu du premier lien du texte (métadonnées OG récupérées côté
     * serveur à la publication). `null` = pas de lien ou page muette.
     */
    linkPreview: jsonb('link_preview').$type<{
      url: string;
      host: string;
      title: string;
      description: string;
      imageUrl: string | null;
    }>(),
    /**
     * Filtre visuel choisi à la publication (clé du catalogue mobile,
     * ex. `vivid`, `warm`). `null` = rendu brut. Sans effet sur un post
     * texte, qui a déjà son fond dédié.
     */
    mediaFilter: text('media_filter'),
    visibility: publicationVisibilityEnum('visibility').notNull().default('public'),
    moderationStatus: moderationStatusEnum('moderation_status').notNull().default('pending'),
    /** Son utilisé par un reel, facultatif. */
    soundId: text('sound_id').references(() => sounds.id, { onDelete: 'set null' }),
    /**
     * Publication citée (« Citer » façon Instagram) : la citation est une
     * publication à part entière qui copie les médias de l'originale et
     * incrémente son compteur de republications. `set null` : la citation
     * survit à la suppression de l'originale.
     */
    quotedPublicationId: text('quoted_publication_id').references(
      (): AnyPgColumn => publications.id,
      { onDelete: 'set null' },
    ),
    /** Score de classement recalculé hors ligne, jamais fourni par le client. */
    hotScore: integer('hot_score').notNull().default(0),
    /** Compteurs dénormalisés, incrémentés en transaction SQL uniquement. */
    likeCount: integer('like_count').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    repostCount: integer('repost_count').notNull().default(0),
    saveCount: integer('save_count').notNull().default(0),
    /** Partages (envoi en discussion, feuille système, copie de lien). */
    shareCount: integer('share_count').notNull().default(0),
    viewCount: integer('view_count').notNull().default(0),
    /** Clé d'idempotence fournie par l'appareil, unique par auteur. */
    clientId: text('client_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Suppression logique : les interactions restent auditables jusqu'à purge. */
    /**
     * Dernière retouche du texte par l'auteur (légende, pages, titre). `null`
     * = jamais modifiée. Distinct de `updated_at`, qui bouge aussi pour la
     * modération : c'est ce champ qui affiche « Modifié » dans l'app.
     */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /**
     * Vecteur de recherche plein texte, tenu par PostgreSQL. La colonne n'est
     * jamais écrite par l'application ; l'index GIN accompagne la migration.
     */
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('french', coalesce("caption", ''))`,
    ),
  },
  (table) => [
    index('publications_search_idx').using('gin', table.searchVector),
    uniqueIndex('publications_author_client_idx').on(table.authorId, table.clientId),
    index('publications_feed_idx').on(table.visibility, table.moderationStatus, table.createdAt),
    index('publications_hot_score_idx').on(table.hotScore),
    // Index du fil : la requête filtre toujours les suppressions et la
    // modération, puis trie par score. Un index partiel évite de parcourir les
    // lignes invisibles avant de trouver la page demandée.
    index('publications_feed_hot_idx')
      .on(table.hotScore)
      .where(sql`deleted_at is null and moderation_status in ('pending', 'approved')`),
    index('publications_visibility_hot_idx').on(table.visibility, table.hotScore),
    index('publications_author_created_idx').on(table.authorId, table.createdAt),
    index('publications_quoted_idx').on(table.quotedPublicationId),
  ],
);

/** Médias attachés à une publication, ordonnés (carrousel). */
export const publicationMedia = pgTable(
  'publication_media',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    publicationId: text('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),
    /** Position dans le carrousel, à partir de 0. */
    position: integer('position').notNull().default(0),
    /** Texte alternatif saisi par l'auteur (accessibilité). */
    altText: text('alt_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('publication_media_position_idx').on(table.publicationId, table.position),
    index('publication_media_asset_idx').on(table.assetId),
  ],
);

/** Nature d'un commentaire : texte, vocal, photo ou sticker. */
export const commentKindEnum = pgEnum('comment_kind', ['text', 'audio', 'image', 'sticker']);

/** Commentaire ou réponse (`parentId`) à une publication. */
export const comments = pgTable(
  'comments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    publicationId: text('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Réponse à un autre commentaire ; `null` pour un commentaire racine. */
    parentId: text('parent_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'cascade',
    }),
    kind: commentKindEnum('kind').notNull().default('text'),
    /** Corps texte ; vide pour un commentaire purement vocal, photo ou sticker. */
    body: text('body').notNull().default(''),
    /** Photo ou vocal : asset `ready` du pipeline média social. */
    mediaAssetId: text('media_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    /** Note vocale jointe en légende d'une photo ou d'un sticker. */
    voiceMediaAssetId: text('voice_media_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    /** Sticker de catalogue (« pack/sticker »), sans fichier à stocker. */
    stickerRef: text('sticker_ref'),
    likeCount: integer('like_count').notNull().default(0),
    replyCount: integer('reply_count').notNull().default(0),
    /** Épinglé par l'auteur de la publication : affiché en tête de fil. */
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    moderationStatus: moderationStatusEnum('moderation_status').notNull().default('pending'),
    /** Clé d'idempotence fournie par l'appareil, unique par auteur. */
    clientId: text('client_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('comments_author_client_idx').on(table.authorId, table.clientId),
    index('comments_publication_created_idx').on(table.publicationId, table.createdAt),
    index('comments_parent_idx').on(table.parentId),
  ],
);

/** J'aime sur un commentaire (PK composite : un seul par couple). */
export const commentLikes = pgTable(
  'comment_likes',
  {
    commentId: text('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.commentId, table.userId] })],
);

/** Kinds de réaction emoji sur un commentaire. */
export const commentReactionKindEnum = pgEnum('comment_reaction_kind', [
  'heart',
  'laugh',
  'wow',
  'fire',
  'clap',
]);

/** « Je n'aime pas » sur un commentaire (PK composite : un seul par couple). */
export const commentDislikes = pgTable(
  'comment_dislikes',
  {
    commentId: text('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.commentId, table.userId] })],
);

/**
 * Réaction emoji sur un commentaire : une seule par utilisateur, modifiable.
 * Distincte du j'aime/« Je n'aime pas » qui alimente le score de tri.
 */
export const commentReactions = pgTable(
  'comment_reactions',
  {
    commentId: text('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: commentReactionKindEnum('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.commentId, table.userId] }),
    index('comment_reactions_comment_idx').on(table.commentId),
  ],
);

/** Réaction à une publication : une seule par utilisateur, type modifiable. */
export const publicationReactions = pgTable(
  'publication_reactions',
  {
    publicationId: text('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: reactionKindEnum('kind').notNull().default('like'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.publicationId, table.userId] }),
    index('publication_reactions_user_idx').on(table.userId),
  ],
);

/**
 * Collection d'enregistrements (« Recettes », « Voyages »…), comme Instagram.
 * Privée : seul son propriétaire la voit.
 */
export const saveCollections = pgTable(
  'save_collections',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('save_collections_user_idx').on(table.userId),
    uniqueIndex('save_collections_user_name_idx').on(table.userId, sql`lower(${table.name})`),
  ],
);

/** Publication enregistrée par un utilisateur. */
export const publicationSaves = pgTable(
  'publication_saves',
  {
    publicationId: text('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Collection choisie, `null` = « Tous les enregistrements » seulement. */
    collectionId: text('collection_id').references(() => saveCollections.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.publicationId, table.userId] }),
    index('publication_saves_user_idx').on(table.userId),
    index('publication_saves_collection_idx').on(table.collectionId),
  ],
);

/** Repost d'une publication par un utilisateur. */
export const publicationReposts = pgTable(
  'publication_reposts',
  {
    publicationId: text('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.publicationId, table.userId] }),
    index('publication_reposts_user_idx').on(table.userId),
  ],
);

/** Vue unique par utilisateur (une ligne à vie, pas une vue par affichage). */
export const publicationViews = pgTable(
  'publication_views',
  {
    publicationId: text('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Temps de visionnage cumulé le plus élevé observé pour cette vue, en
     * millisecondes. Signal de classement (`watch time`), jamais fourni
     * directement comme vérité : le serveur borne la valeur à la durée du média
     * et ne la fait que croître.
     */
    watchMs: integer('watch_ms').notNull().default(0),
    /** La vue a atteint la fin du média au moins une fois. */
    completed: boolean('completed').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.publicationId, table.userId] }),
    index('publication_views_user_idx').on(table.userId),
    // Agrégats de classement par publication (vues uniques, durée moyenne).
    index('publication_views_publication_idx').on(table.publicationId),
  ],
);

/** Cible d'un retour négatif : une publication précise ou un auteur entier. */
export const feedbackTargetEnum = pgEnum('feedback_target', ['publication', 'author']);

/**
 * Retours négatifs du fil (« Pas intéressé », « Masquer cet auteur »).
 *
 * Le serveur les applique **en SQL** dans le fil : un contenu écarté ne revient
 * pas par une autre page ni par un autre onglet. La cible est polymorphe, donc
 * `targetId` n'a pas de clé étrangère ; la purge des comptes supprime les lignes
 * par `userId`.
 */
export const contentFeedback = pgTable(
  'content_feedback',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: feedbackTargetEnum('target_type').notNull(),
    /** `publications.id` ou `users.id` selon `targetType`. */
    targetId: text('target_id').notNull(),
    /** Motif technique, extensible (`not_interested` pour l'instant). */
    kind: text('kind').notNull().default('not_interested'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.targetType, table.targetId] }),
    index('content_feedback_target_idx').on(table.targetType, table.targetId),
  ],
);

/**
 * Session de fil : l'ordre exact des publications proposées à un visiteur.
 *
 * Le classement dépend de signaux mouvants (score, affinité, déjà-vu) : paginer
 * dessus directement ferait sauter ou répéter des lignes dès qu'une interaction
 * arrive entre deux pages. La session fige l'ordre une fois pour toutes ; le
 * curseur ne porte plus qu'un décalage.
 */
export const feedSessions = pgTable(
  'feed_sessions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Onglet d'origine : `for-you` ou `local` (les abonnements sont chronologiques). */
    tab: text('tab').notNull(),
    /** Ordre figé de la session (identifiants de publications). */
    publicationIds: jsonb('publication_ids').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('feed_sessions_user_idx').on(table.userId, table.createdAt),
    index('feed_sessions_expiry_idx').on(table.expiresAt),
  ],
);

/** Hashtag normalisé (minuscules, sans `#`), unique dans le catalogue. */
export const hashtags = pgTable(
  'hashtags',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tag: text('tag').notNull().unique(),
    usageCount: integer('usage_count').notNull().default(0),
    /** Score de tendance recalculé par worker, jamais fourni par le client. */
    trendScore: integer('trend_score').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('hashtags_trend_idx').on(table.trendScore),
    index('hashtags_tag_trgm_idx').using('gin', sql`${table.tag} gin_trgm_ops`),
  ],
);

export const publicationHashtags = pgTable(
  'publication_hashtags',
  {
    publicationId: text('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    hashtagId: text('hashtag_id')
      .notNull()
      .references(() => hashtags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.publicationId, table.hashtagId] }),
    index('publication_hashtags_tag_idx').on(table.hashtagId),
  ],
);

/**
 * Story 24 h. L'audience et les exclusions sont vérifiées en SQL ; les vues
 * uniques vivent dans `story_views`.
 */
export const stories = pgTable(
  'stories',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assetId: text('asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    caption: text('caption'),
    audience: storyAudienceEnum('audience').notNull().default('followers'),
    /** Expiration fixée à la création (`now() + 24 h`), jamais prolongée. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('stories_author_expires_idx').on(table.authorId, table.expiresAt),
    index('stories_expires_idx').on(table.expiresAt),
  ],
);

export const storyViews = pgTable(
  'story_views',
  {
    storyId: text('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.storyId, table.userId] }),
    index('story_views_user_idx').on(table.userId),
  ],
);

/** Comptes explicitement exclus d'une story (en plus de l'audience). */
export const storyExcludedUsers = pgTable(
  'story_excluded_users',
  {
    storyId: text('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.storyId, table.userId] })],
);

/** Story à la une, conservée après l'expiration des stories d'origine. */
export const highlights = pgTable(
  'highlights',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Couverture choisie ; les assets restent vivants tant qu'un highlight les porte. */
    coverAssetId: text('cover_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('highlights_owner_idx').on(table.ownerId, table.createdAt)],
);

/**
 * Élément d'un highlight. `assetId` est copié depuis la story : c'est lui qui
 * survit à l'expiration et à la purge de la story d'origine.
 */
export const highlightItems = pgTable(
  'highlight_items',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    highlightId: text('highlight_id')
      .notNull()
      .references(() => highlights.id, { onDelete: 'cascade' }),
    assetId: text('asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    /** Story d'origine, conservée pour l'audit ; `null` si elle est purgée. */
    sourceStoryId: text('source_story_id').references(() => stories.id, {
      onDelete: 'set null',
    }),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('highlight_items_position_idx').on(table.highlightId, table.position),
    index('highlight_items_story_idx').on(table.sourceStoryId),
  ],
);

/**
 * Notification sociale, créée exclusivement côté serveur dans la transaction de
 * l'interaction. `dedupeKey` (ex. `like:<publication>:<user>`) rend le rejeu
 * inoffensif ; les préférences sont lues dans `user_social_settings` au moment
 * de l'envoi du push.
 */
export const socialNotifications = pgTable(
  'social_notifications',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** Destinataire. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Auteur de l'action ; `null` pour une notification de modération. */
    actorId: text('actor_id').references(() => users.id, { onDelete: 'cascade' }),
    type: socialNotificationTypeEnum('type').notNull(),
    publicationId: text('publication_id').references(() => publications.id, {
      onDelete: 'cascade',
    }),
    commentId: text('comment_id').references(() => comments.id, { onDelete: 'cascade' }),
    storyId: text('story_id').references(() => stories.id, { onDelete: 'cascade' }),
    /** Clé de déduplication, unique par destinataire. */
    dedupeKey: text('dedupe_key').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('social_notifications_dedupe_idx').on(table.userId, table.dedupeKey),
    index('social_notifications_user_created_idx').on(table.userId, table.createdAt),
    index('social_notifications_unread_idx').on(table.userId, table.readAt),
  ],
);

/** Signalement d'un contenu ou d'un compte ; un seul par rapporteur et cible. */
export const reports = pgTable(
  'reports',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: reportTargetTypeEnum('target_type').notNull(),
    /** Identifiant de la cible, selon `targetType` (pas de FK polymorphe). */
    targetId: text('target_id').notNull(),
    reason: reportReasonEnum('reason').notNull(),
    details: text('details'),
    status: reportStatusEnum('status').notNull().default('open'),
    resolvedById: text('resolved_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('reports_reporter_target_idx').on(
      table.reporterId,
      table.targetType,
      table.targetId,
    ),
    index('reports_queue_idx').on(table.status, table.createdAt),
    index('reports_target_idx').on(table.targetType, table.targetId),
  ],
);

/**
 * Journal d'audit de la modération, append-only : une ligne par décision.
 * Aucune mise à jour ni suppression applicative.
 */
export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    reportId: text('report_id').references(() => reports.id, { onDelete: 'set null' }),
    moderatorId: text('moderator_id').references(() => users.id, { onDelete: 'set null' }),
    targetType: reportTargetTypeEnum('target_type').notNull(),
    targetId: text('target_id').notNull(),
    action: moderationActionEnum('action').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('moderation_actions_target_idx').on(table.targetType, table.targetId),
    index('moderation_actions_created_idx').on(table.createdAt),
  ],
);

/** Motif bloqué par la modération (auto-flag), insensible à la casse. */
export const blockedWords = pgTable(
  'blocked_words',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** Forme normalisée (minuscules, sans accents) et unique. */
    word: text('word').notNull().unique(),
    active: boolean('active').notNull().default(true),
    createdById: text('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('blocked_words_active_idx').on(table.active)],
);

export type Follow = typeof follows.$inferSelect;
export type UserSocialSettings = typeof userSocialSettings.$inferSelect;
export type MediaAsset = typeof mediaAssets.$inferSelect;
export type MediaJob = typeof mediaJobs.$inferSelect;
export type Sound = typeof sounds.$inferSelect;
export type Publication = typeof publications.$inferSelect;
export type PublicationMedia = typeof publicationMedia.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type CommentLike = typeof commentLikes.$inferSelect;
export type PublicationReaction = typeof publicationReactions.$inferSelect;
export type PublicationSave = typeof publicationSaves.$inferSelect;
export type PublicationRepost = typeof publicationReposts.$inferSelect;
export type PublicationView = typeof publicationViews.$inferSelect;
export type Hashtag = typeof hashtags.$inferSelect;
export type Story = typeof stories.$inferSelect;
export type StoryView = typeof storyViews.$inferSelect;
export type Highlight = typeof highlights.$inferSelect;
export type HighlightItem = typeof highlightItems.$inferSelect;
export type SocialNotification = typeof socialNotifications.$inferSelect;
export type SocialNotificationType = (typeof socialNotificationTypeEnum.enumValues)[number];
export type Report = typeof reports.$inferSelect;
export type ModerationAction = typeof moderationActions.$inferSelect;
export type BlockedWord = typeof blockedWords.$inferSelect;


