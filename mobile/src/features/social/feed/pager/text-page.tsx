import { StyleSheet, View } from 'react-native';

import { PostCard } from '../post-card';
import { Spacing } from '@/constants/theme';
import type { FeedPost } from '@/lib/types';

/**
 * Repli pour une publication sans média : la carte habituelle, centrée sur le
 * fond sombre du pager, pour ne pas perdre le contenu texte existant.
 */
export function TextPage({
  post,
  height,
  onToggleLike,
  onOpen,
  onOpenProfile,
}: {
  post: FeedPost;
  height: number;
  onToggleLike: (post: FeedPost) => void;
  onOpen: () => void;
  onOpenProfile: () => void;
}) {
  return (
    <View style={[styles.page, { height }]}>
      <PostCard
        post={post}
        onToggleLike={onToggleLike}
        onPress={onOpen}
        onPressAuthor={onOpenProfile}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#0B0F14',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
});
