import { router, Stack } from 'expo-router';
import { Camera, ChevronRight, Images, Play, Type, X } from 'lucide-react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  View,
  type ListRenderItem,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedSurface, Radii, Spacing } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { useAuth } from '@/lib/auth-context';
import { setPendingCreation } from '@/lib/pending-creation';
import { MAX_PUBLICATION_MEDIA } from '@/features/media/mediaLimits';
import {
  isRejectedMedia,
  pickLibraryMedia,
  type PickedAttachment,
} from '@/features/media/pickMedia';
import {
  assetToPicked,
  useCreateLibrary,
} from '@/features/social/create/use-create-library';

/**
 * Sélecteur « Créer » façon Instagram : le bouton + ouvre directement la
 * photothèque (grille « Récentes »), avec un sélecteur de type en bas —
 * Tout ou Photo (multi-sélection, carrousel), Vidéo (une seule) ou Texte (qui mène au
 * compositeur). « Tout » mélange photos et vidéos dans un carrousel (10 max).
 * La caméra reste accessible en haut à droite.
 */

// « Tout » : photos et vidéos mélangées dans un même carrousel, comme
// Instagram. « Vidéo » reste une vidéo seule (publiée façon Reels).
type Segment = 'all' | 'photo' | 'video';

const THUMB_CACHE_LIMIT = 300;
const thumbCache = new Map<string, string>();

function videoThumbnail(uri: string): Promise<string | null> {
  const cached = thumbCache.get(uri);
  if (cached) {
    return Promise.resolve(cached);
  }
  return VideoThumbnails.getThumbnailAsync(uri, { time: 0 })
    .then((result) => {
      if (thumbCache.size >= THUMB_CACHE_LIMIT) {
        const oldest = thumbCache.keys().next().value;
        if (oldest) {
          thumbCache.delete(oldest);
        }
      }
      thumbCache.set(uri, result.uri);
      return result.uri;
    })
    .catch(() => null);
}

