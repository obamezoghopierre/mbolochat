import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Check } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { newClientId } from '@/lib/client-id';
import { resolveMediaUrl } from '@/lib/media-url';
import { fr } from '@/i18n/fr';
import type { FeedPost } from '@/lib/types';
import { primaryMedia } from '@/features/social/feed/pager/feed-media';
import { invalidateFeedCache } from '@/features/social/feed/use-feed';

/**
 * Composeur de citation (« Citer » façon Instagram) : la publication
 * originale est affichée en aperçu, l'utilisateur ajoute son avis puis
 * publie. Le serveur copie les médias de l'originale — rien n'est
 * téléversé depuis cet écran.
 */
export default function QuoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [post, setPost] = useState<FeedPost | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState(false);
  // Même clé tant que l'écran est ouvert : un nouvel essai après coupure
  // renvoie la citation déjà créée au lieu d'en publier une seconde.
  const clientId = useRef(newClientId());

  const load = useCallback(async () => {
    if (!token || !id) {
      return;
    }
    try {
      setPost(await api.publication(token, id));
      setError(null);
      setStatus('ready');
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 404
          ? fr.social.postMissing
          : fr.social.quoteError,
      );
      setStatus('error');
    }
  }, [id, token]);

  useEffect(() => {
    // Les états sont posés après la réponse réseau, pas pendant le montage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const publish = async () => {
    if (!token || !id || publishing || done) {
      return;
    }
    setPublishing(true);
    try {
      await api.createPublication(token, {
        clientId: clientId.current,
        quotedPublicationId: id,
        ...(caption.trim().length > 0 ? { caption: caption.trim() } : {}),
      });
      // Confirmation visible un instant, comme le toast « Post published »
      // d'Instagram, avant de revenir au fil.
      setDone(true);
      invalidateFeedCache(token);
      setTimeout(() => router.back(), 900);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : fr.social.quoteError,
      );
      setPublishing(false);
    }
  };

  const media = post ? primaryMedia(post) : null;
  const preview = media
    ? resolveMediaUrl(media.kind === 'video' ? media.posterUrl : media.url)
    : null;

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[
          styles.topBar,
          { paddingTop: insets.top + Spacing.two, borderBottomColor: theme.border },
        ]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={fr.social.back}>
          <Icon icon={ArrowLeft} size={22} color={theme.text} />
        </Pressable>
        <ThemedText style={styles.topTitle}>{fr.social.quoteTitle}</ThemedText>
        {/* Action principale façon Instagram : « Share » en haut à droite,
            pas de bouton plein en bas de page. */}
        <Pressable
          onPress={() => void publish()}
          disabled={publishing || done}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={fr.social.quotePublish}
          accessibilityState={{ disabled: publishing || done }}
          style={styles.shareButton}>
          {publishing ? (
            <ActivityIndicator color={theme.accent} size="small" />
          ) : done ? (
            <View style={styles.doneRow}>
              <Icon icon={Check} size={18} color={theme.accent} strokeWidth={3} />
              <ThemedText style={{ color: theme.accent, fontWeight: '600' }}>
                {fr.social.quotePublished}
              </ThemedText>
            </View>
          ) : (
            <ThemedText style={{ color: theme.accent, fontWeight: '600' }}>
              {fr.social.shareLabel}
            </ThemedText>
          )}
        </Pressable>
      </View>

      {status === 'loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : status === 'error' || !post ? (
        <View style={styles.centered}>
          <ThemedText type="sectionTitle" style={styles.stateTitle}>
            {fr.social.quoteError}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.stateBody}>
            {error}
          </ThemedText>
          <Pressable
            onPress={() => void load()}
            accessibilityRole="button"
            style={[styles.retry, { backgroundColor: theme.accentSoft }]}>
            <ThemedText type="small" style={{ color: theme.accent }}>
              {fr.social.feedRetry}
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}>
          <View
            style={[
              styles.body,
              { paddingBottom: insets.bottom + Spacing.three },
            ]}>
            {/* Publication citée : carte compacte façon Instagram —
                vignette à gauche, auteur et extrait à droite. */}
            <View
              style={[
                styles.preview,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
              ]}>
              {preview ? (
                <Image
                  source={{ uri: preview }}
                  style={[styles.previewThumb, { backgroundColor: theme.backgroundSelected }]}
                  contentFit="cover"
                  transition={120}
                  accessibilityLabel={
                    media?.altText ?? `Aperçu de la publication de ${post.author.displayName}`
                  }
                />
              ) : null}
              <View style={styles.previewBody}>
                <View style={styles.previewHeader}>
                  <Avatar
                    name={post.author.displayName}
                    uri={resolveMediaUrl(post.author.avatarUrl)}
                    size={28}
                  />
                  <View style={styles.previewIdentity}>
                    <ThemedText numberOfLines={1} style={styles.previewName}>
                      {post.author.displayName}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      @{post.author.username}
                    </ThemedText>
                  </View>
                </View>
                {post.caption ? (
                  <ThemedText numberOfLines={3} style={styles.previewCaption}>
                    {post.caption}
                  </ThemedText>
                ) : null}
              </View>
            </View>

            <ThemedText type="small" themeColor="textSecondary">
              {fr.social.quoteHint}
            </ThemedText>

            {/* Compositeur façon Instagram : avatar de l'auteur puis champ
                de légende, sans cadre. */}
            <View style={styles.composer}>
              <Avatar
                name={user?.displayName ?? ''}
                uri={resolveMediaUrl(user?.avatarUrl)}
                size={32}
              />
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder={fr.social.quoteCaptionPlaceholder}
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text }]}
                maxLength={2000}
                multiline
                accessibilityLabel={fr.social.quoteCaptionPlaceholder}
              />
            </View>
          </View>

        </KeyboardAvoidingView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  stateTitle: { textAlign: 'center' },
  stateBody: { textAlign: 'center', maxWidth: 320 },
  retry: {
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radii.full,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topTitle: { ...Type.sectionTitle },
  shareButton: {
    minWidth: 22,
    alignItems: 'flex-end',
  },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  body: {
    flex: 1,
    gap: Spacing.three,
    padding: Spacing.three,
  },
  preview: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.lg,
    padding: Spacing.two,
    gap: Spacing.two,
  },
  previewThumb: {
    width: 72,
    aspectRatio: 1,
    borderRadius: Radii.md,
  },
  previewBody: {
    flex: 1,
    gap: Spacing.one,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  previewIdentity: { flex: 1, gap: Spacing.half },
  previewName: { ...Type.body, fontWeight: '600' },
  previewCaption: { ...Type.caption },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    minHeight: 96,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
});
