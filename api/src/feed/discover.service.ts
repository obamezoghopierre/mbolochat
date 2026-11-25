import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { DRIZZLE, type Database } from '../db/db.module.js';
import { hashtags, publications, users } from '../db/schema.js';
import {
  loadPublicationMedia,
  type MediaAccess,
  type PublicationMediaView,
} from '../publications/publication-media.js';
import { ObjectStorageService } from '../social-media/object-storage.service.js';
import { visiblePublicationConditions } from '../social/publication-visibility.js';
import { isPubliclyCacheable } from '../users/visibility.js';
import { FeedService } from './feed.service.js';

export const DISCOVER_PUBLICATION_LIMIT = 12;
export const DISCOVER_HASHTAG_LIMIT = 10;
export const DISCOVER_SUGGESTION_LIMIT = 8;

const quotedPublications = alias(publications, 'quoted_publications');
const quotedAuthors = alias(users, 'quoted_authors');
export const DISCOVER_SUCCESS_WINDOW_DAYS = 7;

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
          [
            eq(users.city, viewer.city),
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
          ],
          [desc(publications.createdAt), desc(publications.id)],
        )
      : Promise.resolve([] as DiscoverPublication[]);

    const popular = this.listPublications(
      viewerId,
      [],
      [
        desc(publications.hotScore),
        desc(publications.createdAt),
        desc(publications.id),
      ],
    );

    const successful = this.listPublications(
      viewerId,
      [
        sql`${publications.createdAt} >= now() - (${DISCOVER_SUCCESS_WINDOW_DAYS} * interval '1 day')`,
      ],
      [
        desc(
          sql`${publications.likeCount} + ${publications.commentCount} + ${publications.repostCount}`,
        ),
        desc(publications.createdAt),
        desc(publications.id),
      ],
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

    const [nearby, popularItems, successfulItems, hashtagItems, accounts] =
      await Promise.all([
        nearbyFriends,
        popular,
        successful,
        trendingHashtags,
        suggestedAccounts,
      ]);

    return {
      cityKnown: Boolean(viewer.city),
      sections: {
        nearbyFriends: nearby,
        popular: popularItems,
        successful: successfulItems,
        trendingHashtags: hashtagItems,
        suggestedAccounts: accounts,
      },
    };
  }

  private async listPublications(
    viewerId: string,
    extraConditions: SQL[],
    ordering: SQL[],
  ): Promise<DiscoverPublication[]> {
    const quotedVisibility = and(
      ...visiblePublicationConditions(
        viewerId,
        quotedPublications,
        quotedAuthors,
      ),
    );
    const rows = await this.db
      .select({
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
      })
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
      .where(
        and(
          ...visiblePublicationConditions(viewerId),
          this.feedbackCondition(viewerId),
          ...extraConditions,
        ),
      )
      .orderBy(...ordering)
      .limit(DISCOVER_PUBLICATION_LIMIT);

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
