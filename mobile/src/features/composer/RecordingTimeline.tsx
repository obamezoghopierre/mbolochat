import React, { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  Easing,
  FadeIn,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ChatMetrics } from '@/constants/chat-theme';
import { Radii, Spacing, Type } from '@/constants/theme';
import { fr } from '@/i18n/fr';

import type { VoiceGestureZone } from './voice-gesture';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

type Props = {
  levels: number[];
  elapsedMs: number;
  /** Zone de glissement active : teinte l'onde et met en avant le bon geste. */
  zone: VoiceGestureZone;
  /** Indices masqués une fois l'enregistrement verrouillé (doigt relevé). */
  showHints: boolean;
  /** Enregistrement en mains libres : commandes d'annulation et d'arrêt. */
  locked?: boolean;
  onCancel?: () => void;
  colors: {
    bar: string;
    cancel: string;
    text: string;
    dot: string;
    hint: string;
    lock: string;
  };
};

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Point d'enregistrement : pulsation courte, sans attirer tout l'écran. */
function PulseDot({ color }: { color: string }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.45 + 0.55 * pulse.value,
    transform: [{ scale: 0.85 + 0.25 * pulse.value }],
  }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

type BarProps = {
  level: number;
  cancelling: boolean;
  barColor: string;
  cancelColor: string;
};

/** Barre de l'onde : hauteur lissée et teinte d'annulation. */
function LiveBar({ level, cancelling, barColor, cancelColor }: BarProps) {
  const height = useSharedValue<number>(ChatMetrics.voiceBarMinHeight);
  const cancel = useSharedValue(0);

  useEffect(() => {
    const target =
      ChatMetrics.voiceBarMinHeight +
      Math.min(1, Math.max(0, level)) *
        (ChatMetrics.voiceBarMaxHeight - ChatMetrics.voiceBarMinHeight);
    height.value = withTiming(target, {
      duration: 110,
      easing: Easing.out(Easing.cubic),
    });
  }, [level, height]);

  useEffect(() => {
    cancel.value = withTiming(cancelling ? 1 : 0, { duration: 130 });
  }, [cancelling, cancel]);

  const style = useAnimatedStyle(() => ({
    height: height.value,
    backgroundColor: interpolateColor(cancel.value, [0, 1], [barColor, cancelColor]),
  }));

  return <Animated.View style={[styles.bar, style]} />;
}

/** Pastille de geste : icône seule sur écran étroit, libellé court sinon. */
function GestureHint({
  icon,
  upward = false,
  label,
  accessibilityLabel,
  active,
  activeColor,
  idleColor,
  compact,
}: {
  icon: IconName;
  upward?: boolean;
  label: string;
  accessibilityLabel: string;
  active: boolean;
  activeColor: string;
  idleColor: string;
  compact: boolean;
}) {
  const progress = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, { duration: 140 });
  }, [active, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.55 + 0.45 * progress.value,
    transform: [{ scale: 1 + 0.04 * progress.value }],
  }));
  const color = active ? activeColor : idleColor;
  return (
    <Animated.View
      accessible
      accessibilityLabel={accessibilityLabel}
      style={[styles.hint, style]}>
      <MaterialCommunityIcons name={icon} size={13} color={color} />
      {upward ? (
        <MaterialCommunityIcons name="chevron-up" size={12} color={color} />
      ) : null}
      {compact ? null : (
        <Text numberOfLines={1} style={[styles.hintLabel, { color }]}>
          {active ? fr.chat.voiceRecord.releaseShort : label}
        </Text>
      )}
    </Animated.View>
  );
}

/** Vue d'enregistrement : une ligne compacte, compteur lisible, onde centrale. */
export function RecordingTimeline({
  levels,
  elapsedMs,
  zone,
  showHints,
  locked = false,
  onCancel,
  colors,
}: Props) {
  const [rowWidth, setRowWidth] = useState(0);
  const [waveWidth, setWaveWidth] = useState(0);

  // Assez de place pour les libellés ? Sur écran étroit, seules les icônes
  // restent : jamais de texte tronqué ni d'onde comprimée.
  const compact = rowWidth > 0 && rowWidth < 280;

  const bars = useMemo(() => {
    const slot = ChatMetrics.voiceBarWidth + ChatMetrics.voiceBarGap;
    const count =
      waveWidth > 0
        ? Math.max(6, Math.floor((waveWidth + ChatMetrics.voiceBarGap) / slot))
        : 12;
    return levels.slice(-Math.min(count, levels.length));
  }, [levels, waveWidth]);

  return (
    <Animated.View
      entering={FadeIn.duration(120)}
      style={styles.container}
      onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
      {locked && onCancel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fr.chat.voiceRecord.deleteRecording}
          hitSlop={6}
          onPress={onCancel}
          style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="trash-can-outline" size={17} color={colors.cancel} />
        </Pressable>
      ) : null}

      <View style={styles.header}>
        <PulseDot color={colors.dot} />
        <Text style={[styles.timer, { color: colors.text }]}>{formatDuration(elapsedMs)}</Text>
      </View>

      <View
        style={styles.waveform}
        onLayout={(event) => setWaveWidth(event.nativeEvent.layout.width)}>
        {bars.map((level, index) => (
          <LiveBar
            key={index}
            level={level}
            cancelling={zone === 'cancel'}
            barColor={colors.bar}
            cancelColor={colors.cancel}
          />
        ))}
      </View>

      {locked ? (
        <View accessible accessibilityLabel={fr.chat.voiceRecord.locked} style={styles.locked}>
          <MaterialCommunityIcons name="lock-outline" size={13} color={colors.lock} />
          {compact ? null : (
            <Text style={[styles.hintLabel, { color: colors.lock }]}>
              {fr.chat.voiceRecord.locked}
            </Text>
          )}
        </View>
      ) : showHints ? (
        <View style={styles.hints}>
          <GestureHint
            icon="trash-can-outline"
            label={fr.chat.voiceRecord.hintCancel}
            accessibilityLabel={fr.chat.voiceRecord.releaseToCancel}
            active={zone === 'cancel'}
            activeColor={colors.cancel}
            idleColor={colors.hint}
            compact={compact}
          />
          <GestureHint
            icon="lock-outline"
            upward
            label={fr.chat.voiceRecord.hintLock}
            accessibilityLabel={fr.chat.voiceRecord.releaseToLock}
            active={zone === 'lock'}
            activeColor={colors.lock}
            idleColor={colors.hint}
            compact={compact}
          />
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: ChatMetrics.composerRecordingHeight,
    paddingHorizontal: Spacing.one,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
    flexShrink: 0,
  },
  dot: {
    width: ChatMetrics.composerRecordingDotSize,
    height: ChatMetrics.composerRecordingDotSize,
    borderRadius: Radii.full,
  },
  timer: {
    ...Type.body,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    minWidth: 38,
  },
  waveform: {
    flex: 1,
    minWidth: 0,
    height: ChatMetrics.composerRecordingWaveHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ChatMetrics.voiceBarGap,
    overflow: 'hidden',
  },
  bar: {
    width: ChatMetrics.voiceBarWidth,
    borderRadius: Radii.full,
    flexShrink: 0,
  },
  hints: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 0,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  hintLabel: {
    ...Type.micro,
    fontWeight: '600',
  },
  locked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    flexShrink: 0,
  },
  cancelButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pressed: { opacity: 0.7 },
});
