import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  blocks,
  feedSessions,
  follows,
  publicationReactions,
  publicationReposts,
  publicationSaves,
  publications,
  saveCollections,
  users,
  type TextPageStyle,
} from '../db/schema.js';
import { loadPublicationMedia, type MediaAccess } from '../publications/publication-media.js';
import { ObjectStorageService } from '../social-media/object-storage.service.js';
import { loadLikedByFollowed } from '../social/liked-by.js';
import { visiblePublicationConditions } from '../social/publication-visibility.js';
import { isPubliclyCacheable } from '../users/visibility.js';
import type { AuthorCard, PublicationView } from '../publications/publications.service.js';
import {
  buildSessionOrder,
  decodeFeedTimeCursor,
  decodeSessionCursor,
  encodeFeedTimeCursor,
  encodeSessionCursor,
  type RankedCandidate,
} from './feed-ranking.js';

export type FeedTab = 'for-you' | 'following' | 'local';

export const FEED_TABS: readonly FeedTab[] = ['for-you', 'following', 'local'];
/** Formats acceptés par le filtre `?format=` (mêmes valeurs que `publications.format`). */
export const FEED_FORMATS = ['text', 'image', 'carousel', 'video'] as const;
export type FeedFormat = (typeof FEED_FORMATS)[number];
export const FEED_DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Taille d'une session : de quoi couvrir plusieurs pages sans requête lourde. */
export const FEED_SESSION_SIZE = 200;
/** Réserve d'exploration (auteurs non suivis) d'une session. */
export const FEED_EXPLORATION_SIZE = 30;
/** Durée de vie d'une session : au-delà, le fil est reconstruit. */
export const FEED_SESSION_TTL_MS = 30 * 60 * 1000;
/** Fenêtre pendant laquelle une publication déjà vue ne revient pas. */
const SEEN_WINDOW_HOURS = 24;

/** Élément de feed : la vue de publication, plus l'état de la relation. */
export interface FeedItem extends PublicationView {
  viewer: PublicationView['viewer'] & {
    /** Le visiteur suit l'auteur (abonnement accepté). */
    followingAuthor: boolean;
  };
  /**
   * Compte suivi qui a republication cette publication dans le fil
   * « Abonnements » (façon Instagram). `null`/absent sinon.
   */
  repostedBy?: AuthorCard | null;
  /**
   * « Aimé par X et N autres » : le compte suivi par le visiteur qui a réagi
   * le plus récemment à la publication. `null` si aucun compte suivi n'a
   * réagi (le client affiche alors seulement le nombre de J'aime).
   */
  likedBy?: AuthorCard | null;
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}

export function encodeFeedCursor(hotScore: number, id: string): string {
  return Buffer.from(`${hotScore}|${id}`, 'utf8').toString('base64url');
}

export function decodeFeedCursor(cursor: string): { hotScore: number; id: string } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = raw.lastIndexOf('|');
  const hotScore = Number(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (separator <= 0 || !id || !Number.isSafeInteger(hotScore)) {
    throw new BadRequestException('Curseur invalide.');
  }
  return { hotScore, id };
}

/** Publication citée et son auteur, jointes pour l'attribution « a republié ». */
const quotedPublications = alias(publications, 'quoted_publications');
const quotedAuthors = alias(users, 'quoted_authors');
/** Republication portée par le profil listé (`/feed/reposts/:userId`). */
const profileReposts = alias(publicationReposts, 'profile_reposts');

type PublicationRow = {
  id: string;
  kind: 'post' | 'reel';
  format: 'text' | 'image' | 'carousel' | 'video';
  caption: string | null;
  textBackground: string | null;
  textPages: string[] | null;
  textPageStyles: Array<TextPageStyle | null> | null;
  textFont: string | null;
  textAlign: string | null;
  textColor: string | null;
  textTitle: string | null;
  textSize: number | null;
  location: string | null;
  linkPreview: {
    url: string;
    host: string;
    title: string;
    description: string;
    imageUrl: string | null;
  } | null;
  mediaFilter: string | null;
  visibility: 'public' | 'followers' | 'private';
  createdAt: Date;
  editedAt?: Date | null;
  author: AuthorCard;
  authorPrivateAccount: boolean;
  likeCount: number;
  commentCount: number;
  repostCount: number;
  saveCount: number;
  shareCount: number;
  viewCount: number;
  reaction: 'like' | 'love' | 'fire' | 'clap' | null;
  followingAuthor: unknown;
  saved: string | null;
  reposted: string | null;
  repostedAt?: Date | null;
  quotedId: string | null;
  quotedCaption: string | null;
  quotedAuthorUsername: string | null;
  quotedAuthorDisplayName: string | null;
};

