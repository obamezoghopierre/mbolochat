import { useEvent } from 'expo';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { Play, Volume2, VolumeX } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { FeedSurface, Radii, Spacing } from '@/constants/theme';
import { resolveMediaUrl } from '@/lib/media-url';
import type { FeedPost } from '@/lib/types';
import { FeedGestureLayer } from './feed-gestures';
import { HeartBurstOverlay } from './heart-burst';
import { ProgressBar } from './progress-bar';

/** Décor commun fourni par le pager (hauteur, activité, cœur, échelle du like). */
export interface FeedPageChrome {
  height: number;
  /** Hauteur de la barre du bas : les overlays remontent d'autant. */
  barInset: number;
  isActive: boolean;
  /**
   * Écart signé avec la page active (−1 = précédente, +1 = suivante).
   * Sert au préchargement : une page voisine garde son lecteur monté et
   * préparé sans jouer, pour que le swipe suivant démarre instantanément.
   */
  distance: number;
  /** Index actif du pager : sert de clé pour réarmer la lecture. */
  activeIndex: number;
  /** Incrémenté à chaque double-tap : rejoue le cœur. */
  burstKey: number;
  likeScale: Animated.Value;
}

/** URL fixe (relative) du média vidéo d'une publication. */
function videoUrl(post: FeedPost): string | null {
  return post.media?.find((media) => media.kind === 'video' && media.url)?.url ?? null;
}

/** Image de couverture (variant `poster`) du média vidéo. */
function videoPoster(post: FeedPost): string | null {
  return post.media?.find((media) => media.kind === 'video')?.posterUrl ?? null;
}

/**
 * Page vidéo plein écran façon TikTok : la vidéo couvre l'écran, tap pour
 * suspendre, double-tap pour réagir, appui long pour suspendre pendant le geste,
 * barre de progression scrubbable en bas.
 *
 * Un lecteur par item, créé par `useVideoPlayer` : React gère tout son cycle de
 * vie (montage, recyclage, libération). Jamais de lecteur partagé entre deux
 * VideoView — c'était la cause de
 * « The player has been notified of disconnection from the player view ».
 *
 * Seule la page active joue ; quitter la page réarme la lecture.
 */
