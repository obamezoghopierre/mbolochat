import { useEventListener } from 'expo';
import type { VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { FeedMetrics, FeedSurface, Spacing } from '@/constants/theme';

import { usePlayerStatus } from './use-player-status';

/**
 * Tolérance de seek pendant le glissement, en secondes.
 *
 * Large à dessein (≈ 400 ms) : en reculant, le lecteur peut alors sauter au
 * keyframe précédent au lieu de décoder image par image, ce qui est la seule
 * façon de suivre le doigt en temps réel.
 */
const SCRUB_TOLERANCE_SECONDS = 0.4;

/**
 * Délai avant de considérer un seek de glissement terminé.
 *
 * expo-video n'expose pas de promesse de seek : ce délai sert de « fin » pour
 * libérer le verrou. Il est court pour que la cible la plus récente soit
 * envoyée très vite.
 */
const SEEK_SETTLE_MS = 55;

/** Durée d'amorti du trait quand la lecture avance normalement. */
const ADVANCE_DURATION_MS = 120;

/** Fenêtre pendant laquelle les `timeUpdate` sont ignorés après le relâchement. */
const RELEASE_IGNORE_MS = 150;

/** Largeur du segment de buffering, en fraction de la piste. */
const BUFFER_LOADER_RATIO = 0.3;
/** Durée d'un aller-retour du segment de buffering. */
const BUFFER_SWING_MS = 850;

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/**
 * Barre de progression du feed : fin trait blanc en bas de la
 * page, alimenté par `timeUpdate` du lecteur, scrubbable au doigt.
 *
 * Toute la géométrie (largeur, position du doigt, visibilité du minuteur) vit
 * dans des valeurs partagées Reanimated : un glissement ne provoque **aucun**
 * rendu React, ni de la page vidéo ni du feed.
 *
 * Politique de seek « dernier gagnant » : au plus un seek en vol. Tant qu'il
 * n'est pas terminé, les mouvements du doigt ne font que déplacer la cible
 * (valeur partagée) ; jamais d'empilement de seeks, donc pas de retard
 * cumulatif quand on recule.
 */
export function ProgressBar({
  player,
  bottomInset,
  active,
  buffering,
  onSeekStart,
  onSeekEnd,
  onScrubStateChange,
}: {
  player: VideoPlayer;
  /**
   * Distance au bord bas de l'écran : la ligne s'y plaque. Sur un fil immersif
   * elle se loge dans la bande vide sous les icônes de la barre d'onglets ;
   * sans inset système, elle reste au-dessus de la barre.
   */
  bottomInset: number;
  active: boolean;
  /** Rebuffering en cours : un segment animé occupe la piste. */
  buffering: boolean;
  /** Le doigt a commencé : la lecture doit se figer. */
  onSeekStart: () => void;
  /** Le doigt s'est levé : seek précis puis reprise éventuelle. */
  onSeekEnd: (seconds: number) => void;
  /** Prévient le pager qu'un glissement est en cours (scroll à figer). */
  onScrubStateChange: (scrubbing: boolean) => void;
}) {
  // Valeurs partagées : mises à jour sur le thread UI, jamais de re-render.
  const width = useSharedValue(0);
  /** Position du doigt, en ratio 0..1 — c'est aussi la cible de seek. */
  const position = useSharedValue(0);
  /** Vrai pendant tout le geste : pilote le minuteur et l'épaisseur du trait. */
  const isScrubbing = useSharedValue(false);
  /** Vrai tant qu'un seek de glissement est en vol (verrou « dernier gagnant »). */
  const seekInFlight = useSharedValue(false);

  // Identifiant du délai qui libère le verrou de seek. Stocké dans une closure
  // `useMemo` : une ref serait refusée (les worklets du geste la traversent) et
  // le compilateur interdit de muter l'objet rendu par le hook.
  const timerBox = useMemo(() => {
    const box = { id: null as ReturnType<typeof setTimeout> | null };
    return {
      set(id: ReturnType<typeof setTimeout> | null) {
        box.id = id;
      },
      clear() {
        if (box.id !== null) {
          clearTimeout(box.id);
          box.id = null;
        }
      },
    };
  }, []);
  // Instant (ms) jusqu'auquel les `timeUpdate` sont ignorés après relâchement,
  // pour que le curseur ne revienne pas en arrière avant que le seek natif
  // n'ait pris effet. Valeur partagée plutôt que `useRef` : elle est lue depuis
  // les worklets du geste, et une ref y est refusée.
  const ignoreUntil = useSharedValue(0);
  /** Phase 0→1 du segment de buffering : pilote son va-et-vient sur la piste. */
  const bufferPhase = useSharedValue(0);
  const bufferOpacity = useSharedValue(0);

  // Le buffering s'anime sur la piste elle-même, sans re-render : le segment
  // blanc fait l'aller-retour comme sur les fils vidéo. Hors buffering, il
  // disparaît en douceur et la phase est réarmée pour le prochain épisode.
  useEffect(() => {
    if (buffering) {
      bufferOpacity.value = withTiming(1, { duration: 160 });
      bufferPhase.value = 0;
      bufferPhase.value = withRepeat(
        withTiming(1, { duration: BUFFER_SWING_MS }),
        -1,
        true,
      );
    } else {
      cancelAnimation(bufferPhase);
      bufferPhase.value = 0;
      bufferOpacity.value = withTiming(0, { duration: 160 });
    }
    return () => cancelAnimation(bufferPhase);
  }, [buffering, bufferPhase, bufferOpacity]);

  const duration = player.duration ?? 0;
  const validDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;

  // `timeUpdate` est ingéré sans état React : à 4 Hz (20 Hz pendant un
  // glissement), un `setState` par tick re-rendait toute la page vidéo. La
  // progression vit donc dans une valeur partagée Reanimated, sur le thread UI.
  //
  // `statusChange` re-rend le composant — c'est là que `player.duration` devient
  // disponible — et `useEventListener` garde le dernier listener dans une ref :
  // la fermeture lit donc toujours `validDuration` à jour. Le hook rattrape la
  // transition initiale émise avant l'abonnement (sinon `validDuration` reste 0).
  usePlayerStatus(player);
  useEventListener(player, 'timeUpdate', ({ currentTime: at }) => {
    if (validDuration === 0) {
      return;
    }
    // Le doigt pilote la barre, ou un seek vient d'être relâché : on n'écrase pas.
    if (isScrubbing.value || Date.now() < ignoreUntil.value) {
      return;
    }
    const ratio = clamp01(at / validDuration);
    position.value = withTiming(ratio, { duration: ADVANCE_DURATION_MS });
  });

  const clearSettleTimer = useCallback(() => {
    timerBox.clear();
  }, [timerBox]);

  /**
   * Déclenche un seek tolérant vers la **cible courante** si aucun seek n'est
   * déjà en vol. Aucune file d'attente : la cible vient toujours de `position`,
   * donc seule la dernière valeur compte.
   */
  // Verrou « dernier gagnant ». Le relais après expiration vit dans une fonction
  // libre : une auto-référence dans un `useCallback` est refusée par le React
  // Compiler.
  const sendScrubSeek = useCallback(() => {
    pumpScrubSeek({
      player,
      position,
      seekInFlight,
      isScrubbing,
      validDuration,
      onTimerChange: (timer) => {
        if (timer !== null) {
          clearSettleTimer();
        }
        timerBox.set(timer);
      },
    });
    // Les valeurs partagées ne changent pas d'identité : inutile de les lister,
    // et les lister ferait refuser la mutation par le React Compiler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearSettleTimer, player, timerBox, validDuration]);

  const beginScrub = useCallback(() => {
    onSeekStart();
    onScrubStateChange(true);
  }, [onScrubStateChange, onSeekStart]);

  const finishScrub = useCallback(() => {
    clearSettleTimer();
    // Écritures de valeurs partagées isolées hors composant : le React Compiler
    // les refuse dans un callback du composant.
    releaseSeekLock({ seekInFlight, ignoreUntil, ignoreMs: RELEASE_IGNORE_MS });
    onScrubStateChange(false);
    // Un seul seek, précis, vers la position finale du doigt. Sans durée
    // connue (flux pas encore prêt), on ne cherche pas : viser 0 ramènerait
    // la lecture au début.
    if (validDuration > 0) {
      onSeekEnd(position.value * validDuration);
      void Haptics.selectionAsync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearSettleTimer, onScrubStateChange, onSeekEnd, validDuration]);

  // Nettoyage : un timer orphelin relancerait un seek sur une page recyclée.
  useEffect(() => () => clearSettleTimer(), [clearSettleTimer]);

  const pan = Gesture.Pan()
    // Inerte sur une page qui n'est plus active : une voisine encore montée
    // ne doit pas pouvoir être seekée par mégarde.
    .enabled(active)
    // Zone tactile large : le trait reste fin mais se vise facilement.
    .minDistance(0)
    .onBegin((event) => {
      /* Worklets Reanimated : les écritures de valeurs partagées y sont le
         motif officiel, la règle d'immutabilité du React Compiler ne
         s'applique pas à ce cas. */
      // eslint-disable-next-line react-hooks/immutability
      isScrubbing.value = true;
      // eslint-disable-next-line react-hooks/immutability
      position.value = clamp01(event.x / Math.max(1, width.value));
      runOnJS(beginScrub)();
      runOnJS(sendScrubSeek)();
    })
    .onUpdate((event) => {
      // Cible absolue, recalculée à chaque mouvement (aucun cumul).
      // eslint-disable-next-line react-hooks/immutability
      position.value = clamp01(event.x / Math.max(1, width.value));
      // Pas de seek si un autre est en vol : la cible sera reprise à sa fin.
      if (!seekInFlight.value) {
        runOnJS(sendScrubSeek)();
      }
    })
    .onEnd(() => {
      // eslint-disable-next-line react-hooks/immutability
      isScrubbing.value = false;
      runOnJS(finishScrub)();
    })
    .onFinalize(() => {
      // Geste annulé : on ne reste ni en glissement ni avec un minuteur affiché.
      if (isScrubbing.value) {
        // eslint-disable-next-line react-hooks/immutability
        isScrubbing.value = false;
        runOnJS(finishScrub)();
      }
    });

  const fillStyle = useAnimatedStyle(() => ({
    width: `${clamp01(position.value) * 100}%`,
  }));

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: clamp01(position.value) * width.value }],
    opacity: isScrubbing.value ? 1 : 0,
  }));

  const lineStyle = useAnimatedStyle(() => ({
    height: isScrubbing.value ? FeedMetrics.progressHeight * 2.5 : FeedMetrics.progressHeight,
  }));

  // Segment de buffering : large de BUFFER_LOADER_RATIO, il parcourt la
  // piste en ping-pong. Le dégagé maximal vaut largeur × (1 − ratio).
  const bufferStyle = useAnimatedStyle(() => ({
    opacity: bufferOpacity.value,
    transform: [
      {
        translateX:
          bufferPhase.value * width.value * (1 - BUFFER_LOADER_RATIO),
      },
    ],
  }));

  // Minuteur : visibilité et texte animés, aucun re-render pendant le geste.
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: isScrubbing.value ? 1 : 0,
  }));

  const timeProps = useAnimatedProps<TextInputProps>(() => {
    const seconds = clamp01(position.value) * validDuration;
    // `text` n'existe pas dans `TextInputProps` : Reanimated le traite comme
    // une prop native spéciale pour écrire le contenu depuis le thread UI.
    return { text: formatDuration(seconds) } as unknown as Partial<TextInputProps>;
  });

  return (
    <View
      style={[styles.track, { bottom: bottomInset }]}
      onLayout={(event) => {
        // `left`/`right` portent déjà les marges : la largeur mesurée est
        // exactement celle de la zone tactile, sans retrait supplémentaire.
        width.value = event.nativeEvent.layout.width;
      }}>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.gestureArea, !active && styles.hidden]}
          accessibilityRole="adjustable"
          accessibilityLabel="Position dans la vidéo">
          {/* Minuteur : masqué par opacité hors glissement, texte mis à jour
              directement par le thread UI via `useAnimatedProps`. */}
          <Animated.View style={[styles.timeBadge, badgeStyle]} pointerEvents="none">
            <AnimatedTextInput
              editable={false}
              caretHidden
              underlineColorAndroid="transparent"
              // Le texte est piloté par `animatedProps`, pas par une valeur.
              defaultValue="0:00"
              style={styles.timeText}
              animatedProps={timeProps}
            />
          </Animated.View>

          <Animated.View style={[styles.line, lineStyle]}>
            <Animated.View style={[styles.fill, fillStyle]} />
            <Animated.View style={[styles.bufferLoader, bufferStyle]} />
          </Animated.View>

          <Animated.View style={[styles.knob, knobStyle]} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * Envoie au plus un seek de glissement, puis se relance lui-même si le doigt a
 * continué à bouger.
 *
 * C'est le cœur de la politique « dernier gagnant » : il n'y a jamais de file
 * d'attente, seulement une cible (`position`) lue au moment où le verrou se
 * libère. Un recul rapide ne peut donc pas accumuler de retard.
 */