function VideoCellThumb({ uri }: { uri: string }) {
  const [thumb, setThumb] = useState<string | null>(thumbCache.get(uri) ?? null);
  useEffect(() => {
    if (thumb) {
      return;
    }
    let cancelled = false;
    void videoThumbnail(uri).then((result) => {
      if (!cancelled && result) {
        setThumb(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [uri, thumb]);
  if (!thumb) {
    return <View style={styles.cellVideoFallback} />;
  }
  return <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" />;
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function CreatePickerScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = useState<Segment>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const requestedRef = useRef(false);

  const library = useCreateLibrary(segment);
  const { permission, requestPermission } = library;

  // La permission est demandée à l'ouverture, comme la photothèque IG.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain && !requestedRef.current) {
      requestedRef.current = true;
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const resetSelection = useCallback(() => setSelected([]), []);

  const changeSegment = useCallback(
    (next: Segment) => {
      if (next !== segment) {
        setSegment(next);
        resetSelection();
      }
    },
    [segment, resetSelection],
  );

  const openText = useCallback(() => router.push('/create/text'), []);
  const openCamera = useCallback(() => router.push('/create/camera'), []);

  const toggleAsset = useCallback(
    (asset: MediaLibrary.Asset) => {
      setSelected((previous) => {
        if (segment === 'video') {
          return previous[0] === asset.id ? [] : [asset.id];
        }
        if (previous.includes(asset.id)) {
          return previous.filter((id) => id !== asset.id);
        }
        if (previous.length >= MAX_PUBLICATION_MEDIA) {
          Alert.alert(
            fr.social.createMediaErrorTitle,
            fr.social.createMaxSelection(MAX_PUBLICATION_MEDIA),
          );
          return previous;
        }
        return [...previous, asset.id];
      });
    },
    [segment],
  );

  /** Sélection → aperçu de publication (upload + légende + filtre). */
  const goNext = useCallback(async () => {
    if (!token || publishing || selected.length === 0) {
      return;
    }
    setPublishing(true);
    try {
      const chosen = library.assets.filter((asset) => selected.includes(asset.id));
      const results = await Promise.all(chosen.map(assetToPicked));
      const rejected = results.filter(isRejectedMedia);
      const files: PickedAttachment[] = results.filter(
        (result): result is PickedAttachment => !isRejectedMedia(result),
      );
      if (files.length === 0) {
        Alert.alert(fr.social.createMediaErrorTitle, fr.social.createMediaErrorBody);
        return;
      }
      if (rejected.length > 0) {
        Alert.alert(fr.social.createMediaErrorTitle, rejected[0].reason);
      }
      setPendingCreation({ assets: files, filter: null });
      router.push('/create/preview');
    } finally {
      setPublishing(false);
    }
  }, [library.assets, publishing, selected, token]);

  /** Repli : le sélecteur système, qui fonctionne sans permission bibliothèque. */
  const pickFromSystem = useCallback(async () => {
    if (!token || publishing) {
      return;
    }
    setPublishing(true);
    try {
      const result = await pickLibraryMedia(MAX_PUBLICATION_MEDIA);
      if (!result) {
        return;
      }
      const files = result.files.filter(
        (asset) => asset.kind === 'image' || asset.kind === 'video',
      );
      if (files.length === 0) {
        Alert.alert(fr.social.createMediaErrorTitle, fr.social.createMediaErrorBody);
        return;
      }
      setPendingCreation({ assets: files, filter: null });
      router.push('/create/preview');
    } catch {
      Alert.alert(fr.social.createPublishErrorTitle, fr.social.createPublishError);
    } finally {
      setPublishing(false);
    }
  }, [publishing, token]);

  const renderCell = useCallback<ListRenderItem<MediaLibrary.Asset>>(
    ({ item }) => {
      const isVideo = item.mediaType === 'video' || item.mediaType === 'pairedVideo';
      const order = selected.indexOf(item.id);
      const isSelected = order >= 0;
      return (
        <Pressable
          onPress={() => toggleAsset(item)}
          accessibilityRole="imagebutton"
          accessibilityLabel={item.filename}
          accessibilityState={{ selected: isSelected }}
          style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}>
          {isVideo ? (
            <VideoCellThumb uri={item.uri} />
          ) : (
            <Image source={{ uri: item.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          )}
          {isVideo ? (
            <>
              <View style={styles.playBadge}>
                <Icon icon={Play} size={12} color="#FFFFFF" />
              </View>
              {item.duration > 0 ? (
                <View style={styles.durationBadge}>
                  <ThemedText type="micro" style={styles.badgeText}>
                    {formatDuration(item.duration)}
                  </ThemedText>
                </View>
              ) : null}
            </>
          ) : null}
          {isSelected ? (
            <>
              <View style={styles.selectedRing} />
              <View style={styles.orderBadge}>
                <ThemedText type="micro" style={styles.orderText}>
                  {segment !== 'video' && selected.length > 1 ? order + 1 : ''}
                </ThemedText>
              </View>
            </>
          ) : null}
        </Pressable>
      );
    },
    [selected, segment, toggleAsset],
  );

  const keyExtractor = useCallback((asset: MediaLibrary.Asset) => asset.id, []);

  const cellSeparator = useCallback(() => <View style={{ height: 2 }} />, []);

  const granted = permission?.granted === true;
  const canAskAgain = permission?.canAskAgain === true;

  const header = useMemo(
    () => (
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.two }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={fr.social.back}
          style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}>
          <Icon icon={X} size={20} color={FeedSurface.onMedia} />
        </Pressable>
        <ThemedText type="smallBold" style={styles.topTitle} numberOfLines={1}>
          {fr.social.createLibraryTitle}
        </ThemedText>
        <Pressable
          onPress={openCamera}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={fr.social.createPhoto}
          style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}>
          <Icon icon={Camera} size={19} color={FeedSurface.onMedia} />
        </Pressable>
      </View>
    ),
    [insets.top, openCamera],
  );

  const footer = useMemo(
    () => (
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, Spacing.two) }]}>
        <View style={styles.segment} accessibilityRole="tablist">
          {(
            [
              { id: 'all', label: fr.social.createAll },
              { id: 'photo', label: fr.social.createPhoto },
              { id: 'video', label: fr.social.createVideo },
            ] as const
          ).map((entry) => {
            const active = segment === entry.id;
            return (
              <Pressable
                key={entry.id}
                onPress={() => changeSegment(entry.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.segmentButton, active && styles.segmentButtonActive]}>
                <ThemedText
                  type="smallBold"
                  style={active ? styles.onSurface : styles.onSurfaceSoft}>
                  {entry.label}
                </ThemedText>
              </Pressable>
            );
          })}
          <Pressable
            onPress={openText}
            accessibilityRole="button"
            accessibilityLabel={fr.social.createTextOption}
            style={({ pressed }) => [styles.segmentButton, styles.segmentButtonText, pressed && styles.pressed]}>
            <Icon icon={Type} size={13} color={FeedSurface.onMediaSoft} />
            <ThemedText type="smallBold" style={styles.onSurfaceSoft}>
              {fr.social.createTextOption}
            </ThemedText>
          </Pressable>
        </View>

        {selected.length > 0 ? (
          <Pressable
            onPress={() => void goNext()}
            disabled={publishing}
            accessibilityRole="button"
            accessibilityLabel={fr.social.createNext}
            style={({ pressed }) => [
              styles.nextButton,
              pressed && styles.pressed,
              publishing && styles.disabled,
            ]}>
            {publishing ? (
              <ActivityIndicator size="small" color={FeedSurface.background} />
            ) : (
              <>
                <ThemedText type="smallBold" style={styles.nextText}>
                  {fr.social.createNext}
                </ThemedText>
                <Icon icon={ChevronRight} size={16} color={FeedSurface.background} />
              </>
            )}
          </Pressable>
        ) : null}
      </View>
    ),
    [
      changeSegment,
      goNext,
      insets.bottom,
      openText,
      publishing,
      segment,
      selected.length,
    ],
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false, statusBarStyle: 'light' }} />
      {header}

      {!granted ? (
        <View style={styles.statePane}>
          {permission === null ? (
            <ActivityIndicator color={FeedSurface.onMedia} />
          ) : (
            <>
              <View style={styles.stateIcon}>
                <Icon icon={Images} size={30} color={FeedSurface.onMedia} />
              </View>
              <ThemedText type="sectionTitle" style={styles.onSurface}>
                {fr.social.createLibraryPermissionTitle}
              </ThemedText>
              <ThemedText type="small" style={styles.onSurfaceSoftCenter}>
                {canAskAgain
                  ? fr.social.createLibraryPermissionBody
                  : fr.social.createLibraryDenied}
              </ThemedText>
              <View style={styles.stateActions}>
                <Pressable
                  onPress={() => {
                    if (canAskAgain) {
                      void requestPermission();
                    } else {
                      void Linking.openSettings();
                    }
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.stateAction, pressed && styles.pressed]}>
                  <ThemedText type="smallBold" style={styles.onSurface}>
                    {canAskAgain ? fr.social.createAllowAccess : fr.common.openSettings}
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => void pickFromSystem()}
                  disabled={publishing}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.stateActionGhost,
                    pressed && styles.pressed,
                    publishing && styles.disabled,
                  ]}>
                  <ThemedText type="smallBold" style={styles.onSurface}>
                    {fr.social.createLibraryFallback}
                  </ThemedText>
                </Pressable>
              </View>
            </>
          )}
        </View>
      ) : library.assets.length === 0 && !library.loading ? (
        <View style={styles.statePane}>
          <ThemedText type="small" style={styles.onSurfaceSoftCenter}>
            {fr.social.createLibraryEmpty}
          </ThemedText>
          <Pressable
            onPress={() => void pickFromSystem()}
            disabled={publishing}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.stateActionGhost,
              pressed && styles.pressed,
              publishing && styles.disabled,
            ]}>
            <ThemedText type="smallBold" style={styles.onSurface}>
              {fr.social.createLibraryFallback}
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={library.assets}
          keyExtractor={keyExtractor}
          renderItem={renderCell}
          numColumns={3}
          columnWrapperStyle={styles.cellRow}
          ItemSeparatorComponent={cellSeparator}
          onEndReached={library.loadMore}
          onEndReachedThreshold={0.6}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.gridContent}
          removeClippedSubviews
          initialNumToRender={24}
          windowSize={7}
        />
      )}

      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: FeedSurface.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.two,
  },
  topTitle: { color: FeedSurface.onMedia, fontWeight: '700' },
  roundButton: {
    width: 38,
    height: 38,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FeedSurface.glass,
  },
  gridContent: { paddingBottom: Spacing.four },
  cellRow: { gap: 2 },
  cell: {
    flex: 1,
    aspectRatio: 1,
    overflow: 'hidden',
    backgroundColor: FeedSurface.glass,
  },
  cellPressed: { opacity: 0.7 },
  cellVideoFallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#1A1A20',
  },
  playBadge: {
    position: 'absolute',
    top: Spacing.one,
    left: Spacing.one,
    width: 20,
    height: 20,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  durationBadge: {
    position: 'absolute',
    bottom: Spacing.one,
    right: Spacing.one,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: Radii.xs,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  badgeText: { color: '#FFFFFF' },
  selectedRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 3,
    borderColor: FeedSurface.accent,
  },
  orderBadge: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.one,
    minWidth: 20,
    height: 20,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    backgroundColor: FeedSurface.accent,
  },
  orderText: { color: '#FFFFFF' },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: FeedSurface.onMediaFaint,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    padding: 3,
    borderRadius: Radii.full,
    backgroundColor: FeedSurface.glass,
  },
  segmentButton: {
    minHeight: 32,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentButtonActive: { backgroundColor: FeedSurface.glassStrong },
  segmentButtonText: { flexDirection: 'row', gap: 4 },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: 38,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.full,
    backgroundColor: FeedSurface.accent,
  },
  nextText: { color: FeedSurface.background },
  statePane: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.five,
  },
  stateIcon: {
    width: 64,
    height: 64,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FeedSurface.glass,
  },
  stateActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  stateAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    borderRadius: Radii.full,
    backgroundColor: FeedSurface.accent,
  },
  stateActionGhost: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: FeedSurface.onMediaFaint,
  },
  onSurface: { color: FeedSurface.onMedia },
  onSurfaceSoft: { color: FeedSurface.onMediaSoft },
  onSurfaceSoftCenter: { color: FeedSurface.onMediaSoft, textAlign: 'center' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.6 },
});
