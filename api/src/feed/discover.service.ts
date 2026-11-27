import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { DRIZZLE, type Database } from '../db/db.module.js';
import { feedSessions, hashtags, publications, users } from '../db/schema.js';
import {
  loadPublicationMedia,
  type MediaAccess,
  type PublicationMediaView,
} from '../publications/publication-media.js';
import { ObjectStorageService } from '../social-media/object-storage.service.js';
import { visiblePublicationConditions } from '../social/publication-visibility.js';
import { isPubliclyCacheable } from '../users/visibility.js';
import {
  decodeFeedTimeCursor,
  decodeSessionCursor,
  encodeFeedTimeCursor,
  encodeSessionCursor,
} from './feed-ranking.js';
import {
  FEED_SESSION_SIZE,
  FEED_SESSION_TTL_MS,
  FeedService,
} from './feed.service.js';

export const DISCOVER_PUBLICATION_LIMIT = 12;
export const DISCOVER_HASHTAG_LIMIT = 10;
export const DISCOVER_SUGGESTION_LIMIT = 8;
export const DISCOVER_SECTION_DEFAULT_LIMIT = 20;
export const DISCOVER_SECTION_MAX_LIMIT = 50;

/**
 * Sections paginables de l'écran Découvrir (`GET /discover/sections/:section`).
 *
 * `popular` et `successful` sont classées sur des valeurs mutables
 * (`hot_score`, compteurs) : leur ordre est figé dans une session, comme le
 * fil « Pour toi ». `nearby-friends` est chronologique : le curseur
 * `(created_at, id)` suffit, sans session.
 */
export const DISCOVER_PAGED_SECTIONS = [
  'popular',
  'successful',
  'breakout',
  'nearby-friends',
] as const;
export type DiscoverPagedSection = (typeof DISCOVER_PAGED_SECTIONS)[number];

/** Sections classées par session (ordre figé entre deux pages). */
export type DiscoverRankedSection = 'popular' | 'successful' | 'breakout';

/** Valeur `feed_sessions.tab` des sections classées de Découvrir. */
const DISCOVER_SESSION_TABS: Record<DiscoverRankedSection, string> = {
  popular: 'discover:popular',
  successful: 'discover:successful',
  breakout: 'discover:breakout',
};

/** Fenêtre de la section « Ça commence à percer » : publications très récentes. */
export const DISCOVER_BREAKOUT_WINDOW_HOURS = 72;
/**
 * Plancher d'engagement pondéré : en dessous, une publication neuve avec une
 * poignée d'interactions ne peut pas « percer » — le bruit est écarté avant
 * le classement.
 */
export const DISCOVER_BREAKOUT_MIN_ENGAGEMENT = 10;
/**
 * Base additive du compteur d'abonnés dans le score breakout : un petit
 * compte (0 abonné) est divisée par 50, un compte à 10 000 abonnés par
 * 10 050 — la vélocité prime, la taille de l'audience amortit.
 */
export const DISCOVER_BREAKOUT_FOLLOWER_BASE = 50;

export interface DiscoverSectionPage {
  items: DiscoverPublication[];
  nextCursor: string | null;
}

const quotedPublications = alias(publications, 'quoted_publications');
const quotedAuthors = alias(users, 'quoted_authors');
export const DISCOVER_SUCCESS_WINDOW_DAYS = 7;

/**
 * Engagement « succès » d'une publication : somme des interactions, calculée
 * en `bigint` — trois compteurs `integer` peuvent dépasser la capacité d'`int4`.
 */
const engagementSql = () =>
  sql`(${publications.likeCount}::bigint + ${publications.commentCount}::bigint + ${publications.repostCount}::bigint)`;

/**
 * Engagement pondéré de la section breakout, mêmes poids que `hot_score`
 * (hors vues) : J'aime ×3, commentaires ×4, republications ×5, enregistrements ×2.
 */
const breakoutEngagementSql = () =>
  sql`(${publications.likeCount}::bigint * 3 + ${publications.commentCount}::bigint * 4 + ${publications.repostCount}::bigint * 5 + ${publications.saveCount}::bigint * 2)`;

