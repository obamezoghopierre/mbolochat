/* eslint-disable react-hooks/refs -- les refs ne sont lues que par les callbacks du geste */
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { lockSwipe, unlockSwipe } from '@/lib/swipe-lock';
import { toWaveform } from './useVoiceRecorder';
import {
  voiceBarCount as layoutBarCount,
  voiceBubbleLayoutWidth as layoutBubbleWidth,
  voiceTrailingWidth as layoutTrailingWidth,
  type VoiceLayoutMetrics,
} from './voiceBubbleLayout';
import {
  pauseOrResumeVoicePlayback,
  seekVoicePlayback,
  setVoicePlaybackSpeed,
  startVoicePlayback,
  useVoicePlayback,
} from './voicePlayback';
import { nextVoiceSpeed, DEFAULT_VOICE_SPEED, type VoiceSpeed } from './voiceSpeed';
import { ChatBubble } from '@/features/chat/ui/chat-bubble';
import { ChatMetrics, useChatColors } from '@/constants/chat-theme';
import { Radii, Spacing, Type } from '@/constants/theme';
import { fr } from '@/i18n/fr';

type Props = {
  /** Identifiant UNIQUE du message (sert à savoir quelle note est en lecture). */
  id: string;
  /** URL distante (Storage, R2…) ou URI locale. */
  uri: string;
  durationMs: number;
  /** Valeurs 0..1 enregistrées avec le message ; sinon une forme générique est affichée. */
  waveform?: number[];
  isMine: boolean;
  /** Point rouge sur les vocaux reçus pas encore écoutés. */
  unplayed?: boolean;
  /** Appelée une seule fois à la première lecture : à persister côté backend. */
  onFirstPlay?: (id: string) => void;
  /** Couleur de l'icône, de la durée et des barres actives. */
  foregroundColor?: string;
  barOffColor?: string;
  barOnColor?: string;
  /** Bouton de vitesse dans la bulle : 1x → 1,5x → 2x, mémorisé. */
  speedControl?: boolean;
  /** Vitesse contrôlée par l'appelant (note chiffrée : le choix survit au
   *  déchiffrement). Sans ces props, la bulle garde sa propre vitesse. */
  speed?: VoiceSpeed;
  onSpeedChange?: (next: VoiceSpeed) => void;
  /** Bouton « Aa » : la transcription n'existe que pour les notes reçues
   *  dont le moteur local est disponible et le clair déjà déchiffré. */
  transcribable?: boolean;
  /** Produit le texte transcrit (cache puis moteur) ; `null` si indisponible. */
  onTranscribe?: () => Promise<string | null>;
  /** Heure et accusé, posés **dans** la bulle comme sur les bulles de texte. */
  footer?: ReactNode;
  /** Queue de bulle : masquée au milieu d'une suite. */
  tail?: boolean;
  style?: StyleProp<ViewStyle>;
};

function formatTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Métriques du design system transmises à la géométrie pure de la bulle. */
const LAYOUT_METRICS: VoiceLayoutMetrics = {
  bubblePaddingH: ChatMetrics.bubblePaddingH,
  playSize: ChatMetrics.voicePlaySize,
  controlWidth: ChatMetrics.voiceControlWidth,
  controlGap: ChatMetrics.voiceControlGap,
  chipGap: ChatMetrics.voiceChipGap,
  durationMinWidth: ChatMetrics.voiceDurationMinWidth,
  barWidth: ChatMetrics.voiceBarWidth,
  barGap: ChatMetrics.voiceBarGap,
};

/** Largeur de la bulle vocale : proportionnelle à la durée, sans écraser l'onde. */
export function voiceBubbleWidth(
  durationMs: number,
  screenW: number,
  speedControl = true,
  transcribable = false,
): number {
  return layoutBubbleWidth(
    LAYOUT_METRICS,
    durationMs,
    screenW,
    speedControl,
    transcribable,
  );
}

/** Forme d'onde de secours, stable pour un même id. */
function fallbackWaveform(id: string, bars: number): number[] {
  let seed = 0;
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
  return Array.from({ length: bars }, (_, i) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed % 1000) / 1000;
    return 0.25 + 0.6 * Math.abs(Math.sin(i * 0.55)) * (0.5 + 0.5 * noise);
  });
}

