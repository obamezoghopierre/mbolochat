import { useEffect, useRef } from 'react';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/** En dessous, l'affichage n'est pas compté comme une vue (bruit de scroll). */
export const MIN_TRACKED_WATCH_MS = 1_000;
/** Part de la durée au-delà de laquelle la vue est considérée terminée. */
const COMPLETION_RATIO = 0.95;

/**
 * Enregistre la consommation d'une page du fil, sans jamais bloquer l'UI.
 *
 * Le temps mesuré est le temps **réellement visible** : le compteur tourne quand
 * la page devient active (elle est affichée et l'écran est au premier plan) et il
 * est vidé quand elle cesse de l'être. C'est ce signal — absent jusqu'ici — qui
 * permet au serveur de classer par intérêt réel plutôt que par likes cumulés.
 *
 * Un envoi par activation, fire-and-forget : une coupure réseau ne doit ni
 * afficher d'erreur ni interrompre la lecture.
 */
export function FeedViewTracker({
  publicationId,
  active,
  durationMs,
}: {
  publicationId: string;
  /** La page est affichée et l'écran au premier plan. */
  active: boolean;
  /** Durée du média, si connue (sert au calcul de complétion). */
  durationMs: number | null;
}) {
  const { token } = useAuth();
  const startedAt = useRef<number | null>(null);
  const watchedMs = useRef(0);
  // Valeurs lues au moment de l'envoi, jamais capturées à la création du hook.
  const latest = useRef({ token, durationMs });

  useEffect(() => {
    latest.current = { token, durationMs };
  }, [token, durationMs]);

  useEffect(() => {
    if (!active) {
      return;
    }
    startedAt.current = Date.now();
    return () => {
      const started = startedAt.current;
      if (started === null) {
        return;
      }
      startedAt.current = null;
      watchedMs.current += Math.max(0, Date.now() - started);
      const total = Math.round(watchedMs.current);
      const current = latest.current;
      if (total < MIN_TRACKED_WATCH_MS || !current.token) {
        return;
      }
      watchedMs.current = 0;
      const duration = current.durationMs;
      void api
        .recordView(current.token, publicationId, {
          watchedMs: total,
          completed: duration !== null && total >= duration * COMPLETION_RATIO,
        })
        .catch(() => undefined);
    };
  }, [active, publicationId]);

  return null;
}
