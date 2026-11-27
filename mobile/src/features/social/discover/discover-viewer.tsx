import { router, useFocusEffect } from 'expo-router';
import { Volume2, VolumeX, X } from 'lucide-react-native';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedMetrics, FeedSurface, Radii, Spacing } from '@/constants/theme';
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
  const { token } = useAuth();
  const [height, setHeight] = useState(0);
  // Son des reels : le pager le pilote, la barre du haut affiche l'état
  // et permet de le basculer, comme Instagram.
  const [muted, setMuted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [commentsPost, setCommentsPost] = useState<FeedPost | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
            style={({ pressed }) => [styles.closeButton, styles.closeFloating, pressed && styles.pressed]}>
            <Icon icon={X} size={Spacing.five} color={FeedSurface.onMedia} />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View
      style={styles.layer}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
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
              style={({ pressed }) => [
                styles.closeButton,
                { backgroundColor: FeedSurface.glass },
                pressed && styles.pressed,
              ]}>
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
            style={({ pressed }) => [
              styles.closeButton,
              { backgroundColor: FeedSurface.glass },
              pressed && styles.pressed,
            ]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: FeedSurface.background,
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
  closeFloating: {
    backgroundColor: FeedSurface.glassStrong,
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
