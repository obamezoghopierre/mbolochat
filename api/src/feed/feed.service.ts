import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  feedSessions,
  publicationReactions,
  publicationReposts,
  publicationSaves,
  publications,
  users,
} from '../db/schema.js';
import { loadPublicationMedia, type MediaAccess } from '../publications/publication-media.js';
import { ObjectStorageService } from '../social-media/object-storage.service.js';
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

type PublicationRow = {
  id: string;
  kind: 'post' | 'reel';
  format: 'text' | 'image' | 'carousel' | 'video';
  caption: string | null;
  visibility: 'public' | 'followers' | 'private';
  createdAt: Date;
  author: AuthorCard;
  authorPrivateAccount: boolean;
  likeCount: number;
  commentCount: number;
  repostCount: number;
  saveCount: number;
  viewCount: number;
  reaction: 'like' | 'love' | 'fire' | 'clap' | null;
  followingAuthor: unknown;
  saved: string | null;
  reposted: string | null;
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

  /** Abonnements : ordre chronologique strict, curseur stable. */
  private async listChronological(
    viewerId: string,
    limit: number,
    cursor?: string,
    format?: FeedFormat,
  ): Promise<FeedPage> {
    const conditions = [
      ...this.baseConditions(viewerId),
      this.followsAuthor(viewerId),
    ];
    if (format) {
      conditions.push(eq(publications.format, format));
    }
    if (cursor) {
      const decoded = decodeFeedTimeCursor(cursor);
      conditions.push(
        sql`(${publications.createdAt}, ${publications.id}) < (${decoded.createdAt.toISOString()}::timestamptz, ${decoded.id})`,
      );
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
      .where(and(...conditions))
      .orderBy(desc(publications.createdAt), desc(publications.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: await this.toItems(page),
      nextCursor:
        rows.length > limit && last
          ? encodeFeedTimeCursor(last.createdAt, last.id)
          : null,
    };
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
      .orderBy(sql`${this.rankExpression(viewerId)} desc`, desc(publications.id))
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
    return this.toItems(ordered);
  }

  /** Colonnes communes aux deux chemins. */
  private feedColumns(viewerId: string) {
    return {
      id: publications.id,
      kind: publications.kind,
      format: publications.format,
      caption: publications.caption,
      visibility: publications.visibility,
      createdAt: publications.createdAt,
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
      viewCount: publications.viewCount,
      reaction: publicationReactions.kind,
      followingAuthor: this.followsAuthor(viewerId),
      saved: publicationSaves.userId,
      reposted: publicationReposts.userId,
    };
  }

  /** Conditions d'autorisation communes à tous les onglets. */
  private baseConditions(viewerId: string) {
    return [
      ...visiblePublicationConditions(viewerId),
      // Contenus écartés par le visiteur : « Pas intéressé » sur une publication
      // ou masquage d'un auteur. Appliqué en SQL, donc valable sur tous les
      // onglets et toutes les pages d'une session.
      sql`not exists (
        select 1 from content_feedback cf
        where cf.user_id = ${viewerId}
          and (
            (cf.target_type = 'publication' and cf.target_id = ${publications.id})
            or (cf.target_type = 'author' and cf.target_id = ${publications.authorId})
          )
      )`,
    ];
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
  private async toItems(rows: PublicationRow[]): Promise<FeedItem[]> {
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
    const media = await loadPublicationMedia(
      this.db,
      rows.map((row) => row.id),
      this.storage.isConfigured() ? this.storage : null,
      (publicationId) => access.get(publicationId) ?? 'signed',
    );

    return rows.map((row) => ({
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
    }));
  }
}
