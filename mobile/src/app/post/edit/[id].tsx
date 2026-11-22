import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeft, ChevronRight, Play, X } from 'lucide-react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing } from '@/constants/theme';
import { invalidateFeedCache } from '@/features/social/feed/use-feed';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { resolveMediaUrl } from '@/lib/media-url';
import type { FeedPost, PublicationMedia } from '@/lib/types';

/** Même plafond que le compositeur photo/vidéo (format Instagram). */
const CAPTION_MAX = 2200;

/**
 * Modifier la légende d'une publication photo, carrousel ou vidéo, comme
 * Instagram : les médias restent tels quels, seul le texte change. Les
 * mentions ajoutées sont notifiées et la publication affiche « Modifié ».
 */
export default function EditPublicationCaptionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [post, setPost] = useState<FeedPost | null>(null);
  const [caption, setCaption] = useState('');
  // Médias gardés, dans l'ordre affiché : on retire ou on réordonne, comme
  // Instagram ; ajouter un média demande une nouvelle publication.
  const [order, setOrder] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) {
      return;
    }
    let cancelled = false;
    api
      .publication(token, id)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setPost(loaded);
        setCaption(loaded.caption ?? '');
        setOrder((loaded.media ?? []).map((media) => media.assetId));
        setStatus('ready');
      })
      .catch((cause) => {
        if (cancelled) {
          return;
        }
        setError(cause instanceof ApiError ? cause.message : fr.social.editLoadError);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [id, token]);

  const mediaById = useMemo(
    () => new Map((post?.media ?? []).map((media) => [media.assetId, media])),
    [post?.media],
  );
  const originalOrder = (post?.media ?? []).map((media) => media.assetId);
  const mediaChanged =
    order.length !== originalOrder.length ||
    order.some((assetId, index) => originalOrder[index] !== assetId);
  const captionChanged = (post?.caption ?? '') !== caption.trim();
  const unchanged = !captionChanged && !mediaChanged;

  const move = (index: number, delta: -1 | 1) => {
    setOrder((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const removeAt = (index: number) => {
    // Le dernier média reste : sans lui, il faut supprimer la publication.
    setOrder((current) =>
      current.length <= 1 ? current : current.filter((_, position) => position !== index),
    );
  };

  const save = async () => {
    if (!token || !id || saving || unchanged) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.updatePublication(token, id, {
        ...(captionChanged ? { caption: caption.trim() } : {}),
        ...(mediaChanged ? { mediaAssetIds: order } : {}),
      });
      // Le fil relira la publication à jour au prochain affichage.
      invalidateFeedCache(token);
      router.back();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : fr.social.editSaveError);
    } finally {
      setSaving(false);
    }
  };

  const thumbOf = (media: PublicationMedia | undefined) =>
    resolveMediaUrl(media?.kind === 'video' ? media.posterUrl : (media?.url ?? null));
  const firstThumb = thumbOf(mediaById.get(order[0] ?? ''));

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: fr.social.editPostTitle,
          headerRight: () => (
            <Pressable
              onPress={() => void save()}
              hitSlop={8}
              disabled={saving || unchanged || status !== 'ready'}
              accessibilityRole="button">
              <ThemedText
                style={[
                  styles.save,
                  { color: theme.accent },
                  (unchanged || status !== 'ready') && styles.disabled,
                ]}>
                {saving ? '…' : fr.social.editSave}
              </ThemedText>
            </Pressable>
          ),
        }}
      />
      {status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.text} />
        </View>
      ) : status === 'error' ? (
        <View style={styles.center}>
          <ThemedText themeColor="textSecondary">{error}</ThemedText>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingBottom: insets.bottom + Spacing.four },
            ]}
            keyboardShouldPersistTaps="handled">
            <View style={styles.row}>
              {firstThumb ? (
                <Image source={{ uri: firstThumb }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]} />
              )}
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder={fr.social.editCaptionPlaceholder}
                placeholderTextColor={theme.textSecondary}
                multiline
                autoFocus
                maxLength={CAPTION_MAX}
                style={[styles.input, { color: theme.text }]}
                accessibilityLabel={fr.social.editCaptionTitle}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
              {caption.length}/{CAPTION_MAX}
            </ThemedText>

            {originalOrder.length > 1 ? (
              <View style={styles.mediaBlock}>
                <ThemedText type="smallBold">{fr.social.editMediaTitle}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {fr.social.editMediaHint}
                </ThemedText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.mediaRow}>
                    {order.map((assetId, index) => {
                      const media = mediaById.get(assetId);
                      const uri = thumbOf(media);
                      return (
                        <View key={assetId} style={styles.mediaItem}>
                          <View style={[styles.mediaThumb, { backgroundColor: theme.backgroundElement }]}>
                            {uri ? (
                              <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                            ) : null}
                            {media?.kind === 'video' ? (
                              <View style={styles.videoBadge}>
                                <Icon icon={Play} size={12} color="#FFFFFF" />
                              </View>
                            ) : null}
                            <ThemedText style={styles.position}>{index + 1}</ThemedText>
                            {order.length > 1 ? (
                              <Pressable
                                onPress={() => removeAt(index)}
                                hitSlop={8}
                                accessibilityRole="button"
                                accessibilityLabel={fr.social.editMediaRemove(index + 1)}
                                style={styles.remove}>
                                <Icon icon={X} size={14} color="#FFFFFF" />
                              </Pressable>
                            ) : null}
                          </View>
                          <View style={styles.moveRow}>
                            <Pressable
                              onPress={() => move(index, -1)}
                              disabled={index === 0}
                              hitSlop={6}
                              accessibilityRole="button"
                              accessibilityLabel={fr.social.editMediaEarlier(index + 1)}
                              style={index === 0 && styles.disabled}>
                              <Icon icon={ChevronLeft} size={20} color={theme.text} />
                            </Pressable>
                            <Pressable
                              onPress={() => move(index, 1)}
                              disabled={index === order.length - 1}
                              hitSlop={6}
                              accessibilityRole="button"
                              accessibilityLabel={fr.social.editMediaLater(index + 1)}
                              style={index === order.length - 1 && styles.disabled}>
                              <Icon icon={ChevronRight} size={20} color={theme.text} />
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              {fr.social.editCaptionHint}
            </ThemedText>
            {error ? (
              <ThemedText type="small" style={{ color: theme.danger }}>
                {error}
              </ThemedText>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'flex-start',
  },
  thumb: {
    width: 64,
    height: 80,
    borderRadius: Radii.md,
  },
  input: {
    flex: 1,
    minHeight: 120,
    fontSize: 16,
    textAlignVertical: 'top',
    paddingTop: 0,
  },
  counter: { alignSelf: 'flex-end' },
  mediaBlock: { gap: Spacing.two, marginTop: Spacing.two },
  mediaRow: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.one },
  mediaItem: { alignItems: 'center', gap: Spacing.one },
  mediaThumb: {
    width: 84,
    height: 105,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  videoBadge: {
    position: 'absolute',
    left: Spacing.one,
    bottom: Spacing.one,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  position: {
    position: 'absolute',
    left: Spacing.one,
    top: Spacing.one,
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 3,
  },
  remove: {
    position: 'absolute',
    right: Spacing.one,
    top: Spacing.one,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  moveRow: { flexDirection: 'row', gap: Spacing.three },
  save: { fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.4 },
});