function pumpScrubSeek({
  player,
  position,
  seekInFlight,
  isScrubbing,
  validDuration,
  onTimerChange,
}: {
  player: VideoPlayer;
  position: { value: number };
  seekInFlight: { value: boolean };
  isScrubbing: { value: boolean };
  validDuration: number;
  onTimerChange: (timer: ReturnType<typeof setTimeout> | null) => void;
}) {
  if (validDuration === 0 || seekInFlight.value) {
    return;
  }
  seekInFlight.value = true;
  // Position absolue : ratio × durée, jamais un delta cumulé.
  seekTolerantly(player, position.value * validDuration, SCRUB_TOLERANCE_SECONDS);
  onTimerChange(
    setTimeout(() => {
      seekInFlight.value = false;
      onTimerChange(null);
      // Relance unique vers la cible la plus récente si le doigt bouge encore.
      if (isScrubbing.value) {
        pumpScrubSeek({ player, position, seekInFlight, isScrubbing, validDuration, onTimerChange });
      }
    }, SEEK_SETTLE_MS),
  );
}

/**
 * Libère le verrou de seek et démarre la fenêtre d'ignorance des `timeUpdate`.
 *
 * Le seek natif n'a pas encore pris effet au relâchement : sans cette fenêtre,
 * un `timeUpdate` retardataire ferait sauter le curseur en arrière.
 */
