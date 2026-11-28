import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Volume2, VolumeX, X } from 'lucide-react-native';
import { AppState, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import {
  FeedMetrics,
  FeedSurface,
  Motion,
  Radii,
  Spacing,
} from '@/constants/theme';
import { CommentsSheet } from '../feed/pager/comments-sheet';
import {
  FeedPager,
  TopScrim,
  type FeedPagerActions,
} from '../feed/pager/feed-pager';
import { isVideoPost } from '../feed/pager/feed-media';
import { OnMediaShadow } from '../feed/pager/feed-tokens';
import { useReportPublication } from '../feed/use-report-publication';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import type { FeedPost } from '@/lib/types';
import { fr } from '@/i18n/fr';
import type { DiscoverFeedActions } from './use-discover-feed';

/** Durée d'affichage du message temporaire (erreur, confirmation). */
const NOTICE_DURATION = 2400;

/**
 * Visionneuse plein écran de la grille Découvrir, comme l'écran de
 * publication d'Instagram : une publication par écran, défilement
 * vertical entre les vignettes, rail d'actions et feuille de partage
 * communs au fil d'accueil.
 *
 * Le pager est réutilisé tel quel : les publications média de la grille
 * (image, carrousel, vidéo) passent par `ImagePage` / `VideoPage`, donc
 * le rythme, les gestes (double-tap, pincement) et les surcouches sont
 * ceux du fil — aucune duplication.
 */
export function DiscoverViewer({
  items,
  initialIndex,
  hasMore,
  onLoadMore,
  onRefresh,
  actions,
  onClose,
}: {
  items: FeedPost[];
  /** Vignette ouverte (position dans la grille). */
  initialIndex: number;
  /** Reste-t-il des pages à charger ? */
  hasMore: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
  actions: DiscoverFeedActions;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const viewport = useWindowDimensions();
  const { token } = useAuth();
  // Hauteur du calque plein écran, mesurée. La fenêtre sert de repli : le
  // calque occupe tout l'écran, donc les deux valeurs coïncident, et un
  // `onLayout` en retard ne laisse jamais le pager à zéro (écran noir).
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const height = measuredHeight > 0 ? measuredHeight : viewport.height;
  // Son des reels : le pager le pilote, la barre du haut affiche l'état
  // et permet de le basculer, comme Instagram.
  const [muted, setMuted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [commentsPost, setCommentsPost] = useState<FeedPost | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Glisser vers le bas pour fermer, comme l'écran publication d'Instagram :
  // la visionneuse suit le doigt depuis la bande du haut et se referme au
  // seuil (ou au lancer rapide). Le geste est attaché à une bande au-dessus
  // du pager, pour ne pas entrer en conflit avec son défilement vertical.
  const reduced = useReducedMotion();
  const translateY = useSharedValue(0);
  /** Assombrissement du fond au glissement, proportionnel à la distance. */
  const dim = useSharedValue(0);
  /** Hauteur de la visionneuse, pour le déplacement hors écran au geste. */
  const sheetHeight = useSharedValue(0);
  const handleDismiss = useCallback(() => {
    // Retour haptique léger, comme la fermeture par glissement des feuilles.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onClose();
  }, [onClose]);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((event) => {
          'worklet';
          // eslint-disable-next-line react-hooks/immutability
          translateY.value = Math.max(0, event.translationY);
          // eslint-disable-next-line react-hooks/immutability
          dim.value = Math.min(1, translateY.value / 400);
        })
        .onEnd((event) => {
          'worklet';
          const willClose =
            translateY.value > Motion.sheetDismissDistance ||
            event.velocityY > 700;
          const dismiss = () => {
            // eslint-disable-next-line react-hooks/immutability
            translateY.value = reduced
              ? withTiming(Math.max(200, sheetHeight.value + 200), { duration: 150 }, (finished) => {
                  if (finished) {
                    runOnJS(handleDismiss)();
                  }
                })
              : withSpring(
                  Math.max(200, sheetHeight.value + 200),
                  Motion.spring,
                  (finished) => {
                    if (finished) {
                      runOnJS(handleDismiss)();
                    }
                  },
                );
          };
          if (willClose) {
            dismiss();
          } else {
            translateY.value = withSpring(0, Motion.spring);
          }
        }),
    [handleDismiss, translateY, dim, sheetHeight, reduced],
  );

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Le lecteur ne joue que quand la grille est l'écran visible et que
  // l'application est au premier plan : sans cela le son continue sous
  // l'onglet Messages.
  const [screenFocused, setScreenFocused] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
    }
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_DURATION);
  }, []);

  // La grille ne renvoie que le contenu média : au passage, on récupère le
  // détail de la publication ouverte (état du lecteur, compteurs, médias)
  // comme le fait l'écran de publication du fil. On dépend de l'identifiant
  // seul : une mise à jour de la liste (réaction, signet) ne relance pas la
  // demande.
  const openIndex = Math.min(initialIndex, Math.max(0, items.length - 1));
  const openPostId = items[openIndex]?.id ?? null;
  useEffect(() => {
    if (!openPostId || !token) {
      return;
    }
    let active = true;
    api
      .publication(token, openPostId)
      .then((detail) => {
        if (active) {
          actions.replacePost(detail);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [openPostId, token, actions]);

  useEffect(
    () => () => {
      if (noticeTimer.current) {
        clearTimeout(noticeTimer.current);
      }
    },
    [],
  );

  // Une erreur lancée par le pager ou une feuille est affichée en haut de
  // la visionneuse, comme le toast du fil.
  const report = useReportPublication((message) => showNotice(message));

  const pagerActions = useMemo<FeedPagerActions>(
    () => ({
      toggleLike: (post) => {
        void actions.toggleLike(post);
        return Promise.resolve();
      },
      setReaction: (post, kind) => {
        actions.setReaction(post, kind);
        return Promise.resolve();
      },
      dismiss: (post) => {
        actions.dismiss(post);
        return Promise.resolve();
      },
      muteAuthor: (post) => {
        actions.muteAuthor(post);
        return Promise.resolve();
      },
      toggleSave: (post) => {
        actions.toggleSave(post);
        return Promise.resolve();
      },
      toggleRepost: (post) => {
        actions.toggleRepost(post);
        return Promise.resolve();
      },
      follow: (post) => {
        actions.follow(post);
        return Promise.resolve();
      },
      unfollow: (post) => actions.unfollow(post),
      remove: (post) => {
        actions.remove(post);
        return Promise.resolve();
      },
      replacePost: actions.replacePost,
      // Réouverture du compositeur pour une publication propre.
      edit: (post) =>
        router.push(
          post.format === 'text' ? `/create/text?id=${post.id}` : `/post/edit/${post.id}`,
        ),
      report: (post) => report.open(post),
      onOpenComments: (post) => setCommentsPost(post),
      notifyError: (message) => showNotice(message),
    }),
    [actions, report, showNotice],
  );

  if (items.length === 0) {
    return (
      <View style={[styles.layer, { paddingTop: insets.top + Spacing.five }]}>
        <View style={styles.empty}>
          <ThemedText type="body" style={[styles.emptyText, OnMediaShadow]}>
            {fr.social.viewerEmpty}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
            <Icon icon={X} size={Spacing.five} color={FeedSurface.onMedia} />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
      <View
        style={styles.layer}
        onLayout={(event) => {
          // La hauteur est lue par le worklet de glissement (valeur partagée).
          // eslint-disable-next-line react-hooks/immutability
          sheetHeight.value = event.nativeEvent.layout.height;
          setMeasuredHeight(event.nativeEvent.layout.height);
        }}>
        {/* Assombrissement progressif pendant le glissement vers le bas. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.dimOverlay, { opacity: dim }]} />

        {/* Hauteur explicite : le pager et sa liste sont des enfants `flex: 1`,
            et un parent en hauteur automatique les réduisait à zéro — le média
            et les surcouches de la page n'étaient alors jamais dessinés. */}
        <Animated.View style={[sheetStyle, { height }]}>
          <FeedPager
          mode="pager"
          items={items}
          initialIndex={Math.min(initialIndex, items.length - 1)}
          height={height}
          barInset={insets.bottom + Spacing.four}
          playbackActive={screenFocused && appActive}
          refreshing={false}
          hasMore={hasMore}
          hideOverlays={commentsPost !== null}
          onLoadMore={onLoadMore}
          onRefresh={onRefresh}
          actions={pagerActions}
          muted={muted}
          onMuteChange={setMuted}
          onActiveIndexChange={setActiveIndex}
        />

        <TopScrim />

        {/* Bande de glissement vers le bas pour fermer. Aucune poignée
            visible, comme la visionneuse d'Instagram ; elle est rendue après le
            pager pour capter le geste au-dessus de son défilement vertical, et
            sous les boutons du haut, qui restent cliquables. */}
        <GestureDetector gesture={pan}>
          <View
            style={[styles.dragZone, { top: insets.top + FeedMetrics.touchTarget }]}
          />
        </GestureDetector>

        {/* Barre du haut : fermeture, comme l'écran publication d'Instagram. */}
        <View
          pointerEvents="box-none"
          style={[styles.topBar, { top: insets.top + Spacing.one }]}>
          <View style={styles.topBarInner}>
            {isVideoPost(items[activeIndex] ?? items[0]) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  muted ? fr.social.unmuteReel : fr.social.muteReel
                }
                onPress={() => setMuted((value) => !value)}
                hitSlop={12}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                <Icon
                  icon={muted ? VolumeX : Volume2}
                  size={Spacing.four}
                  color={FeedSurface.onMedia}
                />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={fr.social.viewerClose}
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
              <Icon icon={X} size={Spacing.five} color={FeedSurface.onMedia} />
            </Pressable>
          </View>
        </View>

        {/* Chargement de la page suivante, au-dessus du tab bar. */}
        {hasMore ? (
          <View
            pointerEvents="none"
            style={[styles.loadingMore, { bottom: insets.bottom + Spacing.six }]}>
            <ThemedText type="caption" style={[styles.loadingText, OnMediaShadow]}>
              {fr.social.viewerLoadingMore}
            </ThemedText>
          </View>
        ) : null}

        {notice ? (
          <View
            pointerEvents="none"
            style={[
              styles.notice,
              {
                top: insets.top + Spacing.six,
                backgroundColor: FeedSurface.noticeError,
              },
            ]}>
            <ThemedText type="caption" style={styles.noticeText}>
              {notice}
            </ThemedText>
          </View>
        ) : null}

        {commentsPost ? (
          <CommentsSheet
            post={commentsPost}
            onClose={() => setCommentsPost(null)}
          />
        ) : null}

        {report.sheet}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: FeedSurface.background,
  },
  dimOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: FeedSurface.background,
  },
  dragZone: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Hauteur de la bande de glissement, sous les boutons du haut. Invisible :
    // aucun repère de feuille, la visionneuse couvre tout l'écran.
    height: Spacing.six,
  },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  topBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  closeButton: {
    width: FeedMetrics.touchTarget,
    height: FeedMetrics.touchTarget,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  loadingMore: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  loadingText: {
    color: FeedSurface.onMediaSoft,
    fontWeight: '600',
  },
  notice: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    alignItems: 'center',
    borderRadius: Radii.sm,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  noticeText: {
    color: FeedSurface.onMedia,
    fontWeight: '600',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  emptyText: {
    color: FeedSurface.onMedia,
    fontWeight: '600',
  },
});
