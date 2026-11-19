import { useEffect } from 'react';

import { connectSocket } from '@/lib/socket';
import type { PublicationComment } from '@/lib/types';

type DeletedPayload = { publicationId: string; commentId: string };

/**
 * Abonnement temps réel aux commentaires d'une publication.
 *
 * Rejoint le salon `comments:<id>` côté socket — la gateway n'accepte que les
 * comptes ayant le droit de voir la publication — puis traduit les événements
 * en callbacks. Le nettoyage quitte le salon et détache les écouteurs.
 */
export function useCommentLiveEvents({
  token,
  publicationId,
  onCreated,
  onUpdated,
  onDeleted,
}: {
  token: string | null;
  publicationId: string;
  onCreated?: (comment: PublicationComment) => void;
  onUpdated?: (comment: PublicationComment) => void;
  onDeleted?: (commentId: string) => void;
}): void {
  useEffect(() => {
    if (!token) {
      return;
    }
    const socket = connectSocket(token);
    const handleCreated = (view: PublicationComment) => {
      if (view.publicationId === publicationId) {
        onCreated?.(view);
      }
    };
    const handleUpdated = (view: PublicationComment) => {
      if (view.publicationId === publicationId) {
        onUpdated?.(view);
      }
    };
    const handleDeleted = (payload: DeletedPayload) => {
      if (payload?.publicationId === publicationId) {
        onDeleted?.(payload.commentId);
      }
    };
    socket.emit('comments:join', { publicationId });
    socket.on('publication:comment', handleCreated);
    socket.on('publication:comment:update', handleUpdated);
    socket.on('publication:comment:deleted', handleDeleted);
    return () => {
      socket.emit('comments:leave', { publicationId });
      socket.off('publication:comment', handleCreated);
      socket.off('publication:comment:update', handleUpdated);
      socket.off('publication:comment:deleted', handleDeleted);
    };
  }, [token, publicationId, onCreated, onUpdated, onDeleted]);
}
