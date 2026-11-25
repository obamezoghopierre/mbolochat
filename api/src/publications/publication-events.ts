import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Server } from 'socket.io';

import { userRoomOf } from '../chat/socket-auth.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { publications, users } from '../db/schema.js';
import { visibleCommentAuthorCondition } from '../social/comment-visibility.js';
import { visiblePublicationConditions } from '../social/publication-visibility.js';
import type { CommentView } from './publications.service.js';

const commentsRoomOf = (publicationId: string) => `comments:${publicationId}`;
/** Salon de compteurs rejoint uniquement après vérification de visibilité. */
export const feedPostRoomOf = (publicationId: string) =>
  `feed:post:${publicationId}`;

export interface PublicationCounters {
  likes: number;
  comments: number;
  reposts: number;
  saves: number;
  shares: number;
  views: number;
}

/**
 * Diffusion des commentaires et compteurs du feed. L'appartenance à un salon ne
 * suffit pas : chaque événement réévalue l'autorisation des lecteurs présents,
 * car un blocage, un compte privé ou une modération peuvent survenir après.
 */
@Injectable()
export class PublicationEvents {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private server?: Server;

  attachServer(server: Server): void {
    this.server = server;
  }

  /** Nouveau commentaire ou réponse (aussi émis pour un rejeu idempotent). */
  emitCommentCreated(publicationId: string, view: CommentView): void {
    void this.emitToAuthorizedViewers(
      commentsRoomOf(publicationId),
      'publication:comment',
      view,
      publicationId,
      view.author.id,
    ).catch(() => undefined);
  }

  /** Compteurs, réactions, épinglage ou réponse modifiés sur un commentaire. */
  emitCommentUpdated(view: CommentView): void {
    void this.emitToAuthorizedViewers(
      commentsRoomOf(view.publicationId),
      'publication:comment:update',
      view,
      view.publicationId,
      view.author.id,
    ).catch(() => undefined);
  }

  /**
   * L'auteur reçoit toujours les valeurs brutes dans son salon personnel. Les
   * autres ne reçoivent l'événement que s'ils voient encore la publication.
   */
  emitPublicationStats(
    publicationId: string,
    counters: PublicationCounters,
    authorId: string,
    hideLikeCount: boolean,
  ): void {
    const server = this.server;
    if (!server) {
      return;
    }
    server
      .to(userRoomOf(authorId))
      .emit('publication:stats', { publicationId, counters });
    const viewerCounters = hideLikeCount ? { ...counters, likes: 0 } : counters;
    void this.authorizedViewerRooms(
      feedPostRoomOf(publicationId),
      publicationId,
    )
      .then((rooms) => {
        const viewers = rooms.filter((room) => room !== userRoomOf(authorId));
        if (viewers.length > 0) {
          server.to(viewers).emit('publication:stats', {
            publicationId,
            counters: viewerCounters,
          });
        }
      })
      .catch(() => undefined);
  }

  /** Commentaire supprimé : les clients retirent aussi ses réponses directes. */
  emitCommentDeleted(publicationId: string, commentId: string): void {
    void this.emitToAuthorizedViewers(
      commentsRoomOf(publicationId),
      'publication:comment:deleted',
      { publicationId, commentId },
      publicationId,
    ).catch(() => undefined);
  }

  private async emitToAuthorizedViewers(
    room: string,
    event: string,
    payload: unknown,
    publicationId: string,
    commentAuthorId?: string,
  ): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }
    const rooms = await this.authorizedViewerRooms(
      room,
      publicationId,
      commentAuthorId,
    );
    if (rooms.length > 0) {
      server.to(rooms).emit(event, payload);
    }
  }

  private async authorizedViewerRooms(
    room: string,
    publicationId: string,
    commentAuthorId?: string,
  ): Promise<string[]> {
    const server = this.server;
    if (!server) {
      return [];
    }
    const sockets = await server.in(room).fetchSockets();
    const viewerIds = [
      ...new Set(
        sockets
          .map((socket) => socket.data.userId)
          .filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          ),
      ),
    ];
    if (viewerIds.length === 0) {
      return [];
    }

    const viewer = alias(users, 'event_viewer');
    const author = alias(users, 'event_author');
    const commentAuthor = alias(users, 'event_comment_author');
    const conditions: SQL[] = [
      inArray(viewer.id, viewerIds),
      ...visiblePublicationConditions(viewer.id, publications, author),
    ];
    if (commentAuthorId) {
      conditions.push(visibleCommentAuthorCondition(viewer.id, commentAuthor));
    }
    const rows = await this.db
      .select({ id: viewer.id })
      .from(viewer)
      .innerJoin(publications, eq(publications.id, publicationId))
      .innerJoin(author, eq(author.id, publications.authorId))
      .leftJoin(
        commentAuthor,
        commentAuthorId ? eq(commentAuthor.id, commentAuthorId) : sql`false`,
      )
      .where(and(...conditions));
    return rows.map((row) => userRoomOf(row.id));
  }
}