/**
 * Score « percer » : vélocité d'engagement amortie par l'âge, divisée par la
 * taille de l'audience — un contenu récent très interactif d'un petit compte
 * devance un contenu deux fois moins réactif d'un gros compte.
 */
const breakoutScoreSql = () =>
  sql`(${breakoutEngagementSql()})::numeric / power(extract(epoch from (now() - ${publications.createdAt})) / 3600 + 2, 1.5) / (${users.followerCount} + ${DISCOVER_BREAKOUT_FOLLOWER_BASE})`;

/** Ligne brute de la requête de liste, avant hydratation des médias. */
interface PublicationListRow {
  id: string;
  kind: 'post' | 'reel';
  format: 'text' | 'image' | 'carousel' | 'video';
  caption: string | null;
  createdAt: Date;
  visibility: 'public' | 'followers' | 'private';
  moderationStatus: 'pending' | 'approved' | 'flagged' | 'removed';
  authorId: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    verified: boolean;
  };
  authorPrivateAccount: boolean;
  quotedId: string | null;
  quotedVisibleId: string | null;
  likeCount: number;
  hideLikeCount: boolean;
  commentCount: number;
  repostCount: number;
  viewCount: number;
}

export interface DiscoverAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
}

/** Carte légère destinée aux rails de découverte ; le détail reste /post/:id. */
export interface DiscoverPublication {
  id: string;
  kind: 'post' | 'reel';
  format: 'text' | 'image' | 'carousel' | 'video';
  caption: string | null;
  createdAt: Date;
  author: DiscoverAuthor;
  media: PublicationMediaView[];
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
    breakout: DiscoverPublication[];
    trendingHashtags: Array<{
      id: string;
      tag: string;
      usageCount: number;
      trendScore: number;
    }>;
    suggestedAccounts: Awaited<ReturnType<FeedService['suggestedAccounts']>>;
  };
}

/**
 * Données de l'écran Découvrir. Les listes sont bornées et les contrôles de
 * visibilité partagés avec le fil restent appliqués en SQL.
 */
