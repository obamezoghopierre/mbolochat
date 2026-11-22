import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Lock, Mic, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { WaveTrack } from '@/components/voice-recorder';
import { FeedSurface, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { formatDuration, type VoiceTake } from '@/lib/voice';

/** Un commentaire vocal reste court : arrêt et envoi automatiques à 60 s. */
const MAX_MS = 60_000;
/** En dessous, l'appui est un tap : on rappelle le geste au lieu d'envoyer. */
const MIN_MS = 600;
/** Glisser à gauche de cette distance annule (poubelle). */
const CANCEL_DX = -110;
/** Glisser vers le haut de cette distance verrouille (mains libres). */
const LOCK_DY = -90;
const RECORDING_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };
const RECORD_RED = '#E5484D';

export interface HoldToRecordProps {
  /** Le doigt a été relâché (ou « Envoyer » en mode verrouillé) : le take part. */
  onSend: (take: VoiceTake) => void;
  /** L'enregistrement démarre / s'arrête : la saisie se masque derrière. */
  onActiveChange: (active: boolean) => void;
  /** Appui trop court : petit rappel « Maintiens pour enregistrer ». */
  onHint?: () => void;
  disabled?: boolean;
}

/**
 * Bouton micro « maintenir pour parler », comme Snapchat :
 *
 * - **appuyer et maintenir** : l'enregistrement démarre (vibration), le bouton
 *   grossit, devient rouge et pulse au rythme de la voix ; une bande s'ouvre
 *   avec le chrono et l'onde ;
 * - **relâcher** : le vocal part aussitôt ;
 * - **glisser à gauche** : annulé (vibration d'alerte) ;
 * - **glisser vers le haut** jusqu'au cadenas : verrouillé, on lâche et on
 *   parle mains libres, puis « Envoyer » ou la poubelle.
 *
 * Seul fichier (avec les autres enregistreurs) à importer `expo-audio` pour la
 * capture : il n'est chargé qu'après vérification du module natif.
 */
