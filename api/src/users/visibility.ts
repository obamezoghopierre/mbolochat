/**
 * Visibilité « tout le monde / mes contacts / personne », appliquée par l'API.
 * Les contacts sont les personnes qui partagent une conversation (directe ou
 * groupe) avec la personne concernée — même définition que la présence.
 */
export type Visibility = 'everyone' | 'contacts' | 'nobody';

export interface ViewerRelation {
  /** Une conversation est partagée entre la cible et le visiteur. */
  isContact: boolean;
  /** L'un des deux a bloqué l'autre. */
  blocked: boolean;
}

export function canSee(
  visibility: Visibility,
  relation: ViewerRelation,
): boolean {
  if (relation.blocked) {
    return false;
  }
  if (visibility === 'everyone') {
    return true;
  }
  if (visibility === 'contacts') {
    return relation.isContact;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Visibilité sociale (ADR-0001). Contrairement au chat, la relation pertinente
// n'est pas la conversation partagée mais l'abonnement. Toutes ces fonctions
// sont pures : elles décrivent la règle, la requête SQL doit la traduire.
// ---------------------------------------------------------------------------

export type SocialVisibility = 'public' | 'followers' | 'private';

export type SocialModerationStatus =
  'pending' | 'approved' | 'flagged' | 'removed';

/** Qui peut commenter, mentionner ou reposter (cf. `user_social_settings`). */
export type SocialInteractor =
  'everyone' | 'followers' | 'following' | 'nobody';

export interface SocialViewer {
  /** `null` pour un visiteur non authentifié (web en consultation). */
  viewerId: string | null;
  /** Abonnement **accepté** du visiteur vers l'auteur. */
  isFollower: boolean;
  /** L'auteur est abonné au visiteur (base de la permission `following`). */
  isFollowedBy: boolean;
  /** Blocage, dans un sens ou dans l'autre. */
  blocked: boolean;
  /** Modérateur ou admin : accès à la file de signalements. */
  isModerator?: boolean;
}

/** Publication telle que la politique en a besoin, sans le contenu. */
export interface SocialPublicationFacts {
  authorId: string;
  visibility: SocialVisibility;
  moderationStatus: SocialModerationStatus;
  /** Suppression logique : le contenu ne doit plus être servi. */
  deleted: boolean;
}

/**
 * Le visiteur peut-il voir la publication ?
 *
 * Ordre des règles, volontaire :
 * 1. suppression logique et retrait de modération — seuls l'auteur et la
 *    modération les constatent (besoin d'audit et d'appel) ;
 * 2. contenu `flagged` — masqué du public tant qu'un humain n'a pas tranché,
 *    mais toujours visible pour son auteur et la modération ;
 * 3. auteur et modération voient le reste sans condition ;
 * 4. blocage — coupe tout le reste, y compris un abonné ;
 * 5. visibilité `public` / `followers` / `private`.
 *
 * `pending` reste visible : c'est l'état d'un contrôle automatique en cours,
 * exécuté au moment de la création. Seul `flagged` attend une décision humaine.
 */
export function canViewPublication(
  publication: SocialPublicationFacts,
  viewer: SocialViewer,
): boolean {
  const isAuthor =
    viewer.viewerId !== null && viewer.viewerId === publication.authorId;
  if (publication.deleted) {
    return isAuthor || viewer.isModerator === true;
  }
  if (isAuthor || viewer.isModerator === true) {
    return true;
  }
  if (publication.moderationStatus === 'removed') {
    return false;
  }
  if (publication.moderationStatus === 'flagged') {
    return false;
  }
  if (viewer.blocked) {
    return false;
  }
  if (publication.visibility === 'public') {
    return true;
  }
  if (viewer.viewerId === null) {
    return false;
  }
  if (publication.visibility === 'followers') {
    return viewer.isFollower;
  }
  return false;
}

/** Faits nécessaires pour réévaluer l'originale copiée par une citation. */
export interface QuotedOriginalFacts extends SocialPublicationFacts {
  authorPrivateAccount: boolean;
  authorDeleted: boolean;
}

/**
 * Une citation réutilise les médias de son originale : elle ne peut continuer
 * à les exposer que si l'originale reste visible pour ce viewer. Contrairement à
 * `canViewPublication`, le statut `flagged`/`removed` et la suppression ne sont jamais
 * prolongés pour l'auteur ou la modération.
 */
export function canViewQuotedOriginal(
  publication: QuotedOriginalFacts,
  viewer: SocialViewer,
): boolean {
  if (
    publication.deleted ||
    publication.authorDeleted ||
    publication.moderationStatus === 'flagged' ||
    publication.moderationStatus === 'removed'
  ) {
    return false;
  }
  return (
    canViewPublication(publication, viewer) &&
    canViewProfile(
      {
        userId: publication.authorId,
        privateAccount: publication.authorPrivateAccount,
      },
      viewer,
    )
  );
}

/** Profil visible ? Un compte privé n'ouvre son contenu qu'à ses abonnés. */
export function canViewProfile(
  profile: { userId: string; privateAccount: boolean },
  viewer: SocialViewer,
): boolean {
  if (viewer.viewerId !== null && viewer.viewerId === profile.userId) {
    return true;
  }
  if (viewer.isModerator === true) {
    return true;
  }
  if (viewer.blocked) {
    return false;
  }
  if (!profile.privateAccount) {
    return true;
  }
  return viewer.viewerId !== null && viewer.isFollower;
}

/**
 * Les médias de cette publication peuvent-ils être servis par le CDN public ?
 *
 * Seul un contenu réellement public y a droit : une URL publique est immuable et
 * ne peut pas être révoquée, elle ne doit donc jamais désigner un contenu
 * `followers`, un compte privé, un contenu en revue ou supprimé. Tout le reste
 * passe par une URL signée courte.
 */
export function isPubliclyCacheable(publication: {
  /** Visibilité de la publication (`public`, `followers`, `private`). */
  visibility: SocialVisibility;
  /** Statut de modération courant. */
  moderationStatus: SocialModerationStatus;
  /** Suppression logique, par l'auteur ou la modération. */
  deleted: boolean;
  /** Le compte auteur est privé (`users.private_account`). */
  authorPrivateAccount: boolean;
}): boolean {
  if (publication.visibility !== 'public' || publication.deleted) {
    return false;
  }
  if (publication.authorPrivateAccount) {
    return false;
  }
  return (
    publication.moderationStatus === 'pending' ||
    publication.moderationStatus === 'approved'
  );
}

/** Le visiteur peut-il commenter / mentionner / reposter ce compte ? */
export function canInteract(
  permission: SocialInteractor,
  viewer: SocialViewer,
): boolean {
  if (viewer.viewerId === null || viewer.blocked) {
    return false;
  }
  if (permission === 'everyone') {
    return true;
  }
  if (permission === 'followers') {
    return viewer.isFollower;
  }
  if (permission === 'following') {
    return viewer.isFollowedBy;
  }
  return false;
}
