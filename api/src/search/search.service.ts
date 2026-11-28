import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, ilike, lt, ne, or, sql } from 'drizzle-orm';

import { DRIZZLE, type Database } from '../db/db.module.js';
import { hashtags, publications, users } from '../db/schema.js';
import { decodeFeedCursor, encodeFeedCursor } from '../feed/feed.service.js';
import {
  loadPublicationMedia,
  type MediaAccess,
  type PublicationMediaView,
} from '../publications/publication-media.js';
import { ObjectStorageService } from '../social-media/object-storage.service.js';
import { visiblePublicationConditions } from '../social/publication-visibility.js';
import { isPubliclyCacheable } from '../users/visibility.js';

export type SearchType = 'all' | 'users' | 'publications' | 'hashtags';
export const SEARCH_TYPES: readonly SearchType[] = [
  'all',
  'users',
  'publications',
  'hashtags',
];
export const SEARCH_DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
/** En dessous, la recherche trigramme n'apporte rien et coûte cher. */
export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_MAX_QUERY_LENGTH = 100;

/** Relation du lecteur avec un compte trouvé (`none` = pas d'abonnement). */
export type SearchFollowStatus = 'none' | 'pending' | 'accepted';

export interface SearchUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
  privateAccount: boolean;
  /** Abonnement du lecteur : le bouton « Suivre » part de l'état réel. */
  followStatus: SearchFollowStatus;
}

/**
 * Carte légère d'une publication trouvée, même forme que les vignettes de
 * Découvrir : le client en fait une grille et ouvre la visionneuse sans
 * redemander les médias.
 */
export interface SearchPublication {
  id: string;
  kind: 'post' | 'reel';
  format: 'text' | 'image' | 'carousel' | 'video';
  caption: string | null;
  createdAt: Date;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    verified: boolean;
  };
  media: PublicationMediaView[];
  counters: {
    likes: number;
    comments: number;
    reposts: number;
    views: number;
  };
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

