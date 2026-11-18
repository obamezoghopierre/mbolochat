import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { FeedSurface, Radii, Spacing } from '@/constants/theme';
import { FeedGestureLayer } from './feed-gestures';
import { HeartBurstOverlay } from './heart-burst';
import { OnMediaShadow, feedText } from './feed-tokens';
import type { FeedPageChrome } from './video-page';
import { resolveMediaUrl } from '@/lib/media-url';
import type { FeedPost } from '@/lib/types';

/**
 * Page photo ou carrousel, plein écran. Un tap passe à l'image suivante
 * (retour à la première après la dernière), le double-tap réagit — exactement
 * le comportement d'un carrousel TikTok.
 *
 * Le compteur `1/3` apparaît en haut à droite dès qu'il y a plusieurs médias.
 */
export function ImagePage({
  post,
  chrome,
  onDoubleTapLike,
}: {
  post: FeedPost;
  chrome: FeedPageChrome;
  onDoubleTapLike: () => void;
}) {
  // L'API renvoie des chemins signés relatifs : `<Image>` exige une URL
  // absolue, sinon le post s'affiche avec un média vide.
  const media = (post.media ?? [])
    .map((entry) => ({ ...entry, url: resolveMediaUrl(entry.url) }))
    .filter((entry) => Boolean(entry.url));
  const [index, setIndex] = useState(0);
  const current = media[index] ?? media[0];
  const total = media.length;

  const next = useCallback(() => {
    if (total > 1) {
      setIndex((value) => (value + 1) % total);
    }
  }, [total]);

  return (
    <View style={[styles.page, { height: chrome.height }]}>
      {current?.url ? (
        <Image
          source={{ uri: current.url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={120}
          accessibilityLabel={current.altText ?? post.caption ?? undefined}
        />
      ) : null}

      <FeedGestureLayer
        accessibilityLabel={
          total > 1
            ? `Photo ${index + 1} sur ${total} : deux taps pour réagir, un tap pour la suivante`
            : 'Photo : deux taps pour réagir'
        }
        onDoubleTap={onDoubleTapLike}
        onTap={next}
        onLongPressStart={noop}
        onLongPressEnd={noop}
      />

      <HeartBurstOverlay burstKey={chrome.burstKey} point={chrome.burstPoint} />

      {total > 1 && !chrome.hideOverlays ? (
        <View style={styles.counterPill}>
          <ThemedText style={[feedText.pill, OnMediaShadow]}>
            {index + 1} / {total}
          </ThemedText>
        </View>
      ) : null}

      {/* Points de pagination, comme TikTok : lisibles sans interaction. */}
      {total > 1 && !chrome.hideOverlays ? (
        <View style={styles.dots} pointerEvents="none">
          {media.map((entry, dotIndex) => (
            <View
              key={entry.assetId}
              style={[styles.dot, dotIndex === index && styles.dotActive]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function noop() {}

const styles = StyleSheet.create({
  page: {
    backgroundColor: FeedSurface.background,
  },
  counterPill: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.three,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  dots: {
    position: 'absolute',
    top: Spacing.three,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  dotActive: {
    backgroundColor: FeedSurface.onMedia,
  },
});
