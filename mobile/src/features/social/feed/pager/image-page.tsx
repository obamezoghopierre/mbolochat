import { router } from 'expo-router';
import { BadgeCheck, Ellipsis, MapPin } from 'lucide-react-native';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedSurface, Radii, Spacing, Type } from '@/constants/theme';
import { MediaFilterOverlay } from '@/features/media/media-filter';
import { fr } from '@/i18n/fr';
import { formatRelativeTimestamp } from '@/lib/format';
import { resolveMediaUrl } from '@/lib/media-url';
import type { FeedPost } from '@/lib/types';
import { LikedByLine } from '../liked-by-line';
import type { FeedActions, FeedActionState } from './action-rail';
import { feedText, useTextPostTones } from './feed-tokens';
import { HeartBurstOverlay } from './heart-burst';
import { PostActionBar } from './post-action-bar';
import { renderTokens } from './rich-text';
import type { FeedPageChrome } from './video-page';

/** Réserve haute (onglets du fil) et basse (barre d'onglets), comme la carte texte. */
const TOP_RESERVED = 112;
const BOTTOM_RESERVED = 128;
/** Avatar de l'en-tête, calqué sur une publication Instagram. */
const HEADER_AVATAR = 36;
/** Écart vertical entre en-tête, photo et pied. */
const COLUMN_GAP = Spacing.two;
/** Ratios extrêmes acceptés par Instagram : 4:5 (portrait) à 1.91:1 (paysage). */
const MIN_ASPECT = 4 / 5;
const MAX_ASPECT = 1.91;
/** Estimations avant la première mesure de l'en-tête et du pied. */
const TOP_ESTIMATE = 52;
const FOOTER_ESTIMATE = 150;
/** En dessous, la photo n'est plus lisible : on accepte de rogner la légende. */
const MIN_MEDIA_HEIGHT = 200;
/** Lignes de légende avant « voir plus ». */
const CAPTION_LINES = 2;
/** Longueur au-delà de laquelle la légende propose « voir plus ». */
const CAPTION_PREVIEW_CHARS = 90;
/** Zoom maximal au pincement. */
const MAX_ZOOM = 3;
/** Ressort du carrousel : glissement sec, calage franc. */
const PAGE_SPRING = { damping: 30, stiffness: 240, mass: 0.9 } as const;
/** Le badge « 2/5 » s'efface après ce délai sans changement de photo. */
const PAGE_BADGE_VISIBLE_MS = 2500;

/**
 * Publication photo ou carrousel au format Instagram : en-tête au-dessus,
 * photo pleine largeur au ratio d'origine (borné entre 4:5 et 1.91:1),
 * actions et légende en dessous, sur le fond neutre du fil.
 *
 * - Carrousel : on glisse d'une photo à l'autre (plus de tap pour avancer) ;
 *   badge « 2/5 » dans le coin et points sous la photo.
 * - Double-tap : J'aime, avec le cœur sous le doigt.
 * - Pincement : zoom, qui revient à 1 au relâchement, comme Instagram.
 */
