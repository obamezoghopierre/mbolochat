import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing } from '@/constants/theme';
import { invalidateFeedCache } from '@/features/social/feed/use-feed';
import { primaryMedia } from '@/features/social/feed/pager/feed-media';
import { videoPosterUrl } from '@/features/social/feed/pager/video-source';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { resolveMediaUrl } from '@/lib/media-url';
import type { FeedPost } from '@/lib/types';

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

  const unchanged = (post?.caption ?? '') === caption.trim();

  const save = async () => {
    if (!token || !id || saving || unchanged) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.updatePublication(token, id, { caption: caption.trim() });
      // Le fil relira la publication à jour au prochain affichage.
      invalidateFeedCache(token);
      router.back();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : fr.social.editSaveError);
    } finally {
      setSaving(false);
    }
  };

  const media = post ? primaryMedia(post) : null;
  const thumb = post
    ? media?.kind === 'video'
      ? videoPosterUrl(post)
      : resolveMediaUrl(media?.url ?? null)
    : null;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: fr.social.editCaptionTitle,
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
              {thumb ? (
                <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" />
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
  save: { fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.4 },
});
