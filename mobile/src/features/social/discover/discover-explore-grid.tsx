import { router } from 'expo-router';
import { Compass, Images, Play } from 'lucide-react-native';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { DiscoverMetrics, MediaSurface, Radii, Spacing } from '@/constants/theme';
import {
  loadDiscoverSection,
  type DiscoverPublication,
  type DiscoverSectionPage,
} from '@/features/social/discover/discover-api';
import { saveDiscoverSnapshot } from '@/features/social/discover/discover-snapshot';
import { useTheme } from '@/hooks/use-theme';
import { discoverFr } from '@/i18n/discover-fr';
import { fr } from '@/i18n/fr';
import { formatCompactCount } from '@/lib/format';
import { resolveMediaUrl } from '@/lib/media-url';

/** Colonnes de la mosaïque, comme la grille Explorer. */
const COLUMNS = 3;
/** Vignettes par page ; l'API borne à 50. */
const PAGE_SIZE = 30;

/** Largeur d'une vignette : largeur écran moins les gouttières, divisée par 3. */
function useTileSize(): number {
  const { width } = useWindowDimensions();
  return (width - (COLUMNS - 1) * DiscoverMetrics.tileGutter) / COLUMNS;
}

/** Durée « m:ss » d'une vidéo, pour le badge de la vignette. */
function formatTileDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface DiscoverExploreGridProps {
  token: string;
  /** Compte courant : clé de l'instantané local. */
  userId: string | null;
  /** Première page mise en cache, affichée avant le réseau. */
  initialPage: DiscoverSectionPage | null;
  /** Marge basse à réserver (barre d'onglets + zone sûre). */
  bottomInset: number;
}

/**
 * Mosaïque plein écran de Découvrir : une seule grille continue de contenus
 * média (jamais de publications texte, filtrées côté API), sans titre de
 * section ni « Voir tout ». Le tap ouvre la publication ; le défilement
 * charge la page suivante (curseur de session figé côté serveur).
 */
export function DiscoverExploreGrid({
  token,
  userId,
  initialPage,
  bottomInset,
}: DiscoverExploreGridProps) {
  const theme = useTheme();
  const tileSize = useTileSize();

  const [items, setItems] = useState<DiscoverPublication[]>(
    initialPage?.items ?? [],
  );
  const [cursor, setCursor] = useState<string | null>(
    initialPage?.nextCursor ?? null,
  );
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    initialPage ? 'ready' : 'loading',
  );
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  // Identifiant de requête : la réponse la plus récente gagne (un
  // rafraîchissement pendant un « charger plus » ne mélange pas les pages).
  const requestSeq = useRef(0);

  // Aucun setState synchrone ici : seuls les callbacks réseau en posent.
  const requestFirst = useCallback(() => {
    const seq = ++requestSeq.current;
    return loadDiscoverSection(token, 'popular', undefined, PAGE_SIZE)
      .then((page) => {
        if (seq !== requestSeq.current) {
          return;
        }
        setItems(page.items);
        setCursor(page.nextCursor);
        setMoreError(false);
        setStatus('ready');
        saveDiscoverSnapshot(userId, page);
      })
      .catch(() => {
        if (seq === requestSeq.current) {
          // Une grille déjà affichée (instantané) reste préférable à l'erreur.
          setStatus((current) => (current === 'ready' ? current : 'error'));
        }
      });
  }, [token, userId]);

  useEffect(() => {
    void requestFirst();
  }, [requestFirst]);

  const refresh = () => {
    setRefreshing(true);
    void requestFirst().finally(() => setRefreshing(false));
  };

  const retryFirst = () => {
    setStatus('loading');
    void requestFirst();
  };

  const loadMore = async () => {
    if (!cursor || loadingMore || refreshing) {
      return;
    }
    const seq = requestSeq.current;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await loadDiscoverSection(token, 'popular', cursor, PAGE_SIZE);
      if (seq !== requestSeq.current) {
        return;
      }
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !known.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      if (seq === requestSeq.current) {
        setMoreError(true);
      }
    } finally {
      if (seq === requestSeq.current) {
        setLoadingMore(false);
      }
    }
  };

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
          onPress={retryFirst}
          style={styles.retryButton}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {discoverFr.retry}
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      numColumns={COLUMNS}
      columnWrapperStyle={styles.row}
      contentContainerStyle={{ paddingBottom: bottomInset, gap: DiscoverMetrics.tileGutter }}
      showsVerticalScrollIndicator={false}
      initialNumToRender={COLUMNS * 4}
      maxToRenderPerBatch={COLUMNS * 4}
      windowSize={9}
      onEndReached={() => void loadMore()}
      onEndReachedThreshold={0.7}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={theme.accent}
          colors={[theme.accent]}
        />
      }
      ListEmptyComponent={
        status === 'loading' ? <GridSkeleton tileSize={tileSize} /> : (
          <EmptyState
            icon={Compass}
            title={discoverFr.emptyAllTitle}
            description={discoverFr.emptyAllBody}
          />
        )
      }
      ListFooterComponent={
        loadingMore ? (
          <View style={styles.footer}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : moreError ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadMore()}
            style={styles.footer}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              {discoverFr.sectionError}
            </ThemedText>
          </Pressable>
        ) : undefined
      }
      renderItem={({ item }) => (
        <PublicationTile publication={item} size={tileSize} />
      )}
    />
  );
}

/**
 * Vignette : couverture du média bord à bord, badges discrets (vidéo, album,
 * vues) posés sur l'image. Toutes les métadonnées restent dans la publication.
 */
function PublicationTile({
  publication,
  size,
}: {
  publication: DiscoverPublication;
  size: number;
}) {
  const theme = useTheme();
  const cover = publication.media[0];
  const imageUrl = cover?.posterUrl ?? cover?.lowUrl ?? cover?.url;
  const imageUri = imageUrl ? resolveMediaUrl(imageUrl) : null;
  const isVideo = publication.kind === 'reel' || cover?.kind === 'video';
  const durationMs = cover?.kind === 'video' ? cover.durationMs : null;
  const views = publication.kind === 'reel' ? publication.counters.views : 0;
  const multiMedia = publication.media.length > 1;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fr.social.readPublication(publication.author.displayName)}
      onPress={() => router.push(`/post/${publication.id}`)}
      style={[
        styles.tile,
        {
          width: size,
          height: size,
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
        <View style={[styles.tileBadge, styles.tileBottomLeft, { backgroundColor: MediaSurface.overlay }]}>
          <ThemedText type="small" style={{ color: MediaSurface.onSurface }}>
            {formatCompactCount(views)}
          </ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Grille fantôme du premier chargement (pas d'instantané). */
function GridSkeleton({ tileSize }: { tileSize: number }) {
  const theme = useTheme();
  return (
    <View style={styles.skeleton}>
      {[0, 1, 2].map((row) => (
        <View key={row} style={styles.row}>
          {[0, 1, 2].map((cell) => (
            <View
              key={cell}
              style={{
                width: tileSize,
                height: tileSize,
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
  row: {
    flexDirection: 'row',
    gap: DiscoverMetrics.tileGutter,
  },
  tile: {
    overflow: 'hidden',
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
  },
  centeredBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: Spacing.four,
  },
  retryButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
