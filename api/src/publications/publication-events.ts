import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

import type { CommentView } from './publications.service.js';

const roomOf = (publicationId: string) => `comments:${publicationId}`;

/**
 * Diffusion des commentaires en temps réel, même pattern que
 * `MessageEventsDispatcher` : la gateway branche le serveur Socket.IO une fois
 * construite, le service publie sans connaître le transport.
 *
 * Les salons `comments:<publicationId>` ne sont rejoints qu'après vérification
 * de visibilité côté gateway : le contenu d'un commentaire ne fuit jamais vers
 * un compte qui ne peut pas voir la publication.
 */
@Injectable()
export class PublicationEvents {
  private server?: Server;

  attachServer(server: Server): void {
    this.server = server;
  }

  /** Nouveau commentaire ou réponse (aussi émis pour un rejeu idempotent). */
  emitCommentCreated(publicationId: string, view: CommentView): void {
    this.server?.to(roomOf(publicationId)).emit('publication:comment', view);
  }

  /** Compteurs, réactions, épinglage ou réponse modifiés sur un commentaire. */
  emitCommentUpdated(view: CommentView): void {
    this.server?.to(roomOf(view.publicationId)).emit('publication:comment:update', view);
  }

  /** Commentaire supprimé : les clients retirent aussi ses réponses directes. */
  emitCommentDeleted(publicationId: string, commentId: string): void {
    this.server
      ?.to(roomOf(publicationId))
      .emit('publication:comment:deleted', { publicationId, commentId });
  }
}
