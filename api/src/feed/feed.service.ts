import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';

import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  publicationReactions,
  publicationReposts,
  publicationSaves,
  publications,
  users,
} from '../db/schema.js';
import { loadPublicationMedia } from '../publications/publication-media.js';
import { visiblePublicationConditions } from '../social/publication-visibility.js';
import type { AuthorCard, PublicationView } from '../publications/publications.service.js';

export type FeedTab = 'for-you' | 'following' | 'local';

export const FEED_TABS: readonly FeedTab[] = ['for-you', 'following', 'local'];
export const FEED_DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Élément de feed : la vue de publication, plus l'état de la relation. */
export interface FeedItem extends PublicationView {
  viewer: PublicationView['viewer'] & {
    /** Le visiteur suit l'auteur (abonnement accepté). */
    followingAuthor: boolean;
  };
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

/**
 * Feed de base (plan §8, phase 1).
 *
 * L'autorisation est appliquée en SQL, pas en mémoire : visibilité de la
 * publication, abonnement accepté, blocages dans les deux sens, modération et
 * suppression logique. Le tri porte sur le score matérialisé, ce qui rend le
 * curseur `(hot_score, id)` stable entre deux pages.
 */
@Injectable()
export class FeedService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  async list(
    viewerId: string,
    tab: FeedTab,
    limit: number,
    cursor?: string,
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

    const followsAuthor = sql`exists (
      select 1 from follows f
      where f.follower_id = ${viewerId}
        and f.following_id = ${publications.authorId}
        and f.status = 'accepted'
    )`;

    const conditions = visiblePublicationConditions(viewerId);
    if (tab === 'following') {
      conditions.push(followsAuthor);
    }
    if (tab === 'local') {
      conditions.push(eq(users.city, viewer.city!));
    }

    if (cursor) {
      const decoded = decodeFeedCursor(cursor);
      conditions.push(
        or(
          lt(publications.hotScore, decoded.hotScore),
          and(eq(publications.hotScore, decoded.hotScore), lt(publications.id, decoded.id)),
        )!,
      );
    }

    const authorCard = {
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      verified: users.verified,
    };

    const rows = await this.db
      .select({
        id: publications.id,
        kind: publications.kind,
        format: publications.format,
        caption: publications.caption,
        visibility: publications.visibility,
        createdAt: publications.createdAt,
        author: authorCard,
        likeCount: publications.likeCount,
        commentCount: publications.commentCount,
        repostCount: publications.repostCount,
        saveCount: publications.saveCount,
        viewCount: publications.viewCount,
        hotScore: publications.hotScore,
        reaction: publicationReactions.kind,
        followingAuthor: followsAuthor,
        saved: publicationSaves.userId,
        reposted: publicationReposts.userId,
      })
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
        and(eq(publicationSaves.publicationId, publications.id), eq(publicationSaves.userId, viewerId)),
      )
      .leftJoin(
        publicationReposts,
        and(
          eq(publicationReposts.publicationId, publications.id),
          eq(publicationReposts.userId, viewerId),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(publications.hotScore), desc(publications.id))
      .limit(bounded + 1);

    const page = rows.slice(0, bounded);
    const last = page.at(-1);
    const media = await loadPublicationMedia(
      this.db,
      page.map((row) => row.id),
      this.config.get<string>('SOCIAL_S3_PUBLIC_BASE_URL') ?? null,
    );
    return {
      items: page.map((row) => ({
        id: row.id,
        media: media.get(row.id) ?? [],
        kind: row.kind,
        format: row.format,
        caption: row.caption,
        visibility: row.visibility,
        createdAt: row.createdAt,
        author: { ...row.author } as AuthorCard,
        counters: {
          likes: row.likeCount,
          comments: row.commentCount,
          reposts: row.repostCount,
          saves: row.saveCount,
          views: row.viewCount,
        },
        viewer: {
          reaction: row.reaction ?? null,
          saved: Boolean(row.saved),
          reposted: Boolean(row.reposted),
          followingAuthor: Boolean(row.followingAuthor),
        },
      })),
      nextCursor:
        rows.length > bounded && last ? encodeFeedCursor(last.hotScore, last.id) : null,
    };
  }
}
