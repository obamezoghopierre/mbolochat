import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import * as Haptics from 'expo-haptics';
import { Expand, Play, Volume2, VolumeX } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedSurface, Radii, Spacing } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import type { FeedPost } from '@/lib/types';
import { FeedGestureLayer } from './feed-gestures';
import { videoPosterUrl, videoSourceUrl } from './video-source';
import { HeartBurstOverlay } from './heart-burst';
import { ProgressBar } from './progress-bar';

/** Décor commun fourni par le pager (hauteur, activité, cœur, échelle du like). */
export interface FeedPageChrome {
  height: number;
  /** Hauteur de la barre du bas : les overlays remontent d'autant. */
  barInset: number;
  /**
   * La page est visible **et** l'écran est au premier plan : seule une page
   * active joue. Une page peut rester montée (préchargement) sans jouer.
   */
  isActive: boolean;
  /** Incrémenté à chaque double-tap : rejoue le cœur. */
  burstKey: number;
  /** Point du double-tap, pour faire naître le cœur sous le doigt. */
  burstPoint: { x: number; y: number } | null;
  likeScale: Animated.Value;
  /** Feuille de commentaires ouverte : le média s'affiche sans contrôles. */
  hideOverlays: boolean;
}

/** Cadence des `timeUpdate` en lecture normale : la barre n'a pas besoin de plus. */
const TIME_UPDATE_INTERVAL_S = 0.25;
/** Cadence pendant un glissement sur la barre : le doigt veut du précis. */
const SCRUB_TIME_UPDATE_INTERVAL_S = 0.05;
/** Saut du double-tap latéral, en secondes (repère des fils vidéo courts). */
const DOUBLE_TAP_SKIP_SECONDS = 10;
/** Le centre de l'écran (fraction) reste réservé au like : ±Seek sur les bords. */
const DOUBLE_TAP_CENTER_RATIO = 0.3;
/** Vitesses proposées par la pastille, dans l'ordre du cycle. */
const PLAYBACK_RATES = [1, 1.5, 2] as const;
/** Reprises automatiques avant d'afficher l'état d'erreur. */
const AUTO_RETRY_DELAYS_MS = [1200, 4000, 10000] as const;
/** Position en dessous de laquelle on ne « reprend » pas (début de vidéo). */
const RESUME_MIN_SECONDS = 3;

/**
 * Positions de lecture par publication : quitter une vidéo puis y revenir la
 * reprend là où elle en était. Mémoire module : elle survit au démontage de la
 * page (pager qui recycle les cellules) sans dépendre d'un store.
 */
const playbackPositions = new Map<string, number>();

/**
 * Page vidéo plein écran de type fil vertical : la vidéo couvre l'écran, tap pour
 * suspendre, double-tap pour réagir, appui long pour suspendre pendant le geste,
 * barre de progression scrubbable en bas.
 *
 * Un lecteur par page, créé par `useVideoPlayer` : React gère tout son cycle de
 * vie (montage, recyclage, libération), aucun `release()` manuel.
 *
 * Cette page n'est montée que pour la page **active** du pager : c'est la seule
 * `VideoView` vivante de l'application à un instant donné. Les voisines se
 * contentent d'un poster et d'un lecteur détaché (voir `VideoPrefetch`). Cette
 * unicité est ce qui empêche le conflit natif « The player has been notified of
 * disconnection from the player view, even though it's still connected ».
 *
 * Quitter la page réarme la lecture.
 */
