import { useEffect, useRef } from 'react';

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
  const handlers = useRef({ onCreated, onUpdated, onDeleted });
  useEffect(() => {
    handlers.current = { onCreated, onUpdated, onDeleted };
  }, [onCreated, onUpdated, onDeleted]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const socket = connectSocket(token);
    const handleCreated = (view: PublicationComment) => {
      if (view.publicationId === publicationId) {
        handlers.current.onCreated?.(view);
      }
    };
    const handleUpdated = (view: PublicationComment) => {
      if (view.publicationId === publicationId) {
        handlers.current.onUpdated?.(view);
      }
    };
    const handleDeleted = (payload: DeletedPayload) => {
      if (payload?.publicationId === publicationId) {
        handlers.current.onDeleted?.(payload.commentId);
      }
    };
    const join = () => {
      if (socket.connected) {
        socket.emit('comments:join', { publicationId });
      }
    };
    socket.on('connect', join);
    socket.on('publication:comment', handleCreated);
    socket.on('publication:comment:update', handleUpdated);
    socket.on('publication:comment:deleted', handleDeleted);
    join();
    return () => {
      socket.off('connect', join);
      if (socket.connected) {
        socket.emit('comments:leave', { publicationId });
      }
      socket.off('publication:comment', handleCreated);
      socket.off('publication:comment:update', handleUpdated);
      socket.off('publication:comment:deleted', handleDeleted);
    };
  }, [token, publicationId]);
}
