import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { FeedSurface, Spacing, Type } from '@/constants/theme';
import { OnMediaShadow } from './feed-tokens';
import type { FeedPageChrome } from './video-page';
import type { FeedPost } from '@/lib/types';

/**
 * Page d'une publication sans média : le texte du post occupe l'écran, sur le
 * même noir que les autres pages, pour que le pager garde un rythme constant.
 */
export function TextPage({
  post,
  chrome,
}: {
  post: FeedPost;
  chrome: FeedPageChrome;
}) {
  return (
    <View style={[styles.page, { height: chrome.height }]}>
      <ThemedText style={[styles.text, OnMediaShadow]}>{post.caption}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: FeedSurface.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  text: {
    ...Type.sectionTitle,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    color: FeedSurface.onMedia,
    textAlign: 'center',
  },
});
