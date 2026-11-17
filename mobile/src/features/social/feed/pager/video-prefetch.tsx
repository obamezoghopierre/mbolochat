import { useVideoPlayer } from 'expo-video';

/**
 * Préchauffe le cache disque d'une vidéo voisine **sans aucune `VideoView`**.
 *
 * Le simple fait de construire un `VideoPlayer` avec une source lance
 * `prepare()` côté natif : ExoPlayer remplit son cache de lecture sans qu'on
 * appelle `play()`, donc sans décodage ni son. Quand la page devient active,
 * `VideoPage` crée son propre lecteur et trouve les octets déjà en cache.
 *
 * Un lecteur détaché ne peut être rattaché à aucune vue : c'est ce qui rend
 * impossible le conflit « joueur déjà connecté à une vue » qui cassait le
 * scroll. Il ne faut jamais y attacher de `VideoView`, même temporairement.
 */
export function VideoPrefetch({ url }: { url: string }) {
  useVideoPlayer({ uri: url, useCaching: true }, (player) => {
    // Aucun son : ce lecteur n'est pas visible et ne joue jamais.
    player.muted = true;
  });
  return null;
}
