import {
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from 'expo-audio';
import { Check, Pause, Play, RotateCcw, Square, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { accentColor } from '@/components/ui';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration, type VoiceTake } from '@/lib/voice';
import { WaveTrack } from '@/components/voice-recorder';

/** Au-delà, l'enregistrement s'arrête seul : un commentaire vocal reste court. */
const MAX_SECONDS = 120;
const RECORDING_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };
const SEEK_BAR_HEIGHT = 4;

export interface CommentVoiceRecorderProps {
  /** Prend validé après écoute : le take part vers l'upload. */
  onFinished: (take: VoiceTake) => void;
  onCancel: () => void;
}

/**
 * Enregistreur de commentaire vocal, façon TikTok :
 * enregistrement avec pause/reprise, puis aperçu où l'on peut écouter,
 * avancer/reculer au doigt et republier ou recommencer.
 *
 * Comme `voice-recorder`, ce fichier est le seul à importer `expo-audio` pour
 * l'enregistrement et n'est chargé qu'après vérification de la capacité.
 */
export function CommentVoiceRecorder({ onFinished, onCancel }: CommentVoiceRecorderProps) {
  const [phase, setPhase] = useState<'record' | 'preview'>('record');
  const [take, setTake] = useState<{ uri: string; durationMs: number } | null>(null);
  const [attempt, setAttempt] = useState(0);

  if (phase === 'record') {
    return (
      <RecordPhase
        key={attempt}
        onDone={(done) => {
          setTake(done);
          setPhase('preview');
        }}
        onCancel={onCancel}
      />
    );
  }
  if (!take) {
    return null;
  }
  return (
    <PreviewPhase
      take={take}
      onSend={() => onFinished({ ...take, mime: 'audio/mp4' })}
      onReRecord={() => {
        setTake(null);
        setPhase('record');
        setAttempt((value) => value + 1);
      }}
      onCancel={onCancel}
    />
  );
}

/** Phase 1 : capture avec chrono, pause/reprise et bouton d'arrêt. */
function RecordPhase({
  onDone,
  onCancel,
}: {
  onDone: (take: { uri: string; durationMs: number }) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  // `stop()` remet la position à zéro : la durée se lit pendant la capture.
  const longestRef = useRef(0);
  const finishedRef = useRef(false);
  const onCancelRef = useRef(onCancel);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onCancelRef.current = onCancel;
    onDoneRef.current = onDone;
  }, [onCancel, onDone]);

  /** Arrêt propre : la durée est capturée AVANT `stop()` qui la remet à zéro. */
  const finish = useCallback(async (): Promise<void> => {
    if (finishedRef.current) {
      return;
    }
    finishedRef.current = true;
    let durationMs = Math.round(longestRef.current * 1000);
    let uri: string | null = null;
    try {
      durationMs = Math.round(Math.max(longestRef.current, recorder.currentTime) * 1000);
      await recorder.stop();
      uri = recorder.uri;
    } catch {
      onCancelRef.current();
      return;
    }
    if (!uri || durationMs < 500) {
      onCancelRef.current();
      return;
    }
    onDoneRef.current({ uri, durationMs });
  }, [recorder]);

  useEffect(() => {
    void (async () => {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!finishedRef.current) {
        recorder.record();
      }
    })().catch(() => onCancelRef.current());
    const tick = setInterval(() => {
      let current = 0;
      try {
        current = recorder.currentTime;
      } catch {
        current = 0;
      }
      if (current > longestRef.current) {
        longestRef.current = current;
      }
      setSeconds(Math.round(longestRef.current));
      if (longestRef.current >= MAX_SECONDS) {
        void finish();
      }
    }, 400);
    return () => {
      clearInterval(tick);
      if (!finishedRef.current) {
        void recorder.stop().catch(() => undefined);
      }
      void setAudioModeAsync({ allowsRecording: false });
    };
  }, [finish, recorder]);

  const togglePause = useCallback(() => {
    try {
      if (paused) {
        recorder.record();
        setPaused(false);
      } else {
        recorder.pause();
        setPaused(true);
      }
    } catch {
      // Le micro a pu être coupé par le système : on reste en pause.
    }
  }, [paused, recorder]);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onCancel}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Annuler l'enregistrement"
        style={styles.sideButton}>
        <X size={22} color={theme.text} />
      </Pressable>
      <View
        style={[styles.recordingDot, paused ? styles.pausedDot : null]}
        accessibilityElementsHidden
      />
      <ThemedText style={styles.timer}>{formatDuration(seconds * 1000)}</ThemedText>
      {/* Piste animée au niveau du micro, partagée avec le magnétophone chat. */}
      <WaveTrack recorder={recorder} paused={paused} />
      <Pressable
        onPress={togglePause}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={paused ? 'Reprendre l’enregistrement' : 'Mettre en pause'}
        style={styles.sideButton}>
        {paused ? (
          <Play size={22} color={theme.text} fill={theme.text} />
        ) : (
          <Pause size={22} color={theme.text} fill={theme.text} />
        )}
      </Pressable>
      <Pressable
        onPress={() => void finish()}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Terminer et écouter"
        style={[styles.stopButton, { backgroundColor: theme.text }]}>
        <Square size={14} color={theme.background} fill={theme.background} />
      </Pressable>
    </View>
  );
}

