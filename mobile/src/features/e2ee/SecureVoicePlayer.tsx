import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import {
  VoiceMessageBubble,
  VoiceSpeedChip,
} from '@/features/voice-notes/VoiceMessageBubble';
import { ChatBubble } from '@/features/chat/ui/chat-bubble';
import { ChatMetrics, useChatColors } from '@/constants/chat-theme';
import { Radii, Type } from '@/constants/theme';
import {
  voiceBarCount,
  voiceBubbleLayoutWidth,
  voiceTrailingWidth,
  type VoiceLayoutMetrics,
} from '@/features/voice-notes/voiceBubbleLayout';
import { toWaveform } from '@/features/voice-notes/useVoiceRecorder';
import {
  DEFAULT_VOICE_SPEED,
  type VoiceSpeed,
} from '@/features/voice-notes/voiceSpeed';
import { transcribeVoiceMessage, voiceTranscriptionAvailable } from '@/features/voice-notes/transcription';
import { fr } from '@/i18n/fr';
import { useAuth } from '@/lib/auth-context';
import { openE2eeDatabase } from './db';
import { openForView } from './mediaStore';
import type { EncryptedMedia } from './payload';

/** Métriques de la bulle vocale, partagées avec le lecteur en clair. */
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

/**
 * Note vocale chiffrée, lue **dans la bulle** : au premier toucher, le
 * ciphertext est téléchargé et déchiffré dans le dossier privé, puis le lecteur
 * du chat en clair prend le relais sur l'URI locale. Le fichier déchiffré vit
 * jusqu'au démontage de l'écran (le nettoyage du parent l'efface) — jamais
 * au-delà, et rien n'est téléchargé avant le toucher, comme les autres médias.
 */
export function SecureVoicePlayer({
  token,
  media,
  mine,
  onLongPress,
  footer,
  tail = true,
}: {
  token: string | null;
  media: EncryptedMedia;
  mine: boolean;
  onLongPress?: () => void;
  /** Heure et accusé, posés dans la bulle comme sur les bulles de texte. */
  footer?: ReactNode;
  /** Queue de bulle, masquée au milieu d'une suite. */
  tail?: boolean;
}) {
  const { user } = useAuth();
  const chat = useChatColors();
  const { width: screenW } = useWindowDimensions();
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Choisie avant même le déchiffrement : la vitesse survit au passage au
  // lecteur final, qui reçoit la même valeur.
  const [speed, setSpeed] = useState<VoiceSpeed>(DEFAULT_VOICE_SPEED);

  const durationMs = media.duration ?? 0;
  const id = media.blob.uploadId;
  const transcribable = !mine && voiceTranscriptionAvailable();

  const decrypt = useCallback(async () => {
    if (!token || loading) return;
    setLoading(true);
    try {
      const plain = await openForView({ token, blob: media.blob, mime: media.mime });
      setUri(plain);
    } catch {
      Alert.alert(fr.e2eeMedia.errorTitle, fr.e2eeMedia.errorBody);
    } finally {
      setLoading(false);
    }
  }, [token, loading, media]);

  const width = voiceBubbleLayoutWidth(
    LAYOUT_METRICS,
    durationMs,
    screenW,
    true,
    transcribable,
  );
  const trailing = voiceTrailingWidth(LAYOUT_METRICS, true, transcribable);
  const bars = useMemo(
    () =>
      toWaveform(
        media.waveform && media.waveform.length > 0 ? media.waveform : [],
        voiceBarCount(LAYOUT_METRICS, width, trailing),
      ),
    [media.waveform, width, trailing],
  );

  if (uri) {
    return (
      <VoiceMessageBubble
        id={id}
        uri={uri}
        durationMs={durationMs}
        waveform={media.waveform}
        isMine={mine}
        speedControl
        speed={speed}
        onSpeedChange={setSpeed}
        // Transcription locale, reçue uniquement : le clair vient d'être
        // produit, le moteur tourne sur l'appareil, le cache vit en SQLCipher.
        transcribable={transcribable}
        footer={footer}
        tail={tail}
        onTranscribe={async () => {
          if (!user?.id) throw new Error('e2ee_account_missing');
          const { db } = await openE2eeDatabase(user.id);
          return transcribeVoiceMessage(db, id, {
            uri,
            mimeType: media.mime,
            durationMs,
          });
        }}
      />
    );
  }

  // Avant déchiffrement : la même silhouette que le lecteur final, mais le
  // toucher déclenche le déchiffrement au lieu de la lecture.
  return (
    <View style={mine ? styles.rowMine : styles.rowOther}>
      <ChatBubble mine={mine} style={{ width }} tail={tail}>
        <View style={styles.contentRow}>
          {/* Le toucher qui déchiffre ne couvre que la lecture et l'onde : la
              pastille de vitesse reste indépendante et ne déclenche rien. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={fr.e2eeMedia.voiceName}
            onPress={() => void decrypt()}
            onLongPress={onLongPress}
            delayLongPress={320}
            style={({ pressed }) => [styles.playWave, pressed && styles.pressed]}>
            <View style={styles.playButton}>
              {loading ? (
                <ActivityIndicator size="small" color={chat.voiceBubbleText} />
              ) : (
                <Ionicons
                  name="play"
                  size={ChatMetrics.voicePlayIconSize}
                  color={chat.voiceBubbleText}
                />
              )}
            </View>
            <View style={styles.waveform}>
              {bars.map((value, index) => (
                <View
                  key={index}
                  style={[
                    styles.bar,
                    {
                      height: Math.round(
                        ChatMetrics.voiceBarMinHeight +
                          value * (ChatMetrics.voiceBarMaxHeight - ChatMetrics.voiceBarMinHeight),
                      ),
                      backgroundColor: chat.voiceBarInactive,
                    },
                  ]}
                />
              ))}
            </View>
          </Pressable>
          {/* Le choix de vitesse est possible dès maintenant : il s'appliquera
              à la lecture une fois le média déchiffré. */}
          <View style={styles.cluster}>
            <Text style={[styles.duration, { color: chat.voiceBubbleText }]}>
              {formatDuration(durationMs)}
            </Text>
            <VoiceSpeedChip
              ink={chat.voiceBubbleText}
              background={chat.voiceChipBackground}
              speed={speed}
              onPress={setSpeed}
            />
          </View>
        </View>
        {footer}
      </ChatBubble>
    </View>
  );
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  rowMine: { alignSelf: 'flex-end', marginTop: ChatMetrics.voiceTopMargin },
  rowOther: { alignSelf: 'flex-start', marginTop: ChatMetrics.voiceTopMargin },
  pressed: { opacity: 0.75 },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ChatMetrics.voiceControlGap,
    height: ChatMetrics.voiceControlHeight,
  },
  playWave: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: ChatMetrics.voiceControlGap,
    height: ChatMetrics.voiceControlHeight,
  },
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
});
