import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ArrowLeft } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedSurface, MediaSurface, Radii, Spacing, Type } from '@/constants/theme';
import { MediaFilterOverlay } from '@/features/media/media-filter';
import { FilterStrip } from '@/features/social/create/filter-strip';
import { fr } from '@/i18n/fr';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { newClientId } from '@/lib/client-id';
import { consumePendingCreation, type PendingCreation } from '@/lib/pending-creation';
import type { SocialVisibility } from '@/lib/types';
import { invalidateFeedCache } from '@/features/social/feed/use-feed';

/**
 * Dernière étape du flux « Créer » : aperçu des médias choisis (caméra ou
 * galerie), filtre, légende et audience, puis publication.
 *
 * La publication exige des assets `ready` : l'upload (ticket → PUT présigné
 * → confirmation) est suivi d'une attente du traitement serveur (variantes,
 * poster, transcodage) avant l'appel `createPublication`.
 */

const VISIBILITIES: readonly SocialVisibility[] = ['public', 'followers', 'private'];
const VISIBILITY_LABELS: Record<SocialVisibility, string> = {
  public: 'Public',
  followers: 'Abonnés',
  private: 'Privé',
};
/** Au-delà, on abandonne l'attente : le worker peut être long sur une vidéo. */
const READY_TIMEOUT_MS = 180_000;
const READY_POLL_MS = 2_500;
const CAPTION_MAX = 2200;