@Injectable()
export class DiscoverService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: ObjectStorageService,
    private readonly feed: FeedService,
  ) {}

  async list(viewerId: string): Promise<DiscoverResponse> {
    const [viewer] = await this.db
      .select({ id: users.id, city: users.city })
      .from(users)
      .where(eq(users.id, viewerId));
    if (!viewer) {
      throw new NotFoundException('Compte introuvable.');
    }

    const nearbyFriends = viewer.city
      ? this.listPublications(
          viewerId,
          this.nearbyConditions(viewerId, viewer.city),
          [desc(publications.createdAt), desc(publications.id)],
        )
      : Promise.resolve([] as DiscoverPublication[]);

    const popular = this.listPublications(
      viewerId,
      this.sectionConditions('popular'),
      this.sectionOrdering('popular'),
    );

    const successful = this.listPublications(
      viewerId,
      this.sectionConditions('successful'),
      this.sectionOrdering('successful'),
    );

    const breakout = this.listPublications(
      viewerId,
      this.sectionConditions('breakout'),
      this.sectionOrdering('breakout'),
    );

    const trendingHashtags = this.db
      .select({
        id: hashtags.id,
        tag: hashtags.tag,
        usageCount: hashtags.usageCount,
        trendScore: hashtags.trendScore,
      })
      .from(hashtags)
      .orderBy(
        desc(hashtags.trendScore),
        desc(hashtags.usageCount),
        asc(hashtags.tag),
      )
      .limit(DISCOVER_HASHTAG_LIMIT);

    const suggestedAccounts = this.feed.suggestedAccounts(
      viewerId,
      DISCOVER_SUGGESTION_LIMIT,
    );

    const [
      nearby,
      popularItems,
      successfulItems,
      breakoutItems,
      hashtagItems,
      accounts,
    ] = await Promise.all([
      nearbyFriends,
      popular,
      successful,
      breakout,
      trendingHashtags,
      suggestedAccounts,
    ]);

    return {
      cityKnown: Boolean(viewer.city),
      sections: {
        nearbyFriends: nearby,
        popular: popularItems,
        successful: successfulItems,
        breakout: breakoutItems,
        trendingHashtags: hashtagItems,
        suggestedAccounts: accounts,
      },
    };
  }

  /**
   * Page d'une section paginable de Découvrir.
   *
   * `popular` et `successful` figent leur ordre dans `feed_sessions` : les
   * valeurs classées (hot_score, compteurs) bougent à chaque interaction, un
   * curseur de score sauterait ou répéterait des lignes entre deux pages.
   * `nearby-friends` est chronologique : le curseur `(created_at, id)` suffit.
   */
  async section(
    viewerId: string,
    section: DiscoverPagedSection,
    limit: number,
    cursor?: string,
  ): Promise<DiscoverSectionPage> {
    const bounded = Math.min(Math.max(1, limit), DISCOVER_SECTION_MAX_LIMIT);
    if (section === 'nearby-friends') {
      return this.nearbyFriendsPage(viewerId, bounded, cursor);
    }
    return this.rankedSectionPage(
      viewerId,
      section as DiscoverRankedSection,
      bounded,
      cursor,
    );
  }

  /** Conditions « même ville, abonnement mutuel » de la section Autour de toi. */
  private nearbyConditions(viewerId: string, city: string): SQL[] {
    return [
      eq(users.city, city),
      ne(users.id, viewerId),
      sql`exists (
        select 1 from follows outbound
        where outbound.follower_id = ${viewerId}
          and outbound.following_id = ${users.id}
          and outbound.status = 'accepted'
      )`,
      sql`exists (
        select 1 from follows inbound
        where inbound.follower_id = ${users.id}
          and inbound.following_id = ${viewerId}
          and inbound.status = 'accepted'
      )`,
    ];
  }

  /** Conditions propres à une section classée, en plus du socle commun. */
  private sectionConditions(section: DiscoverRankedSection): SQL[] {
    if (section === 'successful') {
      return [
        sql`${publications.createdAt} >= now() - (${DISCOVER_SUCCESS_WINDOW_DAYS} * interval '1 day')`,
      ];
    }
    if (section === 'breakout') {
      return [
        sql`${publications.createdAt} >= now() - (${DISCOVER_BREAKOUT_WINDOW_HOURS} * interval '1 hour')`,
        sql`${breakoutEngagementSql()} >= ${DISCOVER_BREAKOUT_MIN_ENGAGEMENT}`,
      ];
    }
    return [];
  }

  /** Classement d'une section, identique aux rails de `GET /discover`. */
  private sectionOrdering(section: DiscoverRankedSection): SQL[] {
    if (section === 'successful') {
      return [
        desc(engagementSql()),
        desc(publications.createdAt),
        desc(publications.id),
      ];
    }
    if (section === 'breakout') {
      return [
        desc(breakoutScoreSql()),
        desc(publications.createdAt),
        desc(publications.id),
      ];
    }
    return [
      desc(publications.hotScore),
      desc(publications.createdAt),
      desc(publications.id),
    ];
  }

  /**
   * « Autour de toi » paginé : ordre chronologique strict, clé de tri
   * `(created_at, id)` immuable — le curseur `(created_at, id)` est stable.
   */
  private async nearbyFriendsPage(
    viewerId: string,
    limit: number,
    cursor?: string,
  ): Promise<DiscoverSectionPage> {
    const [viewer] = await this.db
      .select({ city: users.city })
      .from(users)
      .where(eq(users.id, viewerId));
    if (!viewer) {
      throw new NotFoundException('Compte introuvable.');
    }
    if (!viewer.city) {
      return { items: [], nextCursor: null };
    }

    const conditions = this.nearbyConditions(viewerId, viewer.city);
    if (cursor) {
      const decoded = decodeFeedTimeCursor(cursor);
      conditions.push(
        sql`(${publications.createdAt}, ${publications.id}) < (${decoded.createdAt.toISOString()}::timestamptz, ${decoded.id})`,
      );
    }
    const rows = await this.publicationRows(viewerId, {
      conditions,
      ordering: [desc(publications.createdAt), desc(publications.id)],
      limit: limit + 1,
    });
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: await this.toDiscoverItems(viewerId, pageRows),
      nextCursor:
        rows.length > limit && last
          ? encodeFeedTimeCursor(last.createdAt, last.id)
          : null,
    };
  }

  /**
   * Section classée (`popular`, `successful`). Sans curseur, l'ordre des
   * meilleurs candidats est figé dans `feed_sessions` ; avec curseur, on
   * relit cet ordre : aucune ligne ne peut être sautée ni répétée par une
   * interaction survenue entre deux pages.
   */
  private async rankedSectionPage(
    viewerId: string,
    section: DiscoverRankedSection,
    limit: number,
    cursor?: string,
  ): Promise<DiscoverSectionPage> {
    const tab = DISCOVER_SESSION_TABS[section];
    const conditions = this.sectionConditions(section);
    const ordering = this.sectionOrdering(section);

    if (cursor) {
      const { sessionId, offset } = decodeSessionCursor(cursor);
      const [session] = await this.db
        .select()
        .from(feedSessions)
        .where(
          and(
            eq(feedSessions.id, sessionId),
            eq(feedSessions.userId, viewerId),
          ),
        );
      if (!session || session.expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException(
          'Session de découverte expirée. Recharge la section.',
        );
      }
      if (session.tab !== tab) {
        throw new BadRequestException(
          'Curseur incompatible avec la section demandée.',
        );
      }
      if (offset > session.publicationIds.length) {
        throw new BadRequestException('Curseur de section invalide.');
      }
      // Une publication devenue invisible depuis la construction de la
      // session est filtrée à l'hydratation : on avance dans l'ordre figé
      // jusqu'à remplir la page, sans trou ni doublon.
      let cursorOffset = offset;
      const items: DiscoverPublication[] = [];
      while (
        items.length < limit &&
        cursorOffset < session.publicationIds.length
      ) {
        const chunk = session.publicationIds.slice(
          cursorOffset,
          cursorOffset + (limit - items.length),
        );
        cursorOffset += chunk.length;
        const rows = await this.publicationRows(viewerId, {
          conditions,
          ids: chunk,
          limit: chunk.length,
        });
        items.push(
          ...(await this.toDiscoverItems(
            viewerId,
            this.orderByIds(rows, chunk),
          )),
        );
      }
      return {
        items,
        nextCursor:
          cursorOffset < session.publicationIds.length
            ? encodeSessionCursor(session.id, cursorOffset)
            : null,
      };
    }

    const idRows = await this.db
      .select({ id: publications.id })
      .from(publications)
      .innerJoin(users, eq(users.id, publications.authorId))
      .where(and(...this.baseConditions(viewerId), ...conditions))
      .orderBy(...ordering)
      .limit(FEED_SESSION_SIZE);
    const order = idRows.map((row) => row.id);
    if (order.length === 0) {
      return { items: [], nextCursor: null };
    }

    const [session] = await this.db
      .insert(feedSessions)
      .values({
        userId: viewerId,
        tab,
        format: null,
        city: null,
        publicationIds: order,
        expiresAt: new Date(Date.now() + FEED_SESSION_TTL_MS),
      })
      .returning({ id: feedSessions.id });

    const pageIds = order.slice(0, limit);
    const rows = await this.publicationRows(viewerId, {
      conditions,
      ids: pageIds,
      limit: pageIds.length,
    });
    return {
      items: await this.toDiscoverItems(
        viewerId,
        this.orderByIds(rows, pageIds),
      ),
      nextCursor:
        order.length > limit && session
          ? encodeSessionCursor(session.id, limit)
          : null,
    };
  }

  /** Réordonne des lignes chargées par identifiants selon l'ordre figé. */
  private orderByIds(
    rows: PublicationListRow[],
    ids: string[],
  ): PublicationListRow[] {
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids
      .map((id) => byId.get(id))
      .filter((row): row is PublicationListRow => row !== undefined);
  }

  private async listPublications(
    viewerId: string,
    extraConditions: SQL[],
    ordering: SQL[],
  ): Promise<DiscoverPublication[]> {
    const rows = await this.publicationRows(viewerId, {
      conditions: extraConditions,
      ordering,
      limit: DISCOVER_PUBLICATION_LIMIT,
    });
    return this.toDiscoverItems(viewerId, rows);
  }

  /**
   * Requête commune des listes : visibilité, blocages, modération et
   * feedbacks négatifs toujours filtrés en SQL. `ids` restreint la lecture
   * aux identifiants figés par une session.
   */
  private async publicationRows(
    viewerId: string,
    options: {
      conditions?: SQL[];
      ordering?: SQL[];
      limit: number;
      ids?: string[];
    },
  ): Promise<PublicationListRow[]> {
    if (options.ids && options.ids.length === 0) {
      return [];
    }
    const conditions = [
      ...this.baseConditions(viewerId),
      ...(options.conditions ?? []),
      ...(options.ids ? [inArray(publications.id, options.ids)] : []),
    ];
    const query = this.db
      .select(this.publicationSelection(viewerId))
      .from(publications)
      .innerJoin(users, eq(users.id, publications.authorId))
      .leftJoin(
        quotedPublications,
        eq(quotedPublications.id, publications.quotedPublicationId),
      )
      .leftJoin(
        quotedAuthors,
        eq(quotedAuthors.id, quotedPublications.authorId),
      )
      .where(and(...conditions))
      .$dynamic();
    if (options.ordering?.length) {
      query.orderBy(...options.ordering);
    }
    return query.limit(options.limit);
  }

  /** Colonnes de la liste : auteur, compteurs et visibilité de la citation. */
  private publicationSelection(viewerId: string) {
    const quotedVisibility = and(
      ...visiblePublicationConditions(
        viewerId,
        quotedPublications,
        quotedAuthors,
      ),
    );
    return {
      id: publications.id,
      kind: publications.kind,
      format: publications.format,
      caption: publications.caption,
      createdAt: publications.createdAt,
      visibility: publications.visibility,
      moderationStatus: publications.moderationStatus,
      authorId: publications.authorId,
      author: {
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        verified: users.verified,
      },
      authorPrivateAccount: users.privateAccount,
      quotedId: publications.quotedPublicationId,
      quotedVisibleId: sql<
        string | null
      >`case when (${quotedVisibility}) then ${quotedPublications.id} else null end`,
      likeCount: publications.likeCount,
      hideLikeCount: publications.hideLikeCount,
      commentCount: publications.commentCount,
      repostCount: publications.repostCount,
      viewCount: publications.viewCount,
    };
  }

  /** Conditions d'autorisation communes à toutes les listes de Découvrir. */
  private baseConditions(viewerId: string): SQL[] {
    return [
      ...visiblePublicationConditions(viewerId),
      this.feedbackCondition(viewerId),
      // Comme la grille Explorer : seuls les contenus média (photo, carrousel,
      // vidéo) sont découvrables — les publications texte n'y figurent pas.
      ne(publications.format, 'text'),
    ];
  }

  /** Hydrate les médias et met en forme les lignes déjà autorisées. */
  private async toDiscoverItems(
    viewerId: string,
    rows: PublicationListRow[],
  ): Promise<DiscoverPublication[]> {
    if (rows.length === 0) {
      return [];
    }

    const readableRows = rows.filter(
      (row) => !row.quotedId || row.quotedVisibleId,
    );
    const accessById = new Map<string, MediaAccess>(
      readableRows.map((row) => [
        row.id,
        !row.quotedId &&
        isPubliclyCacheable({
          visibility: row.visibility,
          moderationStatus: row.moderationStatus,
          deleted: false,
          authorPrivateAccount: row.authorPrivateAccount,
        })
          ? 'public'
          : 'signed',
      ]),
    );
    const mediaById = await loadPublicationMedia(
      this.db,
      readableRows.map((row) => row.id),
      this.storage.isConfigured() ? this.storage : null,
      (publicationId) => accessById.get(publicationId) ?? 'signed',
    );

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      format: row.format,
      caption: row.caption,
      createdAt: row.createdAt,
      author: row.author,
      media:
        row.quotedId && !row.quotedVisibleId
          ? []
          : (mediaById.get(row.id) ?? []),
      counters: {
        likes:
          row.hideLikeCount && row.authorId !== viewerId ? 0 : row.likeCount,
        comments: row.commentCount,
        reposts: row.repostCount,
        views: row.viewCount,
      },
    }));
  }

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
}