export function VideoPage({
  post,
  chrome,
  onDoubleTapLike,
  onToggleSound,
  onScrubStateChange,
  scrubbing,
  muted,
  preferLowQuality = false,
}: {
  post: FeedPost;
  chrome: FeedPageChrome;
  /** Réseau mobile : servir la variante basse qualité quand elle existe. */
  preferLowQuality?: boolean;
  onDoubleTapLike: (point: { x: number; y: number } | null) => void;
  /** Le son est global au fil : le pager décide, la page applique. */
  onToggleSound: () => void;
  /** Vrai dès que le doigt glisse sur la barre : le feed fige son scroll. */
  onScrubStateChange: (scrubbing: boolean) => void;
  /** Vrai pendant un glissement : la cadence de progression s'affine. */
  scrubbing: boolean;
  muted: boolean;
}) {
  // Même résolution que le préchargement détaché : sans cela, deux URL
  // différentes (donc deux entrées de cache) pour la même vidéo.
  const url = videoSourceUrl(post, preferLowQuality);
  const posterUrl = videoPosterUrl(post);
  const insets = useSafeAreaInsets();
  const { width: pageWidth } = useWindowDimensions();
  const viewRef = useRef<VideoView>(null);
  const [userPaused, setUserPaused] = useState(false);
  // Source dont la première image a été décodée : le poster reste affiché page
  // par page tant que ce n'est pas le cas, pour éviter le flash noir.
  const [firstFrameSource, setFirstFrameSource] = useState<string | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pastille de vitesse : index dans PLAYBACK_RATES, cyclé au tap.
  const [rateIndex, setRateIndex] = useState(0);
  // Flash « +10 s / −10 s » du double-tap latéral.
  const [skipFlash, setSkipFlash] = useState<{ dir: 1 | -1; key: number } | null>(null);
  const skipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Reprises automatiques déjà tentées sur cette source en erreur.
  const [autoRetries, setAutoRetries] = useState(0);

  // Le cache disque est activé sur la source (`useCaching`) : revenir sur une
  // vidéo déjà vue relit le cache local au lieu de re-télécharger. Le plafond de
  // ce cache est fixé par le pager (`setVideoCacheSizeAsync`).
  const source = url ? { uri: url, useCaching: true } : null;
  const player = useVideoPlayer(source, (instance) => {
    // Boucle native : la tête revient au début sans état « terminé ».
    instance.loop = true;
    instance.timeUpdateEventInterval = TIME_UPDATE_INTERVAL_S;
  });

  // Identité du lecteur : `expo-video` peut en recréer un (par exemple quand un
  // `replaceAsync` échoue). Dans ce cas la `VideoView` doit être **remontée** :
  // affecter la prop `player` d'une vue déjà montée lève
  // « The player has been notified of disconnection from the player view »
  // côté natif. On suit donc le lecteur pour changer la clé de la vue.
  const [viewEpoch, setViewEpoch] = useState(0);
  const [knownPlayer, setKnownPlayer] = useState(player);
  if (knownPlayer !== player) {
    setKnownPlayer(player);
    setViewEpoch(viewEpoch + 1);
  }

  // `status` sert de déclencheur de reprise : un lecteur recyclé peut être
  // encore `loading` au moment où sa page redevient active, et `play()` appelé
  // trop tôt est perdu. On relance donc aussi quand il devient `readyToPlay`.
  const { status, error } = useEvent(player, 'statusChange', { status: player.status });

  // `muted` et la cadence de progression sont des propriétés impératives de
  // l'API expo-video : la règle d'immutabilité du React Compiler ne s'applique
  // pas à un objet natif.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    const interval = scrubbing ? SCRUB_TIME_UPDATE_INTERVAL_S : TIME_UPDATE_INTERVAL_S;
    // eslint-disable-next-line react-hooks/immutability
    player.timeUpdateEventInterval = interval;
  }, [player, scrubbing]);

  // Vitesse de lecture : propriété impérative du lecteur natif.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    player.playbackRate = PLAYBACK_RATES[rateIndex];
  }, [player, rateIndex]);

  const cycleRate = useCallback(
    () => setRateIndex((index) => (index + 1) % PLAYBACK_RATES.length),
    [],
  );

  // Mémorise la position de lecture pour la reprise au retour sur la page.
  // `useEventListener` maintient le dernier listener : pas de closure périmée.
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (chrome.isActive) {
      // Plafond : la map survit à tout le fil, on n'en garde que les plus
      // récentes (itération dans l'ordre d'insertion de la Map).
      if (playbackPositions.size >= 200) {
        const oldest = playbackPositions.keys().next().value;
        if (oldest !== undefined) {
          playbackPositions.delete(oldest);
        }
      }
      playbackPositions.set(post.id, currentTime);
    }
  });

  // Au premier `readyToPlay`, reprend où la vidéo s'était arrêtée. Une seule
  // fois par lecteur : après le seek initial, les `statusChange` suivants ne
  // doivent pas ramener la tête en arrière.
  const resumedFor = useRef<VideoPlayer | null>(null);
  useEffect(() => {
    if (status !== 'readyToPlay' || resumedFor.current === player) {
      return;
    }
    resumedFor.current = player;
    const saved = playbackPositions.get(post.id) ?? 0;
    const duration = player.duration;
    const tooCloseToEnd =
      Number.isFinite(duration) && duration > 0 && saved > duration - 2;
    if (saved >= RESUME_MIN_SECONDS && !tooCloseToEnd) {
      seekExactly(player, saved);
    }
  }, [player, post.id, status]);

  // Devenir la page active réarme la lecture : une pause volontaire ne doit pas
  // survivre à la sortie de l'écran : dès que la page devient inactive, le
  // drapeau retombe. C'est fait pendant le rendu (pas dans un effet) parce que
  // la règle `set-state-in-effect` l'interdit et qu'on veut la valeur à jour
  // avant l'effet de lecture ci-dessous.
  if (!chrome.isActive && userPaused) {
    setUserPaused(false);
  }

  const failed = status === 'error';
  useEffect(() => {
    if (!chrome.isActive || userPaused || failed) {
      player.pause();
      return;
    }
    // `status` est dans les dépendances : un lecteur recyclé encore `loading`
    // ignore `play()` appelé trop tôt, il faut relancer quand il est prêt.
    player.play();
  }, [chrome.isActive, userPaused, failed, player, status]);

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
      // position pendant une frame. Le timer est mémorisé pour être annulé si la
      // page est démontée entre-temps (lecteur déjà libéré).
      if (resumeTimer.current) {
        clearTimeout(resumeTimer.current);
      }
      if (chrome.isActive && !userPaused) {
        resumeTimer.current = setTimeout(() => {
          resumeTimer.current = null;
          player.play();
        }, RESUME_AFTER_SEEK_MS);
      }
    },
    [chrome.isActive, player, userPaused],
  );

  useEffect(
    () => () => {
      if (resumeTimer.current) {
        clearTimeout(resumeTimer.current);
        resumeTimer.current = null;
      }
      if (skipTimer.current) {
        clearTimeout(skipTimer.current);
        skipTimer.current = null;
      }
    },
    [],
  );

  const retry = useCallback(() => {
    if (!url) {
      return;
    }
    setFirstFrameSource(null);
    setAutoRetries(0);
    void player.replaceAsync({ uri: url, useCaching: true }).catch(() => undefined);
  }, [player, url]);

  // Backoff automatique : une coupure réseau passagère ne doit pas imposer un
  // appui sur « Réessayer ». Les délais croissent, l'état d'erreur n'apparaît
  // qu'après épuisement — entre-temps le spinner de chargement reste visible.
  useEffect(() => {
    if (!failed || !url || autoRetries >= AUTO_RETRY_DELAYS_MS.length) {
      return;
    }
    const delay = AUTO_RETRY_DELAYS_MS[autoRetries];
    const timer = setTimeout(() => {
      setAutoRetries((count) => count + 1);
      setFirstFrameSource(null);
      void player.replaceAsync({ uri: url, useCaching: true }).catch(() => undefined);
    }, delay);
    return () => clearTimeout(timer);
  }, [failed, url, autoRetries, player]);

  const exhausted = failed && autoRetries >= AUTO_RETRY_DELAYS_MS.length;

  /**
   * Double-tap : le centre like, les bords sautent de ±10 s. La fraction
   * `DOUBLE_TAP_CENTER_RATIO` de chaque bord est la zone de seek ; sans point
   * mesurable (accessibilité), on like comme avant.
   */
  const handleDoubleTap = useCallback(
    (point: { x: number; y: number } | null) => {
      if (point && pageWidth > 0) {
        const edge = pageWidth * DOUBLE_TAP_CENTER_RATIO;
        if (point.x < edge || point.x > pageWidth - edge) {
          const dir = point.x < edge ? -1 : 1;
          const duration = player.duration;
          const current = player.currentTime;
          const target =
            Number.isFinite(duration) && duration > 0
              ? Math.min(Math.max(current + dir * DOUBLE_TAP_SKIP_SECONDS, 0), duration)
              : Math.max(current + dir * DOUBLE_TAP_SKIP_SECONDS, 0);
          seekExactly(player, target);
          void Haptics.selectionAsync().catch(() => undefined);
          setSkipFlash((flash) => ({ dir, key: (flash?.key ?? 0) + 1 }));
          if (skipTimer.current) {
            clearTimeout(skipTimer.current);
          }
          skipTimer.current = setTimeout(() => setSkipFlash(null), 700);
          return;
        }
      }
      onDoubleTapLike(point);
    },
    [onDoubleTapLike, pageWidth, player],
  );

  // Le poster reste affiché tant que la première image n'est pas décodée :
  // sans lui, chaque changement de vidéo laisserait voir un flash noir le
  // temps que le lecteur se prépare. Il sert aussi de repli pendant une erreur.
  const showPoster = posterUrl !== null && firstFrameSource !== url;

  return (
    <View style={[styles.page, { height: chrome.height }]}>
      <VideoView
        ref={viewRef}
        // Une clé par (publication, lecteur) : la vue native n'est jamais
        // réutilisée pour un autre lecteur.
        key={`${post.id}-${viewEpoch}`}
        player={player}
        style={styles.surface}
        fullscreenOptions={{ enable: true, orientation: 'default' }}
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
        onFirstFrameRender={() => setFirstFrameSource(url)}
      />

      {showPoster && posterUrl ? (
        <Image
          source={{ uri: posterUrl }}
          style={styles.surface}
          resizeMode="cover"
          pointerEvents="none"
        />
      ) : null}

      {exhausted || !url ? (
        <View style={styles.errorSurface}>
          <ThemedText style={styles.errorTitle}>
            {url ? fr.social.videoErrorTitle : fr.social.videoUnavailable}
          </ThemedText>
          {url ? (
            <>
              <ThemedText style={styles.errorBody}>{fr.social.videoErrorBody}</ThemedText>
              <Pressable
                onPress={retry}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={fr.social.videoRetry}
                style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
                <ThemedText style={styles.retryText}>{fr.social.videoRetry}</ThemedText>
              </Pressable>
            </>
          ) : null}
          {error?.message ? (
            <ThemedText style={styles.errorDetail} numberOfLines={2}>
              {error.message}
            </ThemedText>
          ) : null}
        </View>
      ) : (
        <FeedGestureLayer
          accessibilityLabel="Vidéo : deux taps pour réagir, un tap pour suspendre"
          onDoubleTap={handleDoubleTap}
          onTap={togglePlayback}
          onLongPressStart={pauseForLongPress}
          onLongPressEnd={resumeAfterLongPress}
        />
      )}

      {/* Spinner tant que le lecteur charge ou retente après une erreur :
          `status` repasse à `loading` pendant chaque `replaceAsync`. */}
      {status === 'loading' && chrome.isActive && !chrome.hideOverlays ? (
        <View pointerEvents="none" style={styles.buffering}>
          <ActivityIndicator size="large" color={FeedSurface.onMedia} />
        </View>
      ) : null}

      {/* Flash « +10 s / −10 s » du double-tap sur les bords. */}
      {skipFlash ? (
        <View key={skipFlash.key} pointerEvents="none" style={styles.skipFlash}>
          <ThemedText style={styles.skipFlashText}>
            {skipFlash.dir > 0 ? '» 10' : '« 10'}
          </ThemedText>
        </View>
      ) : null}

      <HeartBurstOverlay burstKey={chrome.burstKey} point={chrome.burstPoint} />

      {/* Contrôles masqués quand la feuille est ouverte,
          seul le média réduit reste visible au-dessus de la feuille. */}
      {!chrome.hideOverlays ? (
        <>
          {isPaused ? (
            <View pointerEvents="none" style={styles.playBadge}>
              <Icon icon={Play} size={34} color={FeedSurface.onMedia} fill={FeedSurface.onMedia} />
            </View>
          ) : null}

          {/* Contrôles supérieurs toujours visibles : vitesse, plein écran,
              son. Le son n'est plus réservé à la pause — il doit pouvoir se
              couper pendant la lecture, comme sur les fils vidéo courants. */}
          <View style={[styles.topRight, { top: insets.top + Spacing.six }]}>
            <Pressable
              onPress={cycleRate}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Vitesse de lecture : ${PLAYBACK_RATES[rateIndex]}×`}
              style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}>
              <ThemedText style={styles.rateText}>{PLAYBACK_RATES[rateIndex]}×</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => void viewRef.current?.enterFullscreen().catch(() => undefined)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Plein écran"
              style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}>
              <Icon icon={Expand} size={18} color={FeedSurface.onMedia} />
            </Pressable>
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

          <ProgressBar
            player={player}
            bottomInset={chrome.barInset}
            active={chrome.isActive && !failed}
            onSeekStart={handleSeekStart}
            onSeekEnd={handleSeekEnd}
            onScrubStateChange={onScrubStateChange}
          />
        </>
      ) : null}
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
  errorSurface: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.five,
  },
  errorTitle: {
    color: FeedSurface.onMedia,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorBody: {
    color: FeedSurface.onMediaSoft,
    textAlign: 'center',
  },
  errorDetail: {
    color: FeedSurface.onMediaFaint,
    fontSize: 11,
    textAlign: 'center',
  },
  retry: {
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radii.full,
    backgroundColor: FeedSurface.onMedia,
  },
  retryText: {
    color: '#000000',
    fontWeight: '700',
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
    flexDirection: 'row',
    gap: Spacing.two,
  },
  rateText: {
    color: FeedSurface.onMedia,
    fontSize: 12,
    fontWeight: '700',
  },
  buffering: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipFlash: {
    position: 'absolute',
    alignSelf: 'center',
    top: '40%',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  skipFlashText: {
    color: FeedSurface.onMedia,
    fontSize: 20,
    fontWeight: '800',
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