/**
 * Recherche unifiée (plan §8, phase 1).
 *
 * Deux moteurs PostgreSQL, pas de dépendance externe :
 * - pleine texte `tsvector`/`websearch_to_tsquery('french')` sur les légendes ;
 * - trigrammes (`pg_trgm`, index GIN) pour les pseudos, noms et hashtags, qui
 *   autorisent les fautes de frappe partielles.
 *
 * La visibilité, les abonnements, les blocages et la modération restent filtrés
 * en SQL, exactement comme dans le feed.
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: ObjectStorageService,
  ) {}

  async search(
    viewerId: string,
    input: { q: string; type: SearchType; limit: number; cursor?: string },
  ): Promise<SearchResult> {
    const query = input.q.trim();
    if (query.length < SEARCH_MIN_QUERY_LENGTH || query.length > SEARCH_MAX_QUERY_LENGTH) {
      throw new BadRequestException(
        `La recherche doit contenir entre ${SEARCH_MIN_QUERY_LENGTH} et ${SEARCH_MAX_QUERY_LENGTH} caractères.`,
      );
    }

    const [viewer] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, viewerId));
    if (!viewer) {
      throw new NotFoundException('Compte introuvable.');
    }

    const limit = Math.min(Math.max(1, input.limit), MAX_LIMIT);
    // Le curseur n'a de sens que sur un type précis.
    const cursor = input.type === 'all' ? undefined : input.cursor;

    const emptyUsers = { items: [], nextCursor: null };
    const emptyPublications = { items: [], nextCursor: null };
    const emptyHashtags = { items: [], nextCursor: null };

    const usersBlock =
      input.type === 'all' || input.type === 'users'
        ? await this.searchUsers(viewerId, query, limit, cursor)
        : emptyUsers;
    const publicationsBlock =
      input.type === 'all' || input.type === 'publications'
        ? await this.searchPublications(viewerId, query, limit, input.type === 'publications' ? cursor : undefined)
        : emptyPublications;
    const hashtagsBlock =
      input.type === 'all' || input.type === 'hashtags'
        ? await this.searchHashtags(query, limit, cursor)
        : emptyHashtags;

    return { users: usersBlock, publications: publicationsBlock, hashtags: hashtagsBlock };
  }

  /** Hashtags les plus utilisés, pour l'écran Découvrir. */
  async trending(limit = 20): Promise<SearchHashtag[]> {
    const bounded = Math.min(Math.max(1, limit), 50);
    return this.db
      .select({
        id: hashtags.id,
        tag: hashtags.tag,
        usageCount: hashtags.usageCount,
        trendScore: hashtags.trendScore,
      })
      .from(hashtags)
      .orderBy(desc(hashtags.trendScore), desc(hashtags.usageCount), asc(hashtags.tag))
      .limit(bounded);
  }

  private async searchUsers(
    viewerId: string,
    query: string,
    limit: number,
    cursor?: string,
  ): Promise<SearchBlock<SearchUser>> {
    const pattern = `%${query}%`;
    const conditions = [
      or(ilike(users.username, pattern), ilike(users.displayName, pattern))!,
      ne(users.id, viewerId),
      sql`not exists (
        select 1 from blocks b
        where (b.blocker_id = ${viewerId} and b.blocked_id = ${users.id})
           or (b.blocker_id = ${users.id} and b.blocked_id = ${viewerId})
      )`,
    ];

    if (cursor) {
      const decoded = decodeUserCursor(cursor);
      conditions.push(
        sql`(${users.username}, ${users.id}) > (${decoded.username}, ${decoded.id})`,
      );
    }

    const rows = await this.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        verified: users.verified,
        privateAccount: users.privateAccount,
        followStatus: sql<'accepted' | 'pending' | null>`(
          select f.status from follows f
          where f.follower_id = ${viewerId} and f.following_id = ${users.id}
        )`,
      })
      .from(users)
      .where(and(...conditions))
      .orderBy(asc(users.username), asc(users.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(({ followStatus, ...user }) => ({
        ...user,
        followStatus: followStatus ?? ('none' as const),
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeUserCursor(last.username, last.id)
          : null,
    };
  }

  private async searchPublications(
    viewerId: string,
    query: string,
    limit: number,
    cursor?: string,
  ): Promise<SearchBlock<SearchPublication>> {
    const conditions = [
      ...visiblePublicationConditions(viewerId),
      sql`(
        ${publications.searchVector} @@ websearch_to_tsquery('french', ${query})
        or ${publications.caption} ilike ${`%${query}%`}
      )`,
    ];

    if (cursor) {
      const decoded = decodeFeedCursor(cursor);
      conditions.push(
        or(
          lt(publications.hotScore, decoded.hotScore),
          and(eq(publications.hotScore, decoded.hotScore), lt(publications.id, decoded.id)),
        )!,
      );
    }

    const rows = await this.db
      .select({
        id: publications.id,
        kind: publications.kind,
        format: publications.format,
        caption: publications.caption,
        createdAt: publications.createdAt,
        hotScore: publications.hotScore,
        visibility: publications.visibility,
        moderationStatus: publications.moderationStatus,
        authorId: publications.authorId,
        authorPrivateAccount: users.privateAccount,
        quotedId: publications.quotedPublicationId,
        likeCount: publications.likeCount,
        hideLikeCount: publications.hideLikeCount,
        commentCount: publications.commentCount,
        repostCount: publications.repostCount,
        viewCount: publications.viewCount,
        author: {
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          verified: users.verified,
        },
      })
      .from(publications)
      .innerJoin(users, eq(users.id, publications.authorId))
      .where(and(...conditions))
      .orderBy(desc(publications.hotScore), desc(publications.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);

    // Une URL publique n'est servie que pour un contenu réellement public ;
    // tout le reste passe par une URL signée courte (comme Découvrir). Une
    // citation n'expose aucun média ici : ses copies dépendent de la
    // visibilité de l'originale, que la recherche ne vérifie pas.
    const accessById = new Map<string, MediaAccess>(
      page.map((row) => [
        row.id,
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
      page.filter((row) => !row.quotedId).map((row) => row.id),
      this.storage.isConfigured() ? this.storage : null,
      (publicationId) => accessById.get(publicationId) ?? 'signed',
    );

    return {
      items: page.map((row) => ({
        id: row.id,
        kind: row.kind,
        format: row.format,
        caption: row.caption,
        createdAt: row.createdAt,
        author: row.author,
        media: row.quotedId ? [] : (mediaById.get(row.id) ?? []),
        counters: {
          likes:
            row.hideLikeCount && row.authorId !== viewerId ? 0 : row.likeCount,
          comments: row.commentCount,
          reposts: row.repostCount,
          views: row.viewCount,
        },
      })),
      nextCursor:
        rows.length > limit && last ? encodeFeedCursor(last.hotScore, last.id) : null,
    };
  }

  private async searchHashtags(
    query: string,
    limit: number,
    cursor?: string,
  ): Promise<SearchBlock<SearchHashtag>> {
    const tag = query.replace(/^#+/, '').toLowerCase();
    const conditions = [ilike(hashtags.tag, `%${tag}%`)];
    if (cursor) {
      const decoded = decodeHashtagCursor(cursor);
      conditions.push(
        or(
          lt(hashtags.usageCount, decoded.usageCount),
          and(eq(hashtags.usageCount, decoded.usageCount), lt(hashtags.id, decoded.id)),
        )!,
      );
    }

    const rows = await this.db
      .select({
        id: hashtags.id,
        tag: hashtags.tag,
        usageCount: hashtags.usageCount,
        trendScore: hashtags.trendScore,
      })
      .from(hashtags)
      .where(and(...conditions))
      .orderBy(desc(hashtags.usageCount), desc(hashtags.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        rows.length > limit && last
          ? encodeHashtagCursor(last.usageCount, last.id)
          : null,
    };
  }
}

/** Curseur `(username, id)` : le pseudo est sans séparateur, on peut le garder. */
function encodeUserCursor(username: string, id: string): string {
  return Buffer.from(`u|${username}|${id}`, 'utf8').toString('base64url');
}

function decodeUserCursor(cursor: string): { username: string; id: string } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const [prefix, username, id] = raw.split('|');
  if (prefix !== 'u' || !username || !id) {
    throw new BadRequestException('Curseur invalide.');
  }
  return { username, id };
}

function encodeHashtagCursor(usageCount: number, id: string): string {
  return Buffer.from(`h|${usageCount}|${id}`, 'utf8').toString('base64url');
}

function decodeHashtagCursor(cursor: string): { usageCount: number; id: string } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const [prefix, usage, id] = raw.split('|');
  const usageCount = Number(usage);
  if (prefix !== 'h' || !id || !Number.isSafeInteger(usageCount)) {
    throw new BadRequestException('Curseur invalide.');
  }
  return { usageCount, id };
}
