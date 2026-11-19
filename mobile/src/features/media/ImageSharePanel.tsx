import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { Download, MoreHorizontal } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { fr } from '@/i18n/fr';
import { setPendingMediaShare } from '@/lib/pending-media-share';
import type { ConversationSummary } from '@/lib/types';
import { Radii, Spacing } from '@/constants/theme';

interface ImageSharePanelProps {
  imageUrl: string;
  onClose: () => void;
  /** Appelé après « Envoyer en message » : l'écran hôte peut fermer la visionneuse. */
  onSent?: () => void;
}

async function downloadImage(url: string): Promise<string> {
  const target = `${FileSystem.cacheDirectory}mbolochat-share-${Date.now()}.jpg`;
  const result = await FileSystem.downloadAsync(url, target);
  return result.uri;
}

interface TargetInfo {
  name: string;
  uri: string | null;
  variant: 'user' | 'group';
  gender: ConversationSummary['members'][number]['gender'] | null;
  emoji: string | null;
  color: string | null;
}

function targetInfo(target: ConversationSummary, userId: string | undefined): TargetInfo {
  if (target.type === 'GROUP') {
    return {
      name: target.name ?? 'Groupe',
      uri: target.avatarUrl,
      variant: 'group',
      gender: null,
      emoji: target.emoji,
      color: target.color,
    };
  }
  const other = target.members.find((member) => member.id !== userId);
  return {
    name: other?.displayName ?? target.name ?? 'Conversation',
    uri: other?.avatarUrl ?? null,
    variant: 'user',
    gender: other?.gender ?? null,
    emoji: null,
    color: null,
  };
}

/**
 * Panneau de partage d'une image, rendu dans la fenêtre de la visionneuse :
 * rangée horizontale d'interlocuteurs (envoi en message), Enregistrer et
 * partage externe.
 */
export function ImageSharePanel({ imageUrl, onClose, onSent }: ImageSharePanelProps) {
  const router = useRouter();
  const { token, user } = useAuth();
  const insets = useSafeAreaInsets();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [loading, setLoading] = useState(() => Boolean(token));
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void api
      .listConversations(token)
      .then((list) => {
        if (!cancelled) setConversations(list ?? []);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const run = useCallback(
    async (task: () => Promise<void>, closeAfter = true) => {
      if (busy) return;
      setBusy(true);
      try {
        await task();
      } catch {
        Alert.alert(fr.media.shareError);
      } finally {
        setBusy(false);
        if (closeAfter) onClose();
      }
    },
    [busy, onClose],
  );

  const saveToGallery = useCallback(
    () =>
      run(async () => {
        const localUri = await downloadImage(imageUrl);
        const permission = await requestPermissionsAsync(true, ['photo']);
        if (!permission.granted) {
          Alert.alert(fr.media.shareError);
          return;
        }
        await Asset.create(localUri);
        Alert.alert(fr.media.shareSaved);
      }),
    [run, imageUrl],
  );

  const shareExternal = useCallback(
    () =>
      run(async () => {
        const localUri = await downloadImage(imageUrl);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(localUri, { mimeType: 'image/jpeg' });
        }
      }),
    [run, imageUrl],
  );

  const sendToChat = useCallback(
    (target: ConversationSummary) =>
      run(async () => {
        const localUri = await downloadImage(imageUrl);
        setPendingMediaShare({ uri: localUri, mime: 'image/jpeg' });
        onClose();
        onSent?.();
        router.push({ pathname: '/chat/[id]', params: { id: target.id } });
      }, false),
    [run, imageUrl, onClose, onSent, router],
  );

  const renderTarget = useCallback(
    ({ item }: { item: ConversationSummary }) => {
      const info = targetInfo(item, user?.id);
      return (
        <Pressable
          onPress={() => void sendToChat(item)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={info.name}
          style={styles.target}>
          <Avatar
            name={info.name}
            uri={info.uri}
            size={56}
            gender={info.gender}
            variant={info.variant}
            emoji={info.emoji}
            color={info.color}
          />
          <Text style={styles.targetName} numberOfLines={1}>
            {info.name}
          </Text>
        </Pressable>
      );
    },
    [busy, sendToChat, user?.id],
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={styles.dim} onPress={onClose} accessibilityLabel="Fermer" />
      <Animated.View
        entering={SlideInDown.duration(240)}
        style={[styles.panel, { paddingBottom: insets.bottom + Spacing.three }]}>
        <View style={styles.handle} />
        {loading ? (
          <View style={styles.stateRow}>
            <ActivityIndicator color="#ffffff" />
          </View>
        ) : loadError ? (
          <Text style={styles.stateText}>{fr.media.shareError}</Text>
        ) : !conversations || conversations.length === 0 ? (
          <Text style={styles.stateText}>{fr.media.shareEmpty}</Text>
        ) : (
          <FlatList
            horizontal
            data={conversations}
            keyExtractor={(item) => item.id}
            renderItem={renderTarget}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.targetsRow}
          />
        )}
        <View style={styles.actionsRow}>
          <Pressable
            onPress={() => void saveToGallery()}
            disabled={busy}
            accessibilityRole="button"
            style={styles.actionButton}>
            <View style={styles.actionIcon}>
              <Download size={22} color="#ffffff" />
            </View>
            <Text style={styles.actionLabel}>{fr.media.shareSaveToGallery}</Text>
          </Pressable>
          <Pressable
            onPress={() => void shareExternal()}
            disabled={busy}
            accessibilityRole="button"
            style={styles.actionButton}>
            <View style={styles.actionIcon}>
              <MoreHorizontal size={22} color="#ffffff" />
            </View>
            <Text style={styles.actionLabel}>{fr.media.shareMoreOptions}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(24,24,28,0.97)',
    borderTopLeftRadius: Radii.sheet,
    borderTopRightRadius: Radii.sheet,
    paddingTop: Spacing.two,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginBottom: Spacing.three,
  },
  stateRow: {
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  targetsRow: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
    paddingBottom: Spacing.three,
  },
  target: {
    width: 64,
    alignItems: 'center',
    gap: Spacing.one,
  },
  targetName: {
    color: '#ffffff',
    fontSize: 11,
    maxWidth: 64,
    textAlign: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.five,
    paddingTop: Spacing.two,
  },
  actionButton: {
    alignItems: 'center',
    gap: Spacing.one,
    minWidth: 72,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    color: '#ffffff',
    fontSize: 12,
  },
});