export default function CreatePreviewScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Consommé une seule fois : un retour sur cet écran sans média repart.
  const [creation] = useState<PendingCreation | null>(() => consumePendingCreation());
  const assets = useMemo(() => creation?.assets ?? [], [creation]);
  const [filter, setFilter] = useState<string | null>(creation?.filter ?? null);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<SocialVisibility>('public');
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientId = useRef(newClientId());

  useEffect(() => {
    if (!creation) {
      router.back();
    }
  }, [creation]);

  const singleVideo = assets.length === 1 && assets[0].kind === 'video' ? assets[0] : null;
  const images = assets.filter((asset) => asset.kind === 'image');

  const waitUntilReady = useCallback(
    async (assetId: string): Promise<void> => {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      for (;;) {
        const asset = await api.socialMediaAsset(token!, assetId);
        if (asset.status === 'ready') {
          return;
        }
        if (asset.status === 'failed' || asset.status === 'deleted') {
          throw new Error('processing');
        }
        if (Date.now() > deadline) {
          throw new Error('timeout');
        }
        await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
      }
    },
    [token],
  );

  const publish = useCallback(async () => {
    if (!token || publishing || assets.length === 0) {
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      const assetIds: string[] = [];
      for (const [index, asset] of assets.entries()) {
        setProgress(fr.social.createUploading(index + 1, assets.length));
        const uploaded = await api.uploadSocialMedia(token, {
          uri: asset.uri,
          kind: asset.kind as 'image' | 'video',
          mime: asset.mime,
          durationMs: asset.durationMs,
          sizeBytes: asset.size ?? undefined,
        });
        setProgress(fr.social.createProcessing(index + 1, assets.length));
        await waitUntilReady(uploaded.id);
        assetIds.push(uploaded.id);
      }
      setProgress(fr.social.createPublishing);
      await api.createPublication(token, {
        clientId: clientId.current,
        caption: caption.trim() || undefined,
        assetIds,
        visibility,
        mediaFilter: filter ?? undefined,
      });
      invalidateFeedCache(token);
      setProgress(null);
      // Retour au fil : la pile de création est remplacée par le résultat.
      router.dismissTo('/');
    } catch {
      setPublishing(false);
      setProgress(null);
      setError(fr.social.createPublishError);
    }
  }, [assets, caption, filter, publishing, token, visibility, waitUntilReady]);

  if (!creation) {
    return <View style={styles.screen} />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: FeedSurface.background }]}>
      <Stack.Screen options={{ headerShown: false, statusBarStyle: 'light' }} />
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top + Spacing.two,
            borderBottomColor: FeedSurface.onMediaFaint,
          },
        ]}>
        <Pressable
          onPress={() => router.back()}
          disabled={publishing}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={fr.social.back}>
          <Icon icon={ArrowLeft} size={22} color={FeedSurface.onMedia} />
        </Pressable>
        <ThemedText style={[Type.body, styles.topTitle, { color: FeedSurface.onMedia }]}>
          {fr.social.createPreviewTitle}
        </ThemedText>
        <Pressable
          onPress={() => void publish()}
          disabled={publishing}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={fr.social.createPublish}
          accessibilityState={{ disabled: publishing }}
          style={({ pressed }) => pressed && styles.pressed}>
          {publishing ? (
            <ActivityIndicator size="small" color={FeedSurface.accent} />
          ) : (
            <ThemedText style={[Type.body, styles.publishLabel, { color: FeedSurface.accent }]}>
              {fr.social.createPublish}
            </ThemedText>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Aperçu : vidéo unique en boucle, ou carrousel horizontal de photos. */}
        <View style={styles.mediaArea}>
          {singleVideo ? (
            <PreviewVideo uri={singleVideo.uri} filterKey={filter} />
          ) : images.length > 0 ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={styles.flex}
              contentContainerStyle={{ width: width * images.length }}>
              {images.map((asset) => (
                <View key={asset.uri} style={{ width, flex: 1 }}>
                  <Image
                    source={{ uri: asset.uri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    accessibilityLabel={asset.name}
                  />
                  <MediaFilterOverlay filterKey={filter} />
                </View>
              ))}
            </ScrollView>
          ) : null}
          {images.length > 1 ? (
            <View style={styles.counterPill} pointerEvents="none">
              <ThemedText style={styles.counterText}>
                {fr.social.createPagesCount(images.length)}
              </ThemedText>
            </View>
          ) : null}
        </View>

        <FilterStrip value={filter} onChange={setFilter} disabled={publishing} />

        <View
          style={[
            styles.composer,
            {
              borderTopColor: FeedSurface.onMediaFaint,
              paddingBottom: insets.bottom + Spacing.two,
            },
          ]}>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder={fr.social.createCaptionPlaceholder}
            placeholderTextColor={FeedSurface.onMediaFaint}
            multiline
            maxLength={CAPTION_MAX}
            editable={!publishing}
            style={[styles.captionInput, { color: FeedSurface.onMedia }]}
            accessibilityLabel={fr.social.createCaptionLabel}
          />

          <View style={styles.visibilityRow}>
            {VISIBILITIES.map((option) => {
              const active = visibility === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => setVisibility(option)}
                  disabled={publishing}
                  accessibilityRole="button"
                  accessibilityLabel={VISIBILITY_LABELS[option]}
                  accessibilityState={{ selected: active }}
                  style={[styles.visibilityChip, active && styles.visibilityChipActive]}>
                  <ThemedText
                    style={[
                      Type.caption,
                      { color: active ? FeedSurface.onMedia : FeedSurface.onMediaSoft },
                    ]}>
                    {VISIBILITY_LABELS[option]}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {progress ? (
            <View style={styles.progressRow}>
              <ActivityIndicator size="small" color={FeedSurface.accent} />
              <ThemedText type="caption" style={{ color: FeedSurface.onMediaSoft }}>
                {progress}
              </ThemedText>
            </View>
          ) : null}
          {error ? (
            <ThemedText type="caption" style={{ color: '#FF5A5F' }}>
              {error}
            </ThemedText>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Lecteur vidéo local pour l'aperçu : boucle, son activé, filtre par-dessus. */
function PreviewVideo({ uri, filterKey }: { uri: string; filterKey: string | null }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = false;
    instance.play();
  });
  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      <MediaFilterOverlay filterKey={filterKey} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topTitle: { fontWeight: '700' },
  publishLabel: { fontWeight: '700' },
  mediaArea: {
    flex: 1,
    backgroundColor: MediaSurface.background,
    overflow: 'hidden',
  },
  counterPill: {
    position: 'absolute',
    top: Spacing.two,
    alignSelf: 'center',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  counterText: { ...Type.caption, color: MediaSurface.onSurface },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  captionInput: {
    ...Type.body,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 56,
    maxHeight: 120,
    textAlignVertical: 'top',
  },
  visibilityRow: { flexDirection: 'row', gap: Spacing.two },
  visibilityChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radii.full,
    backgroundColor: FeedSurface.glass,
  },
  visibilityChipActive: { backgroundColor: FeedSurface.glassStrong },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  pressed: { opacity: 0.7 },
});