/**
 * Fil social (plan §8).
 *
 * Trois comportements distincts :
 * - **Abonnements** : chronologique, paginé par curseur `(created_at, id)`. Un
 *   classement n'a pas de sens sur un graphe explicite, et l'insertion de
 *   nouvelles publications ne décale pas les pages suivantes.
 * - **Pour toi / Local** : classés, puis **figés dans une session**. Le score,
 *   l'affinité et le « déjà vu » bougent à chaque interaction ; paginer dessus
 *   ferait sauter ou répéter des lignes. La session fige l'ordre, le curseur ne
 *   porte qu'un décalage.
 *
 * Autorisation, blocages, modération, comptes privés, contenus écartés
 * (« Pas intéressé », auteur masqué) et suppressions sont appliqués en SQL.
 */
@Injectable()
export class FeedService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: ObjectStorageService,
  ) {}

  async list(
    viewerId: string,
    tab: FeedTab,
    limit: number,
    cursor?: string,
    format?: FeedFormat,
  ): Promise<FeedPage> {
    const bounded = Math.min(Math.max(1, limit), MAX_LIMIT);

    const [viewer] = await this.db
      .select({ city: users.city })
      .from(users)
      .where(eq(users.id, viewerId));
    if (!viewer) {
      throw new NotFoundException('Compte introuvable.');
    }
    // Onglet Local sans ville connue : aucune publication à proposer.
    if (tab === 'local' && !viewer.city) {
      return { items: [], nextCursor: null };
    }

    if (tab === 'following') {
      return this.listChronological(viewerId, bounded, cursor, format);
    }
    return this.listRanked(viewerId, tab, bounded, cursor, format, viewer.city);
  }

  /**
   * Abonnements : ordre chronologique strict, curseur stable.
   *
   * Comme Instagram, le fil mélange deux sources : les publications des
   * auteurs suivis et les republications faites par des comptes suivis
   * (d'auteurs que le visiteur ne suit pas déjà — sinon la publication
   * arrive par son auteur). La clé de tri est `max(created_at, repost_at)` :
   * une republication récente fait remonter une publication plus ancienne.
   */
  private async listChronological(
    viewerId: string,
    limit: number,
    cursor?: string,
    format?: FeedFormat,
  ): Promise<FeedPage> {
    const visibility = sql.join(
      [
        ...visiblePublicationConditions(viewerId),
        this.feedbackCondition(viewerId),
        ...(format ? [sql`${publications.format} = ${format}`] : []),
      ],
      sql` and `,
    );
    const decoded = cursor ? decodeFeedTimeCursor(cursor) : null;
    const cursorClause = decoded
      ? sql`where (sort_at, publication_id) < (${decoded.createdAt.toISOString()}::timestamptz, ${decoded.id})`
      : sql``;

    const { rows } = await this.db.execute<{
      publication_id: string;
      sort_at: Date | string;
      reposter_id: string | null;
    }>(sql`
      select publication_id, sort_at, reposter_id
      from (
        select distinct on (publication_id) publication_id, sort_at, reposter_id
        from (
          select publications.id as publication_id,
                 publications.created_at as sort_at,
                 null::text as reposter_id
          from publications
          inner join users on users.id = publications.author_id
          where ${visibility}
            and ${this.followsAuthor(viewerId)}
          union all
          select publications.id,
                 pr.created_at,
                 pr.user_id
          from publication_reposts pr
          inner join publications on publications.id = pr.publication_id
          inner join users on users.id = publications.author_id
          inner join users reposters on reposters.id = pr.user_id
          where ${visibility}
            and pr.user_id <> ${viewerId}
            and pr.user_id <> publications.author_id
            and reposters.deleted_at is null
            and not exists (
              select 1 from blocks rb
              where (rb.blocker_id = ${viewerId} and rb.blocked_id = reposters.id)
                 or (rb.blocker_id = reposters.id and rb.blocked_id = ${viewerId})
            )
            and exists (
              select 1 from follows rf
              where rf.follower_id = ${viewerId}
                and rf.following_id = reposters.id
                and rf.status = 'accepted'
            )
            and not exists (
              select 1 from follows fa
              where fa.follower_id = ${viewerId}
                and fa.following_id = publications.author_id
                and fa.status = 'accepted'
            )
        ) candidates
        order by publication_id, sort_at desc
      ) ranked
      ${cursorClause}
      order by sort_at desc, publication_id desc
      limit ${limit + 1}
    `);

    const pageRows = rows.slice(0, limit);
    const reposterByPublication = new Map(
      pageRows.filter((row) => row.reposter_id).map((row) => [row.publication_id, row.reposter_id!]),
    );
    const items = await this.hydrate(
      pageRows.map((row) => row.publication_id),
      viewerId,
    );
    const reposters = await this.authorCards([...reposterByPublication.values()]);
    for (const item of items) {
      const reposterId = reposterByPublication.get(item.id);
      item.repostedBy = reposterId ? (reposters.get(reposterId) ?? null) : null;
    }

    const last = pageRows.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeFeedTimeCursor(new Date(last.sort_at), last.publication_id)
          : null,
    };
  }

  /**
   * Republications faites par un compte (`/feed/reposts/:userId`), pour la
   * grille de profil. La visibilité du profil est vérifiée avant la liste :
   * compte privé → abonnés acceptés, blocage → refus.
   */
  /**
   * Enregistrements du visiteur, du plus récent au plus ancien, comme l'écran
   * « Enregistrés » d'Instagram. `collectionId` filtre une collection ;
   * absent = tous les enregistrements. Privé : seul le propriétaire y accède.
   */
  async listSaved(
    viewerId: string,
    limit: number,
    cursor?: string,
    collectionId?: string,
  ): Promise<FeedPage> {
    const bounded = Math.min(Math.max(1, limit), MAX_LIMIT);
    if (collectionId) {
      const [owned] = await this.db
        .select({ id: saveCollections.id })
        .from(saveCollections)
        .where(and(eq(saveCollections.id, collectionId), eq(saveCollections.userId, viewerId)));
      if (!owned) {
        throw new NotFoundException('Collection introuvable.');
      }
    }
    const conditions = [
      eq(publicationSaves.userId, viewerId),
      ...visiblePublicationConditions(viewerId),
      ...(collectionId ? [eq(publicationSaves.collectionId, collectionId)] : []),
    ];
    if (cursor) {
      const decoded = decodeFeedTimeCursor(cursor);
      conditions.push(
        sql`(${publicationSaves.createdAt}, ${publications.id}) < (${decoded.createdAt.toISOString()}::timestamptz, ${decoded.id})`,
      );
    }
    const rows = await this.db
      .select({ ...this.feedColumns(viewerId), savedAt: publicationSaves.createdAt })
      .from(publicationSaves)
      .innerJoin(publications, eq(publications.id, publicationSaves.publicationId))
      .innerJoin(users, eq(users.id, publications.authorId))
      .leftJoin(
        publicationReactions,
        and(
          eq(publicationReactions.publicationId, publications.id),
          eq(publicationReactions.userId, viewerId),
        ),
      )
      .leftJoin(
        publicationReposts,
        and(
          eq(publicationReposts.publicationId, publications.id),
          eq(publicationReposts.userId, viewerId),
        ),
      )
      .leftJoin(
        quotedPublications,
        and(
          eq(quotedPublications.id, publications.quotedPublicationId),
          isNull(quotedPublications.deletedAt),
        ),
      )
      .leftJoin(quotedAuthors, eq(quotedAuthors.id, quotedPublications.authorId))
      .where(and(...conditions))
      .orderBy(desc(publicationSaves.createdAt), desc(publications.id))
      .limit(bounded + 1);

    const page = rows.slice(0, bounded);
    const last = page.at(-1);
    const items = await this.toItems(page, viewerId);
    return {
      items,
      nextCursor:
        rows.length > bounded && last?.savedAt
          ? encodeFeedTimeCursor(last.savedAt, last.id)
          : null,
    };
  }

  async listReposts(
    userId: string,
    viewerId: string,
    limit: number,
    cursor?: string,
  ): Promise<FeedPage> {
    const bounded = Math.min(Math.max(1, limit), MAX_LIMIT);
    const [target] = await this.db
      .select({ privateAccount: users.privateAccount, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, userId));
    if (!target || target.deletedAt) {
      throw new NotFoundException('Profil introuvable.');
    }
    if (userId !== viewerId) {
      const [blockedRow] = await this.db
        .select({ blockerId: blocks.blockerId })
        .from(blocks)
        .where(
          or(
            and(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, userId)),
            and(eq(blocks.blockerId, userId), eq(blocks.blockedId, viewerId)),
          ),
        )
        .limit(1);
      let allowed = !blockedRow;
      if (allowed && target.privateAccount) {
        const [follow] = await this.db
          .select({ followerId: follows.followerId })
          .from(follows)
          .where(
            and(
              eq(follows.followerId, viewerId),
              eq(follows.followingId, userId),
              eq(follows.status, 'accepted'),
            ),
          )
          .limit(1);
        allowed = Boolean(follow);
      }
      if (!allowed) {
        throw new ForbiddenException('Ce profil est privé.');
      }
    }

    const conditions = [
      eq(profileReposts.userId, userId),
      ...this.baseConditions(viewerId),
    ];
    if (cursor) {
      const decoded = decodeFeedTimeCursor(cursor);
      conditions.push(
        sql`(${profileReposts.createdAt}, ${publications.id}) < (${decoded.createdAt.toISOString()}::timestamptz, ${decoded.id})`,
      );
    }

    const rows = await this.db
      .select({
        ...this.feedColumns(viewerId),
        repostedAt: profileReposts.createdAt,
      })
      .from(profileReposts)
      .innerJoin(publications, eq(publications.id, profileReposts.publicationId))
      .innerJoin(users, eq(users.id, publications.authorId))
      .leftJoin(
        publicationReactions,
        and(
          eq(publicationReactions.publicationId, publications.id),
          eq(publicationReactions.userId, viewerId),
        ),
      )
      .leftJoin(
        publicationSaves,
        and(
          eq(publicationSaves.publicationId, publications.id),
          eq(publicationSaves.userId, viewerId),
        ),
      )
      .leftJoin(
        publicationReposts,
        and(
          eq(publicationReposts.publicationId, publications.id),
          eq(publicationReposts.userId, viewerId),
        ),
      )
      .leftJoin(
        quotedPublications,
        and(
          eq(quotedPublications.id, publications.quotedPublicationId),
          isNull(quotedPublications.deletedAt),
        ),
      )
      .leftJoin(quotedAuthors, eq(quotedAuthors.id, quotedPublications.authorId))
      .where(and(...conditions))
      .orderBy(desc(profileReposts.createdAt), desc(publications.id))
      .limit(bounded + 1);

    const page = rows.slice(0, bounded);
    const last = page.at(-1);
    const items = await this.toItems(page, viewerId);
    // Comme dans le fil, chaque republication porte l'auteur du repost.
    const reposters = await this.authorCards([userId]);
    const reposter = reposters.get(userId) ?? null;
    for (const item of items) {
      item.repostedBy = reposter;
    }
    return {
      items,
      nextCursor:
        rows.length > bounded && last?.repostedAt
          ? encodeFeedTimeCursor(last.repostedAt, last.id)
          : null,
    };
  }

  /** Cartes auteurs pour l'attribution « a republié ». */
  private async authorCards(ids: string[]): Promise<Map<string, AuthorCard>> {
    const result = new Map<string, AuthorCard>();
    if (ids.length === 0) {
      return result;
    }
    const rows = await this.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        verified: users.verified,
      })
      .from(users)
      .where(inArray(users.id, ids));
    for (const row of rows) {
      result.set(row.id, { ...row });
    }
    return result;
  }

  /**
   * Pour toi / Local : classement puis session figée.
   *
   * Sans curseur, une session est construite (classement + exploration +
   * diversité) puis la première page est servie. Avec curseur, on relit l'ordre
   * figé : aucune ligne ne peut être sautée ni répétée par une interaction
   * survenue entre deux pages.
   */
  private async listRanked(
    viewerId: string,
    tab: Exclude<FeedTab, 'following'>,
    limit: number,
    cursor?: string,
    format?: FeedFormat,
    city?: string | null,
  ): Promise<FeedPage> {
    if (cursor) {
      const { sessionId, offset } = decodeSessionCursor(cursor);
      const [session] = await this.db
        .select()
        .from(feedSessions)
        .where(and(eq(feedSessions.id, sessionId), eq(feedSessions.userId, viewerId)));
      if (!session || session.expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException('Session de fil expirée. Recharge le fil.');
      }
      // Une publication écartée (« Pas intéressé », supprimée, retirée par la
      // modération) entre deux pages est filtrée à l'hydratation : on complète
      // avec les identifiants suivants de la session pour rendre une page
      // pleine, plutôt que de laisser un trou.
      let cursorOffset = offset;
      let items: FeedItem[] = [];
      while (items.length < limit && cursorOffset < session.publicationIds.length) {
        const chunk = session.publicationIds.slice(cursorOffset, cursorOffset + limit);
        cursorOffset += chunk.length;
        items = [...items, ...(await this.hydrate(chunk, viewerId))];
      }
      return {
        items: items.slice(0, limit),
        nextCursor:
          cursorOffset < session.publicationIds.length
            ? encodeSessionCursor(session.id, cursorOffset)
            : null,
      };
    }

    const conditions = this.baseConditions(viewerId);
    if (tab === 'local') {
      conditions.push(eq(users.city, city!));
    } else {
      // « Pour toi » ne resert pas ce qui vient d'être vu : le fil doit avancer.
      conditions.push(
        sql`not exists (
          select 1 from publication_views v
          where v.publication_id = ${publications.id}
            and v.user_id = ${viewerId}
            and v.viewed_at > now() - (${SEEN_WINDOW_HOURS} * interval '1 hour')
        )`,
      );
    }
    if (format) {
      conditions.push(eq(publications.format, format));
    }

    // Graine stable par construction : deux sessions ne mélangent pas les mêmes
    // contenus, mais une session donnée reste reproductible.
    const seed = crypto.randomUUID();

    const rankedRows = await this.db
      .select({ id: publications.id, authorId: publications.authorId })
      .from(publications)
      .innerJoin(users, eq(users.id, publications.authorId))
      .where(and(...conditions))
      .orderBy(
        sql`${this.rankExpression(viewerId)} desc`,
        desc(publications.id),
      )
      .limit(FEED_SESSION_SIZE);

    const explorationRows = await this.db
      .select({ id: publications.id, authorId: publications.authorId })
      .from(publications)
      .innerJoin(users, eq(users.id, publications.authorId))
      .where(
        and(
          ...conditions,
          sql`not (${this.followsAuthor(viewerId)})`,
        ),
      )
      // Exploration déterministe : l'ordre dépend de la session, pas du hasard
      // de `random()`, sinon deux lectures de la même page divergeraient.
      .orderBy(sql`md5(${publications.id} || ${seed})`)
      .limit(FEED_EXPLORATION_SIZE);

    const order = buildSessionOrder(
      rankedRows as RankedCandidate[],
      explorationRows as RankedCandidate[],
    );
    if (order.length === 0) {
      return { items: [], nextCursor: null };
    }

    const [session] = await this.db
      .insert(feedSessions)
      .values({
        userId: viewerId,
        tab,
        publicationIds: order,
        expiresAt: new Date(Date.now() + FEED_SESSION_TTL_MS),
      })
      .returning({ id: feedSessions.id });

    const pageIds = order.slice(0, limit);
    return {
      items: await this.hydrate(pageIds, viewerId),
      nextCursor:
        order.length > limit && session
          ? encodeSessionCursor(session.id, limit)
          : null,
    };
  }

  /** Charge les publications d'une page dans l'ordre demandé. */
  private async hydrate(ids: string[], viewerId: string): Promise<FeedItem[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.db
      .select(this.feedColumns(viewerId))
      .from(publications)
      .innerJoin(users, eq(users.id, publications.authorId))
      .leftJoin(
        publicationReactions,
        and(
          eq(publicationReactions.publicationId, publications.id),
          eq(publicationReactions.userId, viewerId),
        ),
      )
      .leftJoin(
        publicationSaves,
        and(
          eq(publicationSaves.publicationId, publications.id),
          eq(publicationSaves.userId, viewerId),
        ),
      )
      .leftJoin(
        publicationReposts,
        and(
          eq(publicationReposts.publicationId, publications.id),
          eq(publicationReposts.userId, viewerId),
        ),
      )
      .leftJoin(
        quotedPublications,
        and(
          eq(quotedPublications.id, publications.quotedPublicationId),
          isNull(quotedPublications.deletedAt),
        ),
      )
      .leftJoin(quotedAuthors, eq(quotedAuthors.id, quotedPublications.authorId))
      .where(
        and(
          inArray(publications.id, ids),
          // Une publication retirée ou supprimée entre deux pages disparaît,
          // même si son identifiant était figé dans la session.
          ...this.baseConditions(viewerId),
        ),
      );

    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((row): row is PublicationRow => row !== undefined);
    return this.toItems(ordered, viewerId);
  }

  /** Colonnes communes aux deux chemins. */
  private feedColumns(viewerId: string) {
    return {
      id: publications.id,
      kind: publications.kind,
      format: publications.format,
      caption: publications.caption,
      textBackground: publications.textBackground,
      textPages: publications.textPages,
      textPageStyles: publications.textPageStyles,
      textFont: publications.textFont,
      textAlign: publications.textAlign,
      textColor: publications.textColor,
      textTitle: publications.textTitle,
      textSize: publications.textSize,
      location: publications.location,
      linkPreview: publications.linkPreview,
      mediaFilter: publications.mediaFilter,
      visibility: publications.visibility,
      createdAt: publications.createdAt,
      editedAt: publications.editedAt,
      author: {
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        verified: users.verified,
      },
      authorPrivateAccount: users.privateAccount,
      likeCount: publications.likeCount,
      commentCount: publications.commentCount,
      repostCount: publications.repostCount,
      saveCount: publications.saveCount,
      shareCount: publications.shareCount,
      viewCount: publications.viewCount,
      reaction: publicationReactions.kind,
      followingAuthor: this.followsAuthor(viewerId),
      saved: publicationSaves.userId,
      reposted: publicationReposts.userId,
      quotedId: publications.quotedPublicationId,
      quotedCaption: quotedPublications.caption,
      quotedAuthorUsername: quotedAuthors.username,
      quotedAuthorDisplayName: quotedAuthors.displayName,
    };
  }

  /** Conditions d'autorisation communes à tous les onglets. */
  private baseConditions(viewerId: string) {
    return [...visiblePublicationConditions(viewerId), this.feedbackCondition(viewerId)];
  }

  /**
   * Contenus écartés par le visiteur : « Pas intéressé » sur une publication
   * ou masquage d'un auteur. Partagé entre le query builder et la requête
   * brute de l'onglet Abonnements.
   */
  private feedbackCondition(viewerId: string) {
    return sql`not exists (
      select 1 from content_feedback cf
      where cf.user_id = ${viewerId}
        and (
          (cf.target_type = 'publication' and cf.target_id = ${publications.id})
          or (cf.target_type = 'author' and cf.target_id = ${publications.authorId})
        )
    )`;
  }

  private followsAuthor(viewerId: string) {
    return sql`exists (
      select 1 from follows f
      where f.follower_id = ${viewerId}
        and f.following_id = ${publications.authorId}
        and f.status = 'accepted'
    )`;
  }

  /**
   * Score de classement effectif : portée matérialisée × affinité.
   *
   * L'affinité est une somme bornée de signaux explicites (abonnement, réaction
   * récente à cet auteur, commentaire récent). Elle ne peut pas noyer la
   * fraîcheur : son coefficient maximal est de 1,6, appliqué au score déjà
   * amorti par l'âge.
   */
  private rankExpression(viewerId: string) {
    const affinity = sql`(
      1
      + case when ${this.followsAuthor(viewerId)} then 0.6 else 0 end
      + case when exists (
          select 1
          from publication_reactions r
          inner join publications pr on pr.id = r.publication_id
          where r.user_id = ${viewerId}
            and pr.author_id = ${publications.authorId}
            and pr.created_at > now() - interval '30 days'
        ) then 0.25 else 0 end
      + case when exists (
          select 1
          from comments c
          inner join publications pc on pc.id = c.publication_id
          where c.author_id = ${viewerId}
            and pc.author_id = ${publications.authorId}
            and c.created_at > now() - interval '30 days'
        ) then 0.15 else 0 end
    )`;
    return sql`${publications.hotScore} * ${affinity}`;
  }

  /** Hydrate les URLs de médias et rend les éléments de fil. */
  private async toItems(rows: PublicationRow[], viewerId: string): Promise<FeedItem[]> {
    if (rows.length === 0) {
      return [];
    }
    // Niveau de diffusion des médias, décidé ici : le CDN public n'est utilisé
    // que pour un contenu réellement public, tout le reste est signé.
    const access = new Map<string, MediaAccess>(
      rows.map((row) => [
        row.id,
        isPubliclyCacheable({
          visibility: row.visibility,
          // Le fil exclut déjà `flagged` et `removed` : ce qui passe est
          // `pending` ou `approved`.
          moderationStatus: 'pending',
          deleted: false,
          authorPrivateAccount: row.authorPrivateAccount,
        })
          ? 'public'
          : 'signed',
      ]),
    );
    const [media, likers] = await Promise.all([
      loadPublicationMedia(
        this.db,
        rows.map((row) => row.id),
        this.storage.isConfigured() ? this.storage : null,
        (publicationId) => access.get(publicationId) ?? 'signed',
      ),
      loadLikedByFollowed(
        this.db,
        rows.filter((row) => row.likeCount > 0).map((row) => row.id),
        viewerId,
      ),
    ]);

    return rows.map((row) => ({
      id: row.id,
      media: media.get(row.id) ?? [],
      kind: row.kind,
      format: row.format,
      caption: row.caption,
      textBackground: row.textBackground,
      pages: row.textPages,
      pageStyles: row.textPageStyles,
      textFont: row.textFont,
      textAlign: row.textAlign,
      textColor: row.textColor,
      textTitle: row.textTitle,
      textSize: row.textSize,
      location: row.location,
      linkPreview: row.linkPreview,
      mediaFilter: row.mediaFilter,
      visibility: row.visibility,
      createdAt: row.createdAt,
      editedAt: row.editedAt ?? null,
      author: { ...row.author } as AuthorCard,
      counters: {
        likes: row.likeCount,
        comments: row.commentCount,
        reposts: row.repostCount,
        saves: row.saveCount,
        shares: row.shareCount,
        views: row.viewCount,
      },
      viewer: {
        reaction: row.reaction ?? null,
        saved: Boolean(row.saved),
        reposted: Boolean(row.reposted),
        followingAuthor: Boolean(row.followingAuthor),
      },
      quoted:
        row.quotedId && row.quotedAuthorDisplayName !== null
          ? {
              id: row.quotedId,
              authorUsername: row.quotedAuthorUsername ?? '',
              authorDisplayName: row.quotedAuthorDisplayName,
              caption: row.quotedCaption,
            }
          : null,
      likedBy: likers.get(row.id) ?? null,
    }));
  }
}
