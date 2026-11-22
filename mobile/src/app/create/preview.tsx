import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { ArrowLeft } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocationField } from '@/features/social/create/location-field';
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
/** Ratios du fil (carte photo) : 4:5 portrait à 1.91:1 paysage. */
const FEED_MIN_ASPECT = 4 / 5;
const FEED_MAX_ASPECT = 1.91;

export default function CreatePreviewScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  // Consommé une seule fois : un retour sur cet écran sans média repart.
  const [creation] = useState<PendingCreation | null>(() => consumePendingCreation());
  const assets = useMemo(() => creation?.assets ?? [], [creation]);
  const [filter, setFilter] = useState<string | null>(creation?.filter ?? null);
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  // Paramètres avancés, comme Instagram.
  const [commentsDisabled, setCommentsDisabled] = useState(false);
  const [hideLikeCount, setHideLikeCount] = useState(false);
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
  // Carrousel (photos et vidéos mélangées, dans l'ordre choisi). Une seule
  // vidéo lue à la fois : celle de la page visible, les autres en vignette.
  const slides = useMemo(
    () => assets.filter((asset) => asset.kind === 'image' || asset.kind === 'video'),
    [assets],
  );
  const [slideIndex, setSlideIndex] = useState(0);
  // Zone d'aperçu mesurée : le cadre du fil s'y inscrit sans déborder.
  const [area, setArea] = useState({ width: 0, height: 0 });
  const frame = useMemo(() => {
    const first = slides[0];
    const raw = first?.width && first?.height ? first.width / first.height : FEED_MIN_ASPECT;
    const aspect = Math.min(FEED_MAX_ASPECT, Math.max(FEED_MIN_ASPECT, raw));
    if (area.width <= 0 || area.height <= 0) {
      return { width: 0, height: 0 };
    }
    const height = Math.min(area.height, area.width / aspect);
    return { width: Math.round(height * aspect), height: Math.round(height) };
  }, [area, slides]);

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
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(commentsDisabled ? { commentsDisabled: true } : {}),
        ...(hideLikeCount ? { hideLikeCount: true } : {}),
      });
      invalidateFeedCache(token);
      setProgress(null);
      // Retour au fil : la pile de création est remplacée par le résultat.
      router.dismissTo('/');
    } catch (error) {
      console.error('[create:preview] publication échouée', error);
      setPublishing(false);
      setProgress(null);
      setError(fr.social.createPublishError);
    }
  }, [assets, caption, commentsDisabled, filter, hideLikeCount, location, publishing, token, visibility, waitUntilReady]);

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
        <View
          style={styles.mediaArea}
          onLayout={(event) =>
            setArea({
              width: event.nativeEvent.layout.width,
              height: event.nativeEvent.layout.height,
            })
          }>
          {singleVideo ? (
            <PreviewVideo uri={singleVideo.uri} filterKey={filter} muted={false} />
          ) : slides.length > 0 && frame.width > 0 ? (
            // Cadre du fil : ratio du premier média, borné 4:5 – 1.91:1 comme
            // Instagram — ce qui est montré ici est ce qui sera publié.
            <View style={[styles.frame, { width: frame.width, height: frame.height }]}>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                style={{ width: frame.width, height: frame.height }}
                contentContainerStyle={{ width: frame.width * slides.length }}
                onMomentumScrollEnd={(event) =>
                  setSlideIndex(
                    Math.min(
                      slides.length - 1,
                      Math.max(0, Math.round(event.nativeEvent.contentOffset.x / Math.max(1, frame.width))),
                    ),
                  )
                }>
                {slides.map((asset, index) => (
                  <View key={asset.uri} style={{ width: frame.width, height: frame.height }}>
                    {asset.kind === 'video' && index === slideIndex ? (
                      <PreviewVideo uri={asset.uri} filterKey={filter} muted />
                    ) : (
                      <>
                        {asset.kind === 'video' ? (
                          <VideoSlideThumb uri={asset.uri} />
                        ) : (
                          <Image
                            source={{ uri: asset.uri }}
                            style={StyleSheet.absoluteFill}
                            contentFit="cover"
                            accessibilityLabel={asset.name}
                          />
                        )}
                        <MediaFilterOverlay filterKey={filter} />
                      </>
                    )}
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}
          {slides.length > 1 ? (
            <View style={styles.counterPill} pointerEvents="none">
              <ThemedText style={styles.counterText}>
                {fr.social.textPageIndicator(slideIndex + 1, slides.length)}
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

          {/* Lieu, comme Instagram : saisie, suggestions ou position. */}
          <LocationField
            token={token}
            value={location}
            onChange={setLocation}
            disabled={publishing}
            onError={setError}
          />

          {/* Paramètres avancés : J'aime masqués, commentaires désactivés. */}
          <View style={styles.optionsRow}>
            {[
              { key: 'likes', label: fr.social.hideLikeCount, on: hideLikeCount, set: setHideLikeCount },
              { key: 'comments', label: fr.social.turnOffComments, on: commentsDisabled, set: setCommentsDisabled },
            ].map((option) => (
              <Pressable
                key={option.key}
                onPress={() => option.set(!option.on)}
                disabled={publishing}
                accessibilityRole="switch"
                accessibilityState={{ checked: option.on }}
                style={[styles.visibilityChip, option.on && styles.visibilityChipActive]}>
                <ThemedText
                  style={[Type.caption, { color: option.on ? FeedSurface.onMedia : FeedSurface.onMediaSoft }]}>
                  {option.on ? '✓ ' : ''}
                  {option.label}
                </ThemedText>
              </Pressable>
            ))}
          </View>

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

/** Vignette d'une vidéo du carrousel qui n'est pas la page visible. */
function VideoSlideThumb({ uri }: { uri: string }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void VideoThumbnails.getThumbnailAsync(uri, { time: 0 })
      .then((result) => {
        if (!cancelled) {
          setThumb(result.uri);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [uri]);
  return thumb ? (
    <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" />
  ) : (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: MediaSurface.background }]} />
  );
}

/**
 * Lecteur vidéo local pour l'aperçu : boucle, filtre par-dessus. Sans son dans
 * un carrousel (comme le fil), avec le son pour une vidéo seule.
 */
function PreviewVideo({
  uri,
  filterKey,
  muted,
}: {
  uri: string;
  filterKey: string | null;
  muted: boolean;
}) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = muted;
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
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
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
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