export function ImagePage({
  post,
  chrome,
  actions,
  state,
  likeScale,
  onDoubleTapLike,
}: {
  post: FeedPost;
  chrome: FeedPageChrome;
  actions: FeedActions;
  state: FeedActionState;
  likeScale?: Animated.Value;
  onDoubleTapLike: (point: { x: number; y: number } | null) => void;
}) {
  const tones = useTextPostTones();
  const { width: windowWidth } = useWindowDimensions();
  const interactive = !chrome.hideOverlays;
  const author = post.author;

  // L'API renvoie des chemins signés relatifs : `<Image>` exige une URL absolue.
  const media = useMemo(
    () =>
      (post.media ?? [])
        .filter((entry) => entry.kind === 'image')
        .map((entry) => ({ ...entry, url: resolveMediaUrl(entry.url) }))
        .filter((entry) => Boolean(entry.url)),
    [post.media],
  );
  const total = media.length;
  const [index, setIndex] = useState(0);

  // Ratio du carrousel : celui de la première photo, borné comme Instagram.
  // Toutes les photos d'un carrousel partagent ce cadre.
  const first = media[0];
  const rawAspect =
    first?.width && first?.height ? first.width / first.height : MIN_ASPECT;
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, rawAspect));

  // En-tête et pied mesurés : la photo prend son ratio s'il tient, sinon la
  // place restante (petit écran), sans jamais pousser les actions hors champ.
  const [topHeight, setTopHeight] = useState<number | null>(null);
  const [footerHeight, setFooterHeight] = useState<number | null>(null);
  const measure =
    (setter: (value: number) => void, current: number | null) => (value: number) => {
      if (current === null || Math.abs(current - value) > 1) {
        setter(Math.round(value));
      }
    };
  const available =
    chrome.height -
    TOP_RESERVED -
    BOTTOM_RESERVED -
    (topHeight ?? TOP_ESTIMATE) -
    (interactive ? (footerHeight ?? FOOTER_ESTIMATE) : 0) -
    COLUMN_GAP * 2;
  const mediaWidth = windowWidth;
  const mediaHeight = Math.round(
    Math.max(MIN_MEDIA_HEIGHT, Math.min(mediaWidth / aspect, available)),
  );

  // --- Carrousel : glisser horizontal, comme la carte texte multi-pages ---
  const lastIndex = Math.max(0, total - 1);
  const translateX = useSharedValue(0);
  const dragStart = useSharedValue(0);
  const dragOrigin = useSharedValue(0);
  // La largeur peut changer (rotation) : la rangée est recalée sur la photo.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    translateX.value = -index * mediaWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaWidth]);

  // --- Zoom au pincement : revient à 1 au relâchement ---
  const zoom = useSharedValue(1);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(total > 1)
    .activeOffsetX([-8, 8])
    .failOffsetY([-24, 24])
    .onStart((event) => {
      dragStart.value = translateX.value;
      dragOrigin.value = event.translationX;
    })
    .onUpdate((event) => {
      const next = dragStart.value + (event.translationX - dragOrigin.value);
      const min = -lastIndex * mediaWidth;
      translateX.value =
        next > 0 ? next * 0.35 : next < min ? min + (next - min) * 0.35 : next;
    })
    .onEnd((event) => {
      const fling = event.velocityX * 0.18;
      const target = Math.min(
        lastIndex,
        Math.max(0, Math.round(-(translateX.value + fling) / mediaWidth)),
      );
      translateX.value = withSpring(-target * mediaWidth, {
        ...PAGE_SPRING,
        velocity: event.velocityX,
      });
      runOnJS(setIndex)(target);
    });

  const pinch = Gesture.Pinch()
    .onStart((event) => {
      focalX.value = event.focalX - mediaWidth / 2;
      focalY.value = event.focalY - mediaHeight / 2;
    })
    .onUpdate((event) => {
      zoom.value = Math.min(MAX_ZOOM, Math.max(1, event.scale));
    })
    .onEnd(() => {
      zoom.value = withTiming(1, { duration: 180 });
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(280)
    .onEnd((event, success) => {
      if (success) {
        runOnJS(onDoubleTapLike)({ x: event.x, y: event.y });
      }
    });

  const gestures = Gesture.Simultaneous(pinch, Gesture.Race(doubleTap, pan));

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: focalX.value },
      { translateY: focalY.value },
      { scale: zoom.value },
      { translateX: -focalX.value },
      { translateY: -focalY.value },
    ],
  }));

  /** Changement de photo sans glisser (lecteur d'écran). */
  const goTo = (next: number) => {
    const target = Math.min(lastIndex, Math.max(0, next));
    if (target === index) {
      return;
    }
    // eslint-disable-next-line react-hooks/immutability
    translateX.value = withSpring(-target * mediaWidth, PAGE_SPRING);
    setIndex(target);
  };

  // Badge « 2/5 » : visible au changement de photo, puis il s'efface.
  const [badgeOpacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (total < 2) {
      return;
    }
    const animation = Animated.sequence([
      Animated.timing(badgeOpacity, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.delay(PAGE_BADGE_VISIBLE_MS),
      Animated.timing(badgeOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [badgeOpacity, index, total]);

  // Légende : nom en gras puis texte, repliée sur deux lignes (« voir plus »).
  const caption = (post.caption ?? '').trim();
  const [expanded, setExpanded] = useState(false);
  // Estimation simple : au-delà de ~90 caractères ou de deux lignes, la
  // légende ne tient pas sur deux lignes et propose « voir plus ».
  const captionTruncated =
    caption.length > CAPTION_PREVIEW_CHARS || caption.split('\n').length > CAPTION_LINES;

  const current = media[index] ?? first;

  return (
    <View
      style={[
        styles.page,
        {
          height: chrome.height,
          backgroundColor: tones.surface,
          paddingTop: TOP_RESERVED,
          paddingBottom: BOTTOM_RESERVED,
        },
      ]}>
      <View style={styles.column}>
        {/* En-tête : republication, avatar rond, nom + badge + date, lieu,
            « Suivre » en texte et menu ⋯. */}
        <View
          style={styles.top}
          onLayout={(event) => measure(setTopHeight, topHeight)(event.nativeEvent.layout.height)}>
          {post.repostedBy ? (
            <Pressable
              onPress={() => router.push(`/user/${post.repostedBy!.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Voir le profil de ${post.repostedBy.displayName}`}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText style={[feedText.caption, styles.repostedBy, { color: tones.textSoft }]}>
                {fr.social.republishedBy(post.repostedBy.displayName)}
              </ThemedText>
            </Pressable>
          ) : null}
          <View style={styles.header}>
            <Pressable
              onPress={actions.onOpenProfile}
              accessibilityRole="button"
              accessibilityLabel={`Voir le profil de ${author.displayName}${
                author.verified ? `, ${fr.social.verifiedAccount}` : ''
              }`}
              style={({ pressed }) => [styles.authorRow, pressed && styles.pressed]}>
              <Avatar
                name={author.displayName}
                uri={resolveMediaUrl(author.avatarUrl)}
                size={HEADER_AVATAR}
                shape="circle"
              />
              <View style={styles.authorText}>
                <View style={styles.authorLine}>
                  <ThemedText numberOfLines={1} style={[styles.authorName, { color: tones.text }]}>
                    {author.displayName}
                  </ThemedText>
                  {author.verified ? (
                    <Icon icon={BadgeCheck} size={15} color={tones.verified} strokeWidth={2.4} />
                  ) : null}
                  <ThemedText numberOfLines={1} style={[styles.authorMeta, { color: tones.textSoft }]}>
                    · {formatRelativeTimestamp(post.createdAt)}
                  </ThemedText>
                </View>
                {post.location ? (
                  <View style={styles.locationInline}>
                    <Icon icon={MapPin} size={11} color={tones.textSoft} />
                    <ThemedText
                      numberOfLines={1}
                      style={[styles.authorMeta, styles.locationText, { color: tones.textSoft }]}>
                      {post.location}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            </Pressable>
            <View style={styles.headerActions}>
              {actions.onFollow ? (
                <Pressable
                  onPress={actions.onFollow}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Suivre ${author.displayName}`}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedText style={[styles.followText, { color: tones.accent }]}>
                    {fr.social.follow}
                  </ThemedText>
                </Pressable>
              ) : null}
              <Pressable
                onPress={actions.onShare}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={fr.social.shareMoreOptions}
                style={({ pressed }) => pressed && styles.pressed}>
                <Icon icon={Ellipsis} size={20} color={tones.text} />
              </Pressable>
            </View>
          </View>
        </View>

        {/* Photo pleine largeur au ratio d'origine (borné). */}
        <GestureDetector gesture={gestures}>
          <View
            style={[styles.media, { width: mediaWidth, height: mediaHeight }]}
            accessible
            accessibilityRole="image"
            accessibilityLabel={
              (current?.altText ?? caption) ||
              (total > 1 ? fr.social.photoOf(index + 1, total) : fr.social.photo)
            }
            accessibilityHint={fr.social.photoHint}>
            <Reanimated.View style={[StyleSheet.absoluteFill, zoomStyle]}>
              <Reanimated.View style={[styles.row, { width: mediaWidth * Math.max(1, total) }, rowStyle]}>
                {media.map((entry) => (
                  <View key={entry.assetId} style={{ width: mediaWidth, height: mediaHeight }}>
                    <Image
                      source={{ uri: entry.url! }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      transition={120}
                    />
                    {/* Filtre choisi à la publication : calques par-dessus la photo. */}
                    <MediaFilterOverlay filterKey={post.mediaFilter} />
                  </View>
                ))}
              </Reanimated.View>
            </Reanimated.View>

            {total > 1 ? (
              <Animated.View
                pointerEvents="none"
                importantForAccessibility="no-hide-descendants"
                style={[styles.pageIndicator, { opacity: badgeOpacity }]}>
                <ThemedText type="caption" style={styles.pageIndicatorText}>
                  {fr.social.textPageIndicator(index + 1, total)}
                </ThemedText>
              </Animated.View>
            ) : null}

            <HeartBurstOverlay burstKey={chrome.burstKey} point={chrome.burstPoint} />
          </View>
        </GestureDetector>

        {/* Pied : actions, points du carrousel au centre, « Aimé par »,
            légende repliée, commentaires. Masqué sous la feuille de commentaires. */}
        {interactive ? (
          <View
            style={styles.footer}
            onLayout={(event) =>
              measure(setFooterHeight, footerHeight)(event.nativeEvent.layout.height)
            }>
            <PostActionBar
              post={post}
              reacted={state.reacted}
              saved={state.saved}
              reposted={state.reposted}
              likeScale={likeScale}
              onToggleLike={actions.onToggleLike}
              onPickReaction={actions.onPickReaction}
              onOpenComments={actions.onOpenComments}
              onToggleSave={actions.onToggleSave}
              onToggleRepost={actions.onToggleRepost}
              onShare={actions.onShare}
            />
            {total > 1 ? (
              <View
                style={styles.dots}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={fr.social.photoOf(index + 1, total)}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={(event) =>
                  goTo(event.nativeEvent.actionName === 'increment' ? index + 1 : index - 1)
                }>
                {media.map((entry, dotIndex) => (
                  <View
                    key={entry.assetId}
                    style={[
                      styles.dot,
                      { backgroundColor: dotIndex === index ? tones.accent : tones.textFaint },
                    ]}
                  />
                ))}
              </View>
            ) : null}
            <LikedByLine post={post} color={tones.text} />
            {caption ? (
              <Pressable
                onPress={() => setExpanded((value) => !value)}
                disabled={!captionTruncated && !expanded}
                accessibilityRole={captionTruncated || expanded ? 'button' : undefined}>
                <ThemedText
                  numberOfLines={expanded ? undefined : CAPTION_LINES}
                  style={[styles.caption, { color: tones.text }]}>
                  <ThemedText style={[styles.caption, styles.captionAuthor, { color: tones.text }]}>
                    {author.displayName}{' '}
                  </ThemedText>
                  {renderTokens(caption, [styles.caption, styles.token, { color: tones.accent }], {
                    interactive: true,
                  })}
                </ThemedText>
                {captionTruncated && !expanded ? (
                  <ThemedText style={[styles.caption, { color: tones.textSoft }]}>
                    {fr.social.seeMore}
                  </ThemedText>
                ) : null}
              </Pressable>
            ) : null}
            {post.counters.comments > 0 ? (
              <Pressable
                onPress={actions.onOpenComments}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={fr.social.viewComments(post.counters.comments)}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText style={[styles.metaLink, { color: tones.textSoft }]}>
                  {fr.social.viewComments(post.counters.comments)}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    overflow: 'hidden',
    justifyContent: 'center',
  },
  column: {
    alignSelf: 'stretch',
    gap: COLUMN_GAP,
  },
  top: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  authorText: {
    flexShrink: 1,
  },
  authorLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
  },
  authorName: {
    ...Type.body,
    fontWeight: '700',
    flexShrink: 1,
  },
  authorMeta: {
    ...Type.caption,
    opacity: 0.8,
  },
  locationInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    flexShrink: 1,
  },
  locationText: {
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  followText: {
    ...Type.body,
    fontWeight: '700',
  },
  repostedBy: {
    fontWeight: '600',
  },
  media: {
    overflow: 'hidden',
    backgroundColor: FeedSurface.background,
  },
  row: {
    flexDirection: 'row',
    height: '100%',
  },
  pageIndicator: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  pageIndicatorText: {
    color: FeedSurface.onMedia,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  footer: {
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.one,
    marginTop: -Spacing.one,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  caption: {
    ...Type.caption,
  },
  captionAuthor: {
    fontWeight: '700',
  },
  token: {
    fontWeight: '700',
  },
  metaLink: {
    ...Type.caption,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.75,
  },
});