function VoiceMessageBubbleBase({
  id,
  uri,
  durationMs,
  waveform,
  isMine,
  unplayed,
  onFirstPlay,
  foregroundColor,
  barOffColor,
  barOnColor,
  speedControl = false,
  speed: controlledSpeed,
  onSpeedChange,
  transcribable = false,
  onTranscribe,
  footer,
  tail = true,
  style,
}: Props) {
  const { width: screenW } = useWindowDimensions();
  const chat = useChatColors();
  const playback = useVoicePlayback(id);
  // Vitesse propre à CETTE bulle : changer « 1x » ici ne touche aucun autre
  // message, et la pastille affiche toujours ce que jouera ce message.
  const [ownSpeed, setOwnSpeed] = useState<VoiceSpeed>(DEFAULT_VOICE_SPEED);
  const speed = controlledSpeed ?? ownSpeed;
  const [scrub, setScrub] = useState<number | null>(null);
  const track = useRef({ x: 0, width: 1 });
  // Transcript : `null` = masqué, chaîne = affiché sous l'onde.
  const [transcript, setTranscript] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);

  // Largeur proportionnelle à la durée, mais jamais plus étroite que la ligne
  // lecture + onde + durée + vitesse.
  const width = voiceBubbleWidth(durationMs, screenW, speedControl, transcribable);

  const trailing = layoutTrailingWidth(LAYOUT_METRICS, speedControl, transcribable);
  const barCount = layoutBarCount(LAYOUT_METRICS, width, trailing);
  const bars = useMemo(
    () =>
      toWaveform(
        waveform && waveform.length > 0 ? waveform : fallbackWaveform(id, barCount),
        barCount,
      ),
    [waveform, id, barCount],
  );

  const total = playback.durationMs > 0 ? playback.durationMs : durationMs;
  const progress = playback.id === id && total > 0 ? Math.min(1, playback.positionMs / total) : 0;
  const shownProgress = scrub ?? progress;
  const active = playback.id === id;
  const label =
    scrub !== null
      ? formatTime(scrub * total)
      : active && playback.playing
        ? formatTime(total - playback.positionMs)
        : formatTime(durationMs);

  const onPress = useCallback(async () => {
    try {
      // La vitesse de CETTE bulle : pause/reprise si c'est déjà la note active,
      // sinon elle est chargée puis jouée à la vitesse choisie ici.
      if (playback.id === id) {
        pauseOrResumeVoicePlayback(id);
        return;
      }
      await startVoicePlayback(id, uri, durationMs, { speedControl, speed });
      if (unplayed) onFirstPlay?.(id);
    } catch (e) {
      console.warn('[VoiceMessageBubble] lecture impossible', e);
    }
  }, [id, uri, durationMs, unplayed, onFirstPlay, speedControl, speed, playback.id]);

  /** Pastille de vitesse : met à jour la bulle, puis le lecteur si c'est SA note. */
  const changeSpeed = useCallback(
    (next: VoiceSpeed) => {
      if (onSpeedChange) onSpeedChange(next);
      else setOwnSpeed(next);
      // `id` garantit que seule la note de cette bulle reçoit la vitesse ;
      // une bulle non active la transmettra à son chargement.
      setVoicePlaybackSpeed(next, id);
    },
    [id, onSpeedChange],
  );

  const toggleTranscript = useCallback(async () => {
    if (transcript !== null) {
      setTranscript(null);
      return;
    }
    if (!onTranscribe || transcribing) return;
    setTranscribing(true);
    try {
      setTranscript((await onTranscribe()) ?? fr.chat.voiceTranscript.unavailable);
    } catch {
      setTranscript(fr.chat.voiceTranscript.unavailable);
    } finally {
      setTranscribing(false);
    }
  }, [transcript, onTranscribe, transcribing]);

  const ratioFromX = useCallback(
    (x: number) => Math.min(1, Math.max(0, (x - track.current.x) / Math.max(1, track.current.width))),
    [],
  );

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .onBegin(() => lockSwipe()) // le swipe de réponse ne doit pas voler le scrubbing
      .activeOffsetX([-6, 6]) // s'active seulement sur un mouvement horizontal
      .failOffsetY([-14, 14]) // laisse le scroll vertical de la liste gagner
      .onStart((e) => setScrub(ratioFromX(e.x)))
      .onUpdate((e) => setScrub(ratioFromX(e.x)))
      .onEnd((e, success) => {
        if (!success) return;
        const ratio = ratioFromX(e.x);
        // On garde le temps du doigt affiché tant que le lecteur n'est pas prêt :
        // le seek attend le chargement pour ne pas être ignoré.
        setScrub(ratio);
        void seekVoicePlayback(id, uri, durationMs, ratio, { speedControl, speed })
          .catch(() => undefined)
          .finally(() => setScrub(null));
      })
      .onFinalize((_e, success) => {
        unlockSwipe();
        if (!success) setScrub(null);
      });

    return pan;
  }, [id, uri, durationMs, ratioFromX, speedControl, speed]);

  useEffect(() => () => unlockSwipe(), []);

  const ink = foregroundColor ?? chat.voiceBubbleText;
  const barOff = barOffColor ?? chat.voiceBarInactive;
  const barOn = barOnColor ?? chat.voiceBarOn;
  const playing = active && playback.playing;

  return (
    <View style={[styles.row, isMine ? styles.rowMine : styles.rowOther, style]}>
      <View style={styles.bubbleWrap}>
        {/* Même chrome que les bulles de texte : rayon, encoche et queue identiques. */}
        <ChatBubble mine={isMine} style={{ width }} tail={tail}>
          <GestureDetector gesture={gesture}>
            <View style={styles.contentRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  playing ? fr.voicePlayback.pause : fr.voicePlayback.play(formatTime(durationMs))
                }
                hitSlop={8}
                onPress={() => void onPress()}
                style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}>
                <Ionicons
                  name={playing ? 'pause' : 'play'}
                  size={ChatMetrics.voicePlayIconSize}
                  color={ink}
                />
              </Pressable>
              <View
                style={styles.waveform}
                onLayout={(e) => {
                  track.current = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
                }}>
                {bars.map((v, i) => (
                  <View
                    key={i}
                    style={[
                      styles.bar,
                      {
                        height: Math.round(
                          ChatMetrics.voiceBarMinHeight +
                            v * (ChatMetrics.voiceBarMaxHeight - ChatMetrics.voiceBarMinHeight),
                        ),
                        backgroundColor:
                          (i + 0.5) / bars.length <= shownProgress ? barOn : barOff,
                      },
                    ]}
                  />
                ))}
              </View>
              {transcribable ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    transcript !== null
                      ? fr.chat.voiceTranscript.hide
                      : fr.chat.voiceTranscript.action
                  }
                  hitSlop={6}
                  onPress={() => void toggleTranscript()}
                  style={({ pressed }) => [
                    styles.chip,
                    { backgroundColor: chat.voiceChipBackground },
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.chipText, { color: ink }]}>Aa</Text>
                </Pressable>
              ) : null}
              {/* Durée et vitesse forment un seul bloc, collé au bord droit. */}
              <View style={styles.cluster}>
                <Text
                  numberOfLines={1}
                  style={[styles.duration, { color: ink }]}>
                  {label}
                </Text>
                {speedControl ? (
                  <VoiceSpeedChip
                    ink={ink}
                    background={chat.voiceChipBackground}
                    speed={speed}
                    onPress={changeSpeed}
                  />
                ) : null}
              </View>
            </View>
          </GestureDetector>
          {transcribing || transcript !== null ? (
            <Text style={[styles.transcript, { color: ink }]} numberOfLines={8}>
              {transcribing ? fr.chat.voiceTranscript.running : transcript}
            </Text>
          ) : null}
          {footer}
        </ChatBubble>
        {/* Hors du GestureDetector : le détecteur de glissement ne doit pas
            intercepter le tap de la pastille de vitesse. */}
        {!isMine && unplayed ? <View style={styles.unplayedDot} /> : null}
      </View>
    </View>
  );
}

