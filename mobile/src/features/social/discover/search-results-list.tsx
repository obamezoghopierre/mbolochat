import { memo, useCallback, type ReactElement } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { DiscoverMetrics, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { discoverFr } from '@/i18n/discover-fr';
import { fr } from '@/i18n/fr';
import type { FeedPost, SearchHashtag } from '@/lib/types';
import { PublicationTile } from './discover-explore-grid';
import {
  SEARCH_TILE_COLUMNS,
  type SearchBlockKey,
  type SearchEntry,
} from './search-model';
import { SearchUserRow } from './search-user-row';

const SECTION_TITLES: Record<SearchBlockKey, string> = {
  users: fr.social.discoverUsers,
  publications: fr.social.discoverPublications,
  hashtags: fr.social.discoverHashtags,
};

/**
 * Résultats de la recherche : une seule liste virtualisée qui porte les
 * titres, les comptes, la grille de publications et les hashtags.
 *
 * Les publications sont des vignettes (mêmes que la mosaïque : double-tap
 * pour réagir, appui long pour le menu, appui pour la visionneuse) ; les
 * onglets restent collés en haut ; un onglet précis charge la suite en
 * défilant, par curseur.
 */
export function SearchResultsList({
  entries,
  header,
  bottomInset,
  loadingMore,
  moreError,
  onEndReached,
  onOpenProfile,
  onOpenPost,
  onPickHashtag,
  onSeeAll,
  onTileDoubleTapLike,
  onTileLongPress,
}: {
  entries: SearchEntry[];
  /** Onglets de filtre, collés en haut de la liste. */
  header: ReactElement;
  bottomInset: number;
  loadingMore: boolean;
  moreError: boolean;
  onEndReached: () => void;
  onOpenProfile: (id: string) => void;
  /** Ouvre la visionneuse sur la publication d'index `index`. */
  onOpenPost: (post: FeedPost, index: number) => void;
  onPickHashtag: (tag: SearchHashtag) => void;
  onSeeAll: (block: SearchBlockKey) => void;
  onTileDoubleTapLike: (post: FeedPost) => void;
  onTileLongPress: (post: FeedPost, index: number) => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const tileWidth =
    (width - (SEARCH_TILE_COLUMNS - 1) * DiscoverMetrics.tileGutter) /
    SEARCH_TILE_COLUMNS;

  const handleLongPress = useCallback(
    (post: FeedPost, index: number) => onTileLongPress(post, index),
    [onTileLongPress],
  );

  const renderItem = useCallback(
    ({ item }: { item: SearchEntry }) => {
      if (item.kind === 'section') {
        return (
          <View style={styles.sectionHeader}>
            <ThemedText style={styles.sectionTitle}>
              {SECTION_TITLES[item.block]}
            </ThemedText>
            {item.seeAll ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${discoverFr.seeAll} — ${SECTION_TITLES[item.block]}`}
                onPress={() => onSeeAll(item.block)}
                hitSlop={Spacing.two}>
                <ThemedText type="smallBold" style={{ color: theme.accent }}>
                  {discoverFr.seeAll}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        );
      }
      if (item.kind === 'user') {
        return (
          <SearchUserRow account={item.account} onOpenProfile={onOpenProfile} />
        );
      }
      if (item.kind === 'tiles') {
        return (
          <View style={styles.tilesRow}>
            {item.tiles.map(({ post, index }) => (
              <PublicationTile
                key={post.id}
                publication={post}
                width={tileWidth}
                height={tileWidth}
                index={index}
                onPress={onOpenPost}
                onDoubleTapLike={onTileDoubleTapLike}
                onLongPress={handleLongPress}
              />
            ))}
          </View>
        );
      }
      return (
        <HashtagRow tag={item.tag} onPress={onPickHashtag} />
      );
    },
    [
      theme.accent,
      tileWidth,
      onSeeAll,
      onOpenProfile,
      onOpenPost,
      onPickHashtag,
      onTileDoubleTapLike,
      handleLongPress,
    ],
  );

  return (
    <FlatList
      data={entries}
      keyExtractor={(entry) => entry.key}
      renderItem={renderItem}
      ListHeaderComponent={
        <View style={{ backgroundColor: theme.background }}>{header}</View>
      }
      stickyHeaderIndices={[0]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: bottomInset }}
      initialNumToRender={DiscoverMetrics.initialRows}
      windowSize={DiscoverMetrics.windowSize}
      maxToRenderPerBatch={DiscoverMetrics.renderBatch}
      onEndReached={onEndReached}
      onEndReachedThreshold={DiscoverMetrics.endReachScreens}
      ListFooterComponent={
        <View style={styles.footer}>
          {loadingMore ? (
            <ActivityIndicator color={theme.accent} />
          ) : moreError ? (
            <Pressable accessibilityRole="button" onPress={onEndReached}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                {discoverFr.sectionError}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      }
    />
  );
}

const HashtagRow = memo(function HashtagRow({
  tag,
  onPress,
}: {
  tag: SearchHashtag;
  onPress: (tag: SearchHashtag) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(tag)}
      accessibilityRole="button"
      style={styles.hashtagRow}>
      <ThemedText style={styles.hashtagName}>#{tag.tag}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {tag.usageCount} {fr.social.discoverUses}
      </ThemedText>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
  sectionTitle: {
    ...Type.sectionTitle,
  },
  tilesRow: {
    flexDirection: 'row',
    gap: DiscoverMetrics.tileGutter,
    marginBottom: DiscoverMetrics.tileGutter,
  },
  hashtagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  hashtagName: {
    ...Type.body,
    fontWeight: '600',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
  },
});