export function HoldToRecordButton({ onSend, onActiveChange, onHint, disabled }: HoldToRecordProps) {
  const theme = useTheme();
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const [active, setActive] = useState(false);
  const [locked, setLocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [armedCancel, setArmedCancel] = useState(false);

  const startedAt = useRef(0);
  const running = useRef(false);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const callbacks = useRef({ onSend, onActiveChange, onHint });
  useEffect(() => {
    callbacks.current = { onSend, onActiveChange, onHint };
  }, [onSend, onActiveChange, onHint]);

  // Valeurs d'animation (thread UI).
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const press = useSharedValue(0);
  const level = useSharedValue(0);
  const pulse = useSharedValue(0);

  const stopTicker = () => {
    if (tick.current) {
      clearInterval(tick.current);
      tick.current = null;
    }
  };

  const reset = useCallback(() => {
    stopTicker();
    running.current = false;
    setActive(false);
    setLocked(false);
    setElapsed(0);
    setArmedCancel(false);
    dx.value = withSpring(0);
    dy.value = withSpring(0);
    press.value = withTiming(0, { duration: 160 });
    cancelAnimation(pulse);
    pulse.value = 0;
    level.value = 0;
    callbacks.current.onActiveChange(false);
    void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  }, [dx, dy, level, press, pulse]);

  const finish = useCallback(
    async (send: boolean) => {
      if (!running.current) {
        return;
      }
      const duration = Date.now() - startedAt.current;
      let uri: string | null = null;
      try {
        await recorder.stop();
        uri = recorder.uri;
      } catch {
        uri = null;
      }
      reset();
      if (!send) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
          () => undefined,
        );
        return;
      }
      if (!uri || duration < MIN_MS) {
        callbacks.current.onHint?.();
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      callbacks.current.onSend({ uri, durationMs: duration, mime: 'audio/mp4' });
    },
    [recorder, reset],
  );

  const start = useCallback(async () => {
    if (running.current || disabled) {
      return;
    }
    running.current = true;
    startedAt.current = Date.now();
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted || !running.current) {
        reset();
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!running.current) {
        return;
      }
      recorder.record();
    } catch {
      reset();
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    startedAt.current = Date.now();
    setActive(true);
    callbacks.current.onActiveChange(true);
    press.value = withSpring(1, { damping: 14, stiffness: 220 });
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
    tick.current = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      try {
        const metering = recorder.getStatus().metering;
        const next =
          metering === undefined || !Number.isFinite(metering)
            ? 0
            : Math.min(1, Math.max(0, (metering + 50) / 50));
        level.value = withTiming(next, { duration: 90 });
      } catch {
        // Statut indisponible un instant : on garde le dernier niveau.
      }
      if (ms >= MAX_MS) {
        void finish(true);
      }
    }, 90);
  }, [disabled, finish, level, press, pulse, recorder, reset]);

  // Sortie d'écran pendant une capture : on jette, jamais d'envoi fantôme.
  useEffect(
    () => () => {
      stopTicker();
      if (running.current) {
        running.current = false;
        void recorder.stop().catch(() => undefined);
        void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      }
    },
    [recorder],
  );

  const lockNow = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    setLocked(true);
    dx.value = withSpring(0);
    dy.value = withSpring(0);
  }, [dx, dy]);

  const gesture = Gesture.Pan()
    .enabled(!disabled && !locked)
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .onBegin(() => {
      runOnJS(start)();
    })
    .onUpdate((event) => {
      dx.value = Math.min(0, event.translationX);
      dy.value = Math.min(0, event.translationY);
      runOnJS(setArmedCancel)(event.translationX < CANCEL_DX);
      if (event.translationY < LOCK_DY) {
        runOnJS(lockNow)();
      }
    })
    .onFinalize((event) => {
      if (event.translationY < LOCK_DY) {
        return; // Verrouillé : on continue sans le doigt.
      }
      runOnJS(finish)(event.translationX >= CANCEL_DX);
    });

  // Bouton : grossit à l'appui, suit le doigt, pulse avec la voix.
  const buttonStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dx.value },
      { translateY: dy.value },
      { scale: interpolate(press.value, [0, 1], [1, 1.9]) * (1 + level.value * 0.18) },
    ],
  }));
  // Halo qui s'ouvre en boucle, plus fort quand on parle (effet Snapchat).
  const haloStyle = useAnimatedStyle(() => ({
    opacity: press.value * (0.45 - pulse.value * 0.45) * (0.6 + level.value * 0.4),
    transform: [{ scale: 1 + pulse.value * (0.9 + level.value * 0.8) }],
  }));
  // Anneau qui suit le volume de la voix en continu.
  const levelRingStyle = useAnimatedStyle(() => ({
    opacity: press.value * 0.3,
    transform: [{ scale: 1.15 + level.value * 0.6 }],
  }));
  const lockStyle = useAnimatedStyle(() => ({
    opacity: press.value,
    transform: [
      { translateY: interpolate(dy.value, [LOCK_DY, 0], [-10, 0], 'clamp') },
      { scale: interpolate(dy.value, [LOCK_DY, 0], [1.25, 1], 'clamp') },
    ],
  }));

  const remaining = Math.max(0, MAX_MS - elapsed);

  return (
    <>
      {active ? (
        /* Bande d'enregistrement : recouvre la saisie pendant la capture. */
        <View
          pointerEvents={locked ? 'box-none' : 'none'}
          style={[styles.strip, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.dot} />
          <ThemedText style={[styles.timer, remaining < 10_000 && { color: RECORD_RED }]}>
            {formatDuration(elapsed)}
          </ThemedText>
          <View style={styles.wave}>
            <WaveTrack recorder={recorder} paused={false} />
          </View>
          {locked ? (
            <View style={styles.lockedActions}>
              <Pressable
                onPress={() => void finish(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={fr.social.voiceDiscard}
                style={styles.lockedButton}>
                <Trash2 size={20} color={theme.danger} />
              </Pressable>
              <Pressable
                onPress={() => void finish(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={fr.social.voiceSend}
                style={[styles.sendPill, { backgroundColor: FeedSurface.follow }]}>
                <ThemedText style={styles.sendText}>{fr.social.voiceSend}</ThemedText>
              </Pressable>
            </View>
          ) : (
            <ThemedText
              type="caption"
              numberOfLines={1}
              style={[styles.hint, { color: armedCancel ? theme.danger : theme.textSecondary }]}>
              {armedCancel ? fr.social.voiceReleaseToCancel : fr.social.voiceSlideToCancel}
            </ThemedText>
          )}
        </View>
      ) : null}

      <View style={styles.anchor}>
        {active && !locked ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.lockBubble,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
              lockStyle,
            ]}>
            <Lock size={16} color={theme.text} />
          </Animated.View>
        ) : null}
        {locked ? null : (
          <GestureDetector gesture={gesture}>
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel={fr.social.voiceHoldA11y}
              hitSlop={10}
              style={styles.touch}>
              <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />
              <Animated.View pointerEvents="none" style={[styles.halo, levelRingStyle]} />
              <Animated.View
                style={[
                  styles.button,
                  { backgroundColor: active ? RECORD_RED : 'transparent' },
                  buttonStyle,
                ]}>
                <Mic size={active ? 16 : 22} color={active ? '#FFFFFF' : theme.text} />
              </Animated.View>
            </View>
          </GestureDetector>
        )}
      </View>
    </>
  );
}

const BUTTON = 36;

const styles = StyleSheet.create({
  anchor: { width: BUTTON, height: BUTTON, alignItems: 'center', justifyContent: 'center' },
  touch: { width: BUTTON, height: BUTTON, alignItems: 'center', justifyContent: 'center' },
  button: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    backgroundColor: RECORD_RED,
  },
  lockBubble: {
    position: 'absolute',
    bottom: BUTTON + 34,
    width: 36,
    height: 52,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Posée sur toute la rangée de saisie (parent en `position: relative`).
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: BUTTON + Spacing.four,
    borderRadius: Radii.full,
    zIndex: 1,
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: RECORD_RED },
  timer: { fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 40 },
  wave: { flex: 1, minWidth: 40 },
  hint: { maxWidth: 140 },
  lockedActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  lockedButton: { padding: Spacing.one },
  sendPill: {
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
  sendText: { color: '#000000', fontWeight: '700' },
});