export const VoiceMessageBubble = memo(VoiceMessageBubbleBase);

/**
 * Pastille de vitesse, purement présentative : l'état vit dans la bulle qui
 * possède la note, ce qui garantit qu'un message n'influence pas les autres.
 */
export function VoiceSpeedChip({
  ink,
  background,
  speed,
  onPress,
}: {
  ink: string;
  background: string;
  speed: VoiceSpeed;
  onPress: (next: VoiceSpeed) => void;
}) {
  const label = fr.voicePlayback.speedValue(speed);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fr.voicePlayback.speedAccessibilityLabel(label)}
      onPress={() => onPress(nextVoiceSpeed(speed))}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: background },
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.chipText, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginTop: ChatMetrics.voiceTopMargin },
  rowMine: { alignSelf: 'flex-end' },
  rowOther: { alignSelf: 'flex-start' },
  /** La bulle et son point « non écouté » ; les taps internes restent indépendants du geste. */
  bubbleWrap: { flexDirection: 'row', alignItems: 'center' },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ChatMetrics.voiceControlGap,
    height: ChatMetrics.voiceControlHeight,
  },
  pressed: { opacity: 0.75 },
  playButton: {
    width: ChatMetrics.voicePlaySize,
    height: ChatMetrics.voiceControlHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: ChatMetrics.voiceControlHeight,
    gap: ChatMetrics.voiceBarGap,
  },
  bar: {
    width: ChatMetrics.voiceBarWidth,
    borderRadius: Radii.full,
  },
  cluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ChatMetrics.voiceChipGap,
    height: ChatMetrics.voiceControlHeight,
  },
  duration: {
    width: ChatMetrics.voiceDurationMinWidth,
    textAlign: 'right',
    includeFontPadding: false,
    ...Type.micro,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  chip: {
    width: ChatMetrics.voiceControlWidth,
    height: ChatMetrics.voiceChipHeight,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    includeFontPadding: false,
    ...Type.micro,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  transcript: { ...Type.caption, flexShrink: 1 },
  unplayedDot: { width: Spacing.two, height: Spacing.two, borderRadius: Radii.full, backgroundColor: '#FA5151', marginLeft: 6 },
});