function releaseSeekLock({
  seekInFlight,
  ignoreUntil,
  ignoreMs,
}: {
  seekInFlight: { value: boolean };
  ignoreUntil: { value: number };
  ignoreMs: number;
}) {
  seekInFlight.value = false;
  ignoreUntil.value = Date.now() + ignoreMs;
}

/**
 * Seek tolérant, hors rendu.
 *
 * Isolé dans une fonction libre : `player` vient d'un hook, et le React
 * Compiler interdit de muter une telle valeur dans le composant.
 */
function seekTolerantly(player: VideoPlayer, seconds: number, tolerance: number) {
  player.seekTolerance = { toleranceBefore: tolerance, toleranceAfter: tolerance };
  player.currentTime = seconds;
}

function clamp01(value: number): number {
  'worklet';
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/** « 1:05 » à partir d'un nombre de secondes. Worklet : appelé sur le thread UI. */
function formatDuration(total: number): string {
  'worklet';
  const safe = Number.isFinite(total) ? Math.max(0, total) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  // Zone tactile généreuse mais visuellement fine.
  track: {
    // Bord à bord, comme la ligne des Reels d'Instagram.
    position: 'absolute',
    left: 0,
    right: 0,
    height: FeedMetrics.progressTrackHeight + Spacing.two,
    justifyContent: 'center',
  },
  gestureArea: {
    height: FeedMetrics.progressTrackHeight + Spacing.two,
    // La ligne épouse le bord bas de la zone tactile : elle touche presque la
    // barre du bas, comme la fine ligne des fils vidéo, au lieu de flotter
    // au milieu de sa zone de 24 px.
    justifyContent: 'flex-end',
    paddingBottom: 3,
  },
  line: {
    backgroundColor: 'rgba(255,255,255,0.36)',
    borderRadius: FeedMetrics.progressHeight,
    overflow: 'hidden',
    // Léger relief sombre : le trait reste lisible sur les images claires.
    boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
  },
  fill: {
    height: '100%',
    backgroundColor: FeedSurface.onMedia,
  },
  // Segment de buffering : posé dans la piste (débordement masqué), il
  // remplace visuellement la progression pendant le rebuffering.
  bufferLoader: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: `${BUFFER_LOADER_RATIO * 100}%`,
    backgroundColor: FeedSurface.onMedia,
    borderRadius: FeedMetrics.progressHeight,
  },
  // Curseur posé au bout de la partie remplie, centré verticalement.
  knob: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: FeedSurface.onMedia,
    marginLeft: -6,
    alignSelf: 'center',
    left: 0,
  },
  timeBadge: {
    position: 'absolute',
    top: -16,
    alignSelf: 'center',
    paddingHorizontal: Spacing.two,
    borderRadius: FeedMetrics.progressHeight,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  timeText: {
    color: FeedSurface.onMedia,
    fontSize: 11,
    padding: 0,
    fontVariant: ['tabular-nums'],
  },
  hidden: {
    opacity: 0.4,
  },
});
