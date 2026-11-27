import { Compass, Images, Play } from 'lucide-react-native';
import { Image } from 'expo-image';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { DiscoverMetrics, MediaSurface, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { discoverFr } from '@/i18n/discover-fr';
import { fr } from '@/i18n/fr';
import { formatCompactCount } from '@/lib/format';
import { resolveMediaUrl } from '@/lib/media-url';
import type { FeedPost } from '@/lib/types';
import { buildExploreRows } from './discover-feed-model';

/** Colonnes de la mosaïque, comme la grille Explorer. */
const COLUMNS = 3;

/**
 * Grille Découvrir présentationnelle : une mosaïque plein écran de contenus
 * média, sans rail ni section.
 *
 * L'état (liste, pagination, rafraîchissement) est géré par
 * `useDiscoverFeed` au niveau de l'écran, pour que la grille et le
 * visionneuse partagent la même liste : une interaction dans le
 * visionneuse met à jour la vignette au retour.
 */
export interface DiscoverExploreGridHandle {
  /** Défile jusqu'à la vignette d'index (retour après le visionneuse). */
  scrollToIndex: (index: number) => void;
}

interface DiscoverExploreGridProps {
  items: FeedPost[];
  status: 'loading' | 'ready' | 'error';
  refreshing: boolean;
  loadingMore: boolean;
  moreError: boolean;
  /** Marge basse à réserver (barre d'onglets + zone sûre). */
  bottomInset: number;
  /** Ouvre le visionneuse sur la publication et sa position. */
  onTilePress: (post: FeedPost, index: number) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onRetryFirst: () => void;
}

/**
 * Mosaïque plein écran de Découvrir, comme la grille Explorer d'Instagram :
 * rangées de trois vignettes aux hauteurs variées (dont des rangées
 * doubles), défilement continu, pas de titre de section ni « Voir tout ».
 */
export const DiscoverExploreGrid = forwardRef<
  DiscoverExploreGridHandle,
  DiscoverExploreGridProps
>(function DiscoverExploreGrid(
  {
    items,
    status,
    refreshing,
    loadingMore,
    moreError,
    bottomInset,
    onTilePress,
    onRefresh,
    onLoadMore,
    onRetryFirst,
  },
  ref,
) {
  const theme = useTheme();
  const { width, height: viewportHeight } = useWindowDimensions();
  // Largeur d'une vignette : largeur écran moins les gouttières, divisée par 3.
  const tileWidth =
    (width - (COLUMNS - 1) * DiscoverMetrics.tileGutter) / COLUMNS;
  const rows = buildExploreRows(items, tileWidth);

  // Marge de déclenchement du « charger plus » avant la fin du contenu.
  const END_REACH_MARGIN = 700;
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  // Hauteur du contenu, pour déclencher le « charger plus » avant la fin.
  const [contentHeight, setContentHeight] = useState(0);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index: number) => {
        const row = Math.floor(index / COLUMNS);
        if (row <= 0) {
          scrollRef.current?.scrollTo({ y: 0, animated: false });
          return;
        }
        // Hauteur cumulée des rangées précédentes + gouttières.
        const offset =
          rows
            .slice(0, row)
            .reduce((total, entry) => total + entry.height, 0) +
          row * DiscoverMetrics.tileGutter;
        scrollRef.current?.scrollTo({ y: Math.max(0, offset), animated: false });
      },
    }),
    [rows],
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement } = event.nativeEvent;
      if (contentHeight === 0) {
        return;
      }
      if (
        contentOffset.y + layoutMeasurement.height >=
        contentHeight - END_REACH_MARGIN
      ) {
        onLoadMore();
      }
    },
    [contentHeight, onLoadMore],
  );

  // Contenu plus court que l'écran : on charge la page suivante d'emblée,
  // sinon la fin du défilement n'est jamais atteinte.
  useEffect(() => {
    if (
      contentHeight > 0 &&
      contentHeight <= viewportHeight &&
      status === 'ready' &&
      items.length > 0
    ) {
      onLoadMore();
    }
  }, [contentHeight, viewportHeight, status, items.length, onLoadMore]);

  if (status === 'error') {
    return (
      <View style={styles.centeredBlock}>
        <EmptyState
          icon={Compass}
          title={discoverFr.errorTitle}
          description={discoverFr.errorBody}
        />
        <Pressable
          accessibilityRole="button"
          onPress={onRetryFirst}
          style={styles.retryButton}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {discoverFr.retry}
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: bottomInset, gap: DiscoverMetrics.tileGutter },
      ]}
      showsVerticalScrollIndicator={false}
      onScroll={onScroll}
      onContentSizeChange={(_width, nextHeight) => setContentHeight(nextHeight)}
      scrollEventThrottle={32}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.accent}
          colors={[theme.accent]}
        />
      }>
      {status === 'loading' && items.length === 0 ? (
        <GridSkeleton tileWidth={tileWidth} />
      ) : (
        rows.map((row, rowIndex) => (
          <View key={row.key} style={styles.row}>
            {row.items.map((post, position) => (
              <PublicationTile
                key={post.id}
                publication={post}
                width={tileWidth}
                height={row.height}
                onPress={() => onTilePress(post, rowIndex * COLUMNS + position)}
              />
            ))}
          </View>
        ))
      )}

      {status === 'ready' && items.length === 0 ? (
        <EmptyState
          icon={Compass}
          title={discoverFr.emptyAllTitle}
          description={discoverFr.emptyAllBody}
        />
      ) : null}

      <View style={styles.sentinel}>
        {loadingMore ? (
          <View style={styles.footer}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : moreError ? (
          <Pressable
            accessibilityRole="button"
            onPress={onLoadMore}
            style={styles.footer}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              {discoverFr.sectionError}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
});

/**
 * Vignette : couverture du média bord à bord, badges discrets (vidéo,
 * album, vues) posés sur l'image. Toutes les métadonnées restent dans la
 * publication, comme sur la grille Explorer.
 */
function PublicationTile({
  publication,
  width,
  height,
  onPress,
}: {
  publication: FeedPost;
  width: number;
  height: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const cover = publication.media?.[0];
  const imageUrl = cover?.posterUrl ?? cover?.lowUrl ?? cover?.url ?? null;
  const imageUri = imageUrl ? resolveMediaUrl(imageUrl) : null;
  const isVideo = publication.kind === 'reel' || cover?.kind === 'video';
  const durationMs = cover?.kind === 'video' ? cover.durationMs : null;
  const views = publication.kind === 'reel' ? publication.counters.views : 0;
  const multiMedia = (publication.media?.length ?? 0) > 1;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fr.social.readPublication(publication.author.displayName)}
      onPress={onPress}
      style={[
        styles.tile,
        {
          width,
          height,
          backgroundColor: theme.backgroundSelected,
        },
      ]}>
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={120}
        />
      ) : (
        <View style={styles.tileFallback}>
          <Icon icon={Compass} size={Spacing.four} color={theme.textSecondary} />
        </View>
      )}
      {isVideo ? (
        <View style={styles.tileTopRight}>
          <View style={[styles.tileBadge, { backgroundColor: MediaSurface.overlay }]}>
            <Icon icon={Play} size={Spacing.three} color={MediaSurface.onSurface} />
            {durationMs ? (
              <ThemedText type="small" style={{ color: MediaSurface.onSurface }}>
                {formatTileDuration(durationMs)}
              </ThemedText>
            ) : null}
          </View>
        </View>
      ) : null}
      {multiMedia ? (
        <View style={styles.tileTopRight}>
          <View style={[styles.tileBadge, { backgroundColor: MediaSurface.overlay }]}>
            <Icon icon={Images} size={Spacing.three} color={MediaSurface.onSurface} />
          </View>
        </View>
      ) : null}
      {views > 0 ? (
        <View
          style={[
            styles.tileBadge,
            styles.tileBottomLeft,
            { backgroundColor: MediaSurface.overlay },
          ]}>
          <ThemedText type="small" style={{ color: MediaSurface.onSurface }}>
            {formatCompactCount(views)}
          </ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Durée « m:ss » d'une vidéo, pour le badge de la vignette. */
function formatTileDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Grille fantôme du premier chargement (pas d'instantané). */
function GridSkeleton({ tileWidth }: { tileWidth: number }) {
  const theme = useTheme();
  return (
    <View style={styles.skeleton}>
      {[0, 1, 2].map((row) => (
        <View key={row} style={styles.row}>
          {[0, 1, 2].map((cell) => (
            <View
              key={cell}
              style={{
                width: tileWidth,
                height: tileWidth,
                backgroundColor: theme.backgroundSelected,
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    gap: DiscoverMetrics.tileGutter,
  },
  tile: {
    overflow: 'hidden',
    borderRadius: Radii.sm,
  },
  tileFallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTopRight: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.one,
  },
  tileBottomLeft: {
    position: 'absolute',
    bottom: Spacing.one,
    left: Spacing.one,
  },
  tileBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.half,
  },
  skeleton: {
    gap: DiscoverMetrics.tileGutter,
    paddingVertical: Spacing.one,
  },
  centeredBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  retryButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: Spacing.four,
  },
  sentinel: {
    minHeight: 1,
  },
});