export function VideoPage({
  post,
  chrome,
  onDoubleTapLike,
  onToggleSound,
  onScrubStateChange,
  muted,
}: {
  post: FeedPost;
  chrome: FeedPageChrome;
  onDoubleTapLike: () => void;
  /** Le son est global au fil : le pager décide, la page applique. */
  onToggleSound: () => void;
  /** Vrai dès que le doigt glisse sur la barre : le feed fige son scroll. */
  onScrubStateChange: (scrubbing: boolean) => void;
  muted: boolean;
}) {
  const url = resolveMediaUrl(videoUrl(post));
  const posterUrl = resolveMediaUrl(videoPoster(post));
  const insets = useSafeAreaInsets();
  const [userPaused, setUserPaused] = useState(false);

  // Le lecteur naît ici avec la bonne source. Le cache disque est activé sur la
  // source (`useCaching`), plafonné à 200 Mo par le pager. Revenir sur une
  // vidéo vue ne re-télécharge rien : ExoPlayer relit le SimpleCache.
  const player = useVideoPlayer(
    url,
    (instance) => {
      // Boucle native : la tête revient au début sans état « terminé ».
      instance.loop = true;
      // 50 ms : assez fin pour que la barre progresse sans à-coups, sans
      // inonder le pont JS d'événements.
      instance.timeUpdateEventInterval = 0.05;
    },
  );

  // `status` sert de déclencheur de reprise : un lecteur recyclé peut être
  // encore `loading` au moment où sa page redevient active, et `play()` appelé
  // trop tôt est perdu. On relance donc aussi quand il devient `readyToPlay`.
  // Il sert aussi à garder le poster jusqu'à la première image décodée.
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  useEffect(() => {
    // `muted` est une propriété impérative de l'API expo-video : la règle
    // d'immutabilité du React Compiler ne s'applique pas à un objet natif.
    // eslint-disable-next-line react-hooks/immutability
    player.muted = muted;
  }, [muted, player]);

  // Devenir la page active réarme la lecture : une pause volontaire ne doit pas
  // survivre à la sortie de l'écran : dès que la page devient inactive, le
  // drapeau retombe. C'est fait pendant le rendu (pas dans un effet) parce que
  // la règle `set-state-in-effect` l'interdit et qu'on veut la valeur à jour
  // avant l'effet de lecture ci-dessous.
  if (!chrome.isActive && userPaused) {
    setUserPaused(false);
  }

  useEffect(() => {
    if (!chrome.isActive || userPaused) {
      player.pause();
      return;
    }
    // `status` est dans les dépendances : un lecteur recyclé encore `loading`
    // ignore `play()` appelé trop tôt, il faut relancer quand il est prêt.
    player.play();
  }, [chrome.isActive, userPaused, player, status]);

  const togglePlayback = useCallback(() => setUserPaused((value) => !value), []);

  /** Source unique pour les deux icônes : pause volontaire sur la page active. */
  const isPaused = userPaused && chrome.isActive;
  const pauseForLongPress = useCallback(() => setUserPaused(true), []);
  const resumeAfterLongPress = useCallback(() => setUserPaused(false), []);

  // Le lecteur est figé pendant le glissement et ne repart qu'au relâchement,
  // et seulement s'il jouait avant : une pause volontaire reste une pause.
  // Les icônes restent pilotées par `isPaused`, jamais par le scrub.
  const handleSeekStart = useCallback(() => player.pause(), [player]);
  const handleSeekEnd = useCallback(
    (seconds: number) => {
      // Seek précis : la position finale doit être exacte, pas tolérante.
      seekExactly(player, seconds);
      // La reprise attend que le seek natif soit appliqué : jouer juste après
      // l'affectation de `currentTime` relance parfois la lecture à l'ancienne
      // position pendant une frame.
      resumeAfterSeek(player, chrome.isActive && !userPaused);
    },
    [chrome.isActive, player, userPaused],
  );

  // Le poster reste affiché tant que la première image n'est pas décodée :
  // sans lui, chaque changement de vidéo laisserait voir un flash noir le
  // temps que le lecteur se prépare.
  const showPoster = status !== 'readyToPlay';

  return (
    <View style={[styles.page, { height: chrome.height }]}>
      <VideoView
        player={player}
        style={styles.surface}
        // `surfaceType="textureView"` : sur Android, une `SurfaceView` est
        // composée dans une couche native séparée. Quand la liste recycle les
        // cellules pendant le scroll, cette couche garde l'ancienne position
        // et la vidéo « flotte » hors de sa page — le défaut visible au
        // scroll. Une `TextureView` est un vrai View, découpé et positionné
        // comme le reste de la hiérarchie.
        surfaceType="textureView"
        contentFit="cover"
        nativeControls={false}
        pointerEvents="none"
      />

      {showPoster && posterUrl ? (
        <Image
          source={{ uri: posterUrl }}
          style={styles.surface}
          resizeMode="cover"
          pointerEvents="none"
        />
      ) : null}

      <FeedGestureLayer
        accessibilityLabel="Vidéo : deux taps pour réagir, un tap pour suspendre"
        onDoubleTap={onDoubleTapLike}
        onTap={togglePlayback}
        onLongPressStart={pauseForLongPress}
        onLongPressEnd={resumeAfterLongPress}
      />

      <HeartBurstOverlay burstKey={chrome.burstKey} />

      {/* Icône centrale et bouton son partagent `isPaused` : les deux
          apparaissent sur une pause volontaire et disparaissent dès la reprise
          (l'ancienne version laissait le volume visible en lecture). */}
      {isPaused ? (
        <View pointerEvents="none" style={styles.playBadge}>
          <Icon icon={Play} size={34} color={FeedSurface.onMedia} fill={FeedSurface.onMedia} />
        </View>
      ) : null}

      {isPaused ? (
        // Décalé sous la barre d'onglets du haut : sans les insets, le bouton
        // son passait dessous et devenait intouchable.
        <View style={[styles.topRight, { top: insets.top + Spacing.six }]}>
          <Pressable
            onPress={onToggleSound}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{ selected: muted }}
            accessibilityLabel={muted ? 'Activer le son' : 'Couper le son'}
            style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}>
            <Icon icon={muted ? VolumeX : Volume2} size={18} color={FeedSurface.onMedia} />
          </Pressable>
        </View>
      ) : null}

      <ProgressBar
        player={player}
        bottomInset={chrome.barInset}
        active={chrome.isActive}
        onSeekStart={handleSeekStart}
        onSeekEnd={handleSeekEnd}
        onScrubStateChange={onScrubStateChange}
      />
    </View>
  );
}

/** Seek frame-accurate hors rendu (helper libre : `player` est un objet natif). */
function seekExactly(player: VideoPlayer, seconds: number) {
  player.seekTolerance = { toleranceBefore: 0, toleranceAfter: 0 };
  player.currentTime = seconds;
}

/** Délai laissé au lecteur pour appliquer un seek avant de reprendre. */
const RESUME_AFTER_SEEK_MS = 60;

/** Reprend la lecture une fois le seek précis appliqué, et seulement si elle jouait. */
function resumeAfterSeek(player: VideoPlayer, shouldResume: boolean) {
  if (!shouldResume) {
    return;
  }
  setTimeout(() => player.play(), RESUME_AFTER_SEEK_MS);
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: FeedSurface.background,
    justifyContent: 'flex-end',
  },
  // Bornes explicites : sans elles, la surface native peut conserver la taille
  // de la page recyclée précédente et laisser apparaître une bande noire.
  surface: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FeedSurface.background,
  },
  playBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: '44%',
    width: 74,
    height: 74,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topRight: {
    position: 'absolute',
    right: Spacing.three,
  },
  roundButton: {
    width: 36,
    height: 36,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});