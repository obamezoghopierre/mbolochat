import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { isVideoPost, primaryMedia } from './feed-media';
import { ImagePage } from './image-page';
import { TextPage } from './text-page';
import { VideoPage } from './video-page';
import type { FeedPost } from '@/lib/types';

/**
 * Pager vertical plein écran façon Mbolo : une publication par écran, snap
 * exact sur la hauteur visible, seuls les voisins immédiats sont montés.
 *
 * Implémenté avec `FlatList` paginée plutôt que `react-native-pager-view` :
 * aucune dépendance native en plus, donc chargeable sur le dev client existant.
 */
export function FeedPager({
  items,
  height,
  onToggleLike,
  onLoadMore,
}: {
  items: FeedPost[];
  height: number;
  onToggleLike: (post: FeedPost) => void;
  onLoadMore: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 60 }), []);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
      const first = viewableItems[0];
      if (first?.index !== null && first?.index !== undefined) {
        setActiveIndex(first.index);
      }
    },
    [],
  );

  const openComments = useCallback((post: FeedPost) => {
    router.push(`/post/${post.id}`);
  }, []);

  const openProfile = useCallback((post: FeedPost) => {
    router.push(`/user/${post.author.id}`);
  }, []);

  if (height <= 0) {
    return <View style={styles.flex} />;
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      style={styles.flex}
      pagingEnabled
      showsVerticalScrollIndicator={false}
      decelerationRate="fast"
      snapToInterval={height}
      snapToAlignment="start"
      getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      windowSize={3}
      initialNumToRender={1}
      maxToRenderPerBatch={2}
      removeClippedSubviews
      onEndReached={onLoadMore}
      onEndReachedThreshold={0.5}
      renderItem={({ item, index }) => {
        const isActive = index === activeIndex;
        if (isVideoPost(item)) {
          return (
            <VideoPage
              post={item}
              height={height}
              isActive={isActive}
              onToggleLike={onToggleLike}
              onOpenComments={() => openComments(item)}
              onOpenProfile={() => openProfile(item)}
            />
          );
        }
        if (primaryMedia(item)) {
          return (
            <ImagePage
              post={item}
              height={height}
              onToggleLike={onToggleLike}
              onOpenComments={() => openComments(item)}
              onOpenProfile={() => openProfile(item)}
            />
          );
        }
        return (
          <TextPage
            post={item}
            height={height}
            onToggleLike={onToggleLike}
            onOpen={() => openComments(item)}
            onOpenProfile={() => openProfile(item)}
          />
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
