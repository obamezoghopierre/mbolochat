import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { PostOverlay } from './post-overlay';
import { extraMediaCount, primaryMedia } from './feed-media';
import type { FeedPost } from '@/lib/types';

/** Page plein écran d'une publication photo ou carrousel. */
export function ImagePage({
  post,
  height,
  onToggleLike,
  onOpenComments,
  onOpenProfile,
}: {
  post: FeedPost;
  height: number;
  onToggleLike: (post: FeedPost) => void;
  onOpenComments: () => void;
  onOpenProfile: () => void;
}) {
  const media = primaryMedia(post);
  const extra = extraMediaCount(post);

  return (
    <View style={[styles.page, { height }]}>
      {media?.url ? (
        <Image
          source={{ uri: media.url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={120}
          accessibilityLabel={media.altText ?? post.caption ?? undefined}
        />
      ) : null}

      <Pressable
        onPress={onOpenComments}
        accessibilityRole="button"
        accessibilityLabel="Ouvrir les commentaires"
        style={StyleSheet.absoluteFill}
      />

      {extra > 0 ? (
        <View style={styles.counterPill}>
          <ThemedText type="small" style={styles.counterText}>
            1 / {extra + 1}
          </ThemedText>
        </View>
      ) : null}

      <PostOverlay
        post={post}
        onToggleLike={onToggleLike}
        onOpenComments={onOpenComments}
        onOpenProfile={onOpenProfile}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#000000',
  },
  counterPill: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.three,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  counterText: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
