import { useEventListener } from 'expo';
import type { PlayerError, VideoPlayer, VideoPlayerStatus } from 'expo-video';
import { useCallback, useState, useSyncExternalStore } from 'react';

/**
 * Statut natif du lecteur, synchronisé avec rattrapage.
 *
 * La transition `idle → loading` est émise pendant la préparation de la source,
 * avant que l'écouteur React ne soit attaché : un simple `useEvent` la rate et
 * le statut reste périmé (`idle`). Tant que le lecteur atteint ensuite
 * `readyToPlay`, l'événement suivant est capté et tout se rattrape ; mais sur un
 * lecteur qui reste bloqué en chargement (décodeur H.264 sans frame, serveur
 * muet), aucune transition suivante n'est émise — le statut ne se rattrape
 * jamais, et le garde-fou, la reprise, le retry et la progression ne se
 * déclenchent pas.
 *
 * `useSyncExternalStore` relit l'état natif au moment de l'abonnement
 * (rattrapage de la transition manquée) puis à chaque notification, ce qui
 * garantit que le statut reflète toujours l'état courant du lecteur.
 */
export function usePlayerStatus(player: VideoPlayer): {
  status: VideoPlayerStatus;
  error: PlayerError | null;
} {
  const subscribe = useCallback(
    (notify: () => void) => {
      const subscription = player.addListener('statusChange', notify);
      return () => subscription.remove();
    },
    [player],
  );
  const getSnapshot = useCallback(() => player.status, [player]);
  const status = useSyncExternalStore(subscribe, getSnapshot);

  // L'erreur n'est pas une propriété lisible du lecteur : elle ne transite que
  // par l'événement. On la mémorise à part, sans état dans le corps d'un effet.
  const [error, setError] = useState<PlayerError | null>(null);
  useEventListener(player, 'statusChange', (event) => setError(event.error ?? null));

  return { status, error };
}