/** Phase 2 : aperçu — lecture, scrub au doigt, ré-enregistrer ou envoyer. */
function PreviewPhase({
  take,
  onSend,
  onReRecord,
  onCancel,
}: {
  take: { uri: string; durationMs: number };
  onSend: () => void;
  onReRecord: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const player = useAudioPlayer(take.uri);
  const status = useAudioPlayerStatus(player);
  const [scrub, setScrub] = useState<number | null>(null);
  const widthRef = useRef(0);
  // `status.duration` se rafraîchit avec le statut du player ; le take connu
  // sert de repli avant que le flux ne soit analysé.
  const total = status.duration > 0 ? status.duration : take.durationMs / 1000;
  const position = status.currentTime;
  const fraction = total > 0 ? Math.min(1, (scrub ?? position) / total) : 0;

  const seekTo = useCallback(
    (value: number) => {
      if (total <= 0) {
        return;
      }
      void player.seekTo(value);
    },
    [player, total],
  );

  // Scrub : le doigt fait défiler la position ; le seek n'est envoyé qu'au
  // relâchement pour ne pas spammer le lecteur.
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    widthRef.current = event.nativeEvent.layout.width;
  }, []);

  const fractionAt = (x: number): number => {
    const width = widthRef.current;
    return width > 0 ? Math.max(0, Math.min(1, x / width)) : 0;
  };

  const onGrant = useCallback(
    (event: GestureResponderEvent) => {
      player.pause();
      setScrub(fractionAt(event.nativeEvent.locationX) * total);
    },
    [player, total],
  );

  const onMove = useCallback(
    (event: GestureResponderEvent) => {
      setScrub(fractionAt(event.nativeEvent.locationX) * total);
    },
    [total],
  );

  const onRelease = useCallback(
    (event: GestureResponderEvent) => {
      const value = fractionAt(event.nativeEvent.locationX) * total;
      setScrub(null);
      seekTo(value);
    },
    [seekTo, total],
  );

  const togglePlay = useCallback(() => {
    if (status.playing) {
      player.pause();
    } else {
      // Repart de la fin ? on revient au début, comme dans les players audio.
      if (position >= total - 0.05) {
        void player.seekTo(0);
      }
      player.play();
    }
  }, [player, position, status.playing, total]);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onReRecord}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Recommencer l'enregistrement"
        style={styles.sideButton}>
        <RotateCcw size={20} color={theme.textSecondary} />
      </Pressable>
      <Pressable
        onPress={togglePlay}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Mettre en pause' : 'Écouter'}
        style={[styles.playButton, { backgroundColor: theme.accent }]}>
        {status.playing ? (
          <Pause size={18} color={theme.onAccent} fill={theme.onAccent} />
        ) : (
          <Play size={18} color={theme.onAccent} fill={theme.onAccent} />
        )}
      </Pressable>
      <View style={styles.previewBody}>
        <View
          style={styles.scrubTrack}
          onLayout={onLayout}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={onGrant}
          onResponderMove={onMove}
          onResponderRelease={onRelease}>
          <View
            style={[
              styles.scrubFill,
              { backgroundColor: accentColor, width: `${fraction * 100}%` },
            ]}
          />
        </View>
        <ThemedText type="caption" themeColor="textSecondary">
          {formatDuration(Math.round((scrub ?? position) * 1000))} /{' '}
          {formatDuration(take.durationMs)}
        </ThemedText>
      </View>
      <Pressable
        onPress={onCancel}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Annuler"
        style={styles.sideButton}>
        <X size={20} color={theme.textSecondary} />
      </Pressable>
      <Pressable
        onPress={onSend}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Publier le commentaire vocal"
        style={[styles.sendButton, { backgroundColor: theme.accent }]}>
        <Check size={18} color={theme.onAccent} strokeWidth={3} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
  },
  sideButton: { padding: Spacing.one },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: Radii.full,
    backgroundColor: '#e5484d',
  },
  pausedDot: { backgroundColor: '#f5a524' },
  timer: { fontVariant: ['tabular-nums'], minWidth: 40 },
  stopButton: {
    width: 36,
    height: 36,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBody: { flex: 1, gap: Spacing.one },
  scrubTrack: {
    height: SEEK_BAR_HEIGHT,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(128,128,128,0.35)',
    justifyContent: 'center',
  },
  scrubFill: { height: SEEK_BAR_HEIGHT, borderRadius: Radii.full },
});

