import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Play, Volume2, VolumeX } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedSurface, Radii, Spacing } from '@/constants/theme';
import { MediaFilterOverlay } from '@/features/media/media-filter';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { resolveMediaUrl } from '@/lib/media-url';
import type { FeedPost } from '@/lib/types';

/** Ratios extrêmes acceptés par Instagram : 4:5 (portrait) à 1.91:1 (paysage). */
const MIN_ASPECT = 4 / 5;
const MAX_ASPECT = 1.91;

/**
 * Carrousel complet d'une publication (photos et vidéos, dans l'ordre), pour
 * la page de détail. Même cadrage que le fil : ratio du premier média, borné
 * entre 4:5 et 1.91:1. On glisse d'un média à l'autre ; badge « 2/5 » et
 * points sous le média.
 *
 * Une seule vidéo vivante : celle de la page visible, sans son au départ
 * (tap pour le son). Les autres vidéos montrent leur poster.
 */
export function PostMediaCarousel({ post }: { post: FeedPost }) {
  const theme = useTheme();
  const media = useMemo(
    () =>
      (post.media ?? [])
        .filter((entry) => entry.kind === 'image' || entry.kind === 'video')
        .map((entry) => ({
          ...entry,
          url: resolveMediaUrl(entry.url),
          posterUrl: resolveMediaUrl(entry.posterUrl),
        }))
        .filter((entry) => Boolean(entry.url)),
    [post.media],
  );
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);

  if (media.length === 0) {
    return null;
  }
  const first = media[0];
  const rawAspect = first.width && first.height ? first.width / first.height : MIN_ASPECT;
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, rawAspect));
  const height = width > 0 ? Math.round(width / aspect) : 0;
  const total = media.length;
  const current = media[index] ?? first;

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next !== width) {
      setWidth(next);
    }
  };

  return (
    <View style={styles.root}>
      <View
        onLayout={onLayout}
        style={[styles.frame, { height: height || undefined, backgroundColor: theme.backgroundSelected }]}>
        {width > 0 ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEnabled={total > 1}
            onMomentumScrollEnd={(event) =>
              setIndex(
                Math.min(total - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / width))),
              )
            }>
            {media.map((entry, slide) => (
              <View
                key={entry.assetId}
                style={{ width, height }}
                accessible
                accessibilityRole="image"
                accessibilityLabel={
                  entry.altText ??
                  (total > 1
                    ? `${entry.kind === 'video' ? fr.social.createVideo : fr.social.photo} ${slide + 1}/${total}`
                    : entry.kind === 'video'
                      ? fr.social.createVideo
                      : fr.social.photo)
                }>
                {entry.kind === 'video' ? (
                  slide === index ? (
                    <DetailVideo uri={entry.url!} posterUrl={entry.posterUrl} muted={muted} />
                  ) : entry.posterUrl ? (
                    <Image source={{ uri: entry.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : null
                ) : (
                  <Image
                    source={{ uri: entry.url! }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={120}
                  />
                )}
                <MediaFilterOverlay filterKey={post.mediaFilter} />
                {entry.kind === 'video' && slide !== index ? (
                  <View pointerEvents="none" style={styles.playBadge}>
                    <Icon icon={Play} size={18} color={FeedSurface.onMedia} fill={FeedSurface.onMedia} />
                  </View>
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : null}

        {total > 1 ? (
          <View pointerEvents="none" style={styles.counter}>
            <ThemedText type="micro" style={styles.counterText}>
              {fr.social.textPageIndicator(index + 1, total)}
            </ThemedText>
          </View>
        ) : null}

        {current.kind === 'video' ? (
          <Pressable
            onPress={() => setMuted((value) => !value)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{ selected: muted }}
            accessibilityLabel={muted ? fr.social.soundOn : fr.social.soundOff}
            style={({ pressed }) => [styles.sound, pressed && styles.pressed]}>
            <Icon icon={muted ? VolumeX : Volume2} size={14} color={FeedSurface.onMedia} />
          </Pressable>
        ) : null}
      </View>

      {total > 1 ? (
        <View
          style={styles.dots}
          accessible
          accessibilityLabel={fr.social.photoOf(index + 1, total)}>
          {media.map((entry, dot) => (
            <View
              key={entry.assetId}
              style={[
                styles.dot,
                { backgroundColor: dot === index ? theme.accent : theme.textSecondary },
                dot !== index && styles.dotIdle,
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Vidéo de la page visible : boucle, poster jusqu'à la première image. */
function DetailVideo({
  uri,
  posterUrl,
  muted,
}: {
  uri: string;
  posterUrl: string | null;
  muted: boolean;
}) {
  const player = useVideoPlayer({ uri, useCaching: true }, (instance) => {
    instance.loop = true;
    instance.muted = muted;
    instance.play();
  });
  const [firstFrame, setFirstFrame] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    player.muted = muted;
  }, [muted, player]);
  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        surfaceType="textureView"
        onFirstFrameRender={() => setFirstFrame(true)}
      />
      {!firstFrame && posterUrl ? (
        <Image source={{ uri: posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing.two,
  },
  frame: {
    width: '100%',
    minHeight: 160,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  counter: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  counterText: {
    color: FeedSurface.onMedia,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  sound: {
    position: 'absolute',
    right: Spacing.two,
    bottom: Spacing.two,
    width: 28,
    height: 28,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  playBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    width: 44,
    height: 44,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotIdle: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.7,
  },
});
