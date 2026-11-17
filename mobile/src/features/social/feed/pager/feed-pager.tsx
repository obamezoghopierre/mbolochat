import { Link2, Send, ShieldAlert, Trash2 } from 'lucide-react-native';
import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { ThemedText } from '@/components/themed-text';
import { FeedMetrics, FeedSurface, Radii, Spacing } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { useAuth } from '@/lib/auth-context';
import type { FeedPost } from '@/lib/types';
import { FeedActionRail } from './action-rail';
import { isVideoPost, primaryMedia } from './feed-media';
import { ImagePage } from './image-page';
import { PostInfoBlock } from './post-info';
import { TextPage } from './text-page';
import { VideoPage } from './video-page';

export interface FeedPagerActions {
  toggleLike: (post: FeedPost) => Promise<void>;
  toggleSave: (post: FeedPost) => Promise<void>;
  toggleRepost: (post: FeedPost) => Promise<void>;
  follow: (post: FeedPost) => Promise<void>;
  remove: (post: FeedPost) => Promise<void>;
  report: (post: FeedPost) => void;
  notifyError: (message: string) => void;
}

const TOAST_DURATION = 1600;

/** Respiration entre la ligne du son et la barre de progression. */
const SOUND_TO_PROGRESS_GAP = 12;

/**
 * Pager vertical plein écran, façon TikTok : une publication par écran, snap
 * exact sur la hauteur visible, seuls les voisins immédiats montés.
 *
 * Implémenté avec `FlatList` paginée plutôt que `react-native-pager-view` :
 * aucune dépendance native en plus, donc chargeable sur le dev client existant.
 * Toute la surcouche (auteur, légende, rail d'actions) est commune aux trois
 * types de page pour que le rythme visuel reste identique d'une page à l'autre.
 */
/** Plafond du cache disque des vidéos (200 Mo). */
const VIDEO_CACHE_BYTES = 200 * 1024 * 1024;

export function FeedPager({
  items,
  height,
  barInset,
  actions,
  onLoadMore,
}: {
  items: FeedPost[];
  /** Hauteur de l'écran entier : un item = un écran, comme TikTok. */
  height: number;
  /**
   * Hauteur de la barre de navigation du bas (inset système compris). Les
   * overlays remontent d'autant pour ne jamais passer dessous.
   */
  barInset: number;
  actions: FeedPagerActions;
  onLoadMore: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [activeIndex, setActiveIndex] = useState(0);

  const [muted, setMuted] = useState(false);
  // Un glissement sur la barre de progression doit geler le scroll vertical :
  // sinon le Pan du feed entre en concurrence avec celui de la barre.
  const [scrubbing, setScrubbing] = useState(false);
  // Le cœur doit battre sur le post touché, pas sur toutes les pages montées :
  // la clé porte donc l'identifiant du post en plus du compteur.
  const [burst, setBurst] = useState<{ id: string; key: number }>({ id: '', key: 0 });
  const [menuTarget, setMenuTarget] = useState<FeedPost | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const likeScale = useMemo(() => new Animated.Value(1), []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
    toastTimer.current = setTimeout(() => setToast(null), TOAST_DURATION);
  }, []);

  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 60 }), []);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
    const first = viewableItems[0];
      if (typeof first?.index === 'number') {
        setActiveIndex(first.index);
      }
    },
    [],
  );

  /** Double-tap : réagit sans jamais retirer une réaction déjà posée. */
  const handleDoubleTap = useCallback(
    (post: FeedPost) => {
      setBurst((current) => ({ id: post.id, key: current.key + 1 }));
      Animated.sequence([
        Animated.spring(likeScale, { toValue: 1.35, useNativeDriver: true, friction: 3 }),
        Animated.spring(likeScale, { toValue: 1, useNativeDriver: true, friction: 3 }),
      ]).start();
      if (post.viewer.reaction === null) {
        void actions.toggleLike(post);
      }
    },
    [actions, likeScale],
  );

  const openComments = useCallback((post: FeedPost) => {
    router.push(`/post/${post.id}`);
  }, []);

  const openProfile = useCallback((post: FeedPost) => {
    router.push(`/user/${post.author.id}`);
  }, []);

  const share = useCallback(
    async (post: FeedPost) => {
      const caption = (post.caption ?? '').trim();
      const title = caption.length > 0 ? caption : `Publication de ${post.author.displayName}`;
      try {
        await Share.share({
          message: `${title}\n\n${deepLink(post.id)}`,
          title,
        });
      } catch {
        actions.notifyError(fr.social.shareError);
      }
    },
    [actions],
  );

  const copyLink = useCallback(
    async (post: FeedPost) => {
      try {
        await Share.share({ message: deepLink(post.id) });
        showToast('Lien partagé');
      } catch {
        actions.notifyError(fr.social.shareError);
      }
    },
    [actions, showToast],
  );

  const currentUserId = user?.id ?? null;

  const menuActions = useMemo<SheetAction[]>(() => {
    const target = menuTarget;
    if (!target) {
      return [];
    }
    const own = target.author.id === currentUserId;
    const shareAction: SheetAction = {
      key: 'share',
      label: fr.social.shareLabel,
      icon: Send,
      onPress: () => void share(target),
    };
    const reportAction: SheetAction = {
      key: 'report',
      label: 'Signaler',
      icon: ShieldAlert,
      destructive: true,
      onPress: () => actions.report(target),
    };
    const deleteAction: SheetAction = {
      key: 'delete',
      label: 'Supprimer',
      icon: Trash2,
      destructive: true,
      onPress: () => void actions.remove(target),
    };
    const linkAction: SheetAction = {
      key: 'link',
      label: 'Copier le lien',
      icon: Link2,
      onPress: () => void copyLink(target),
    };
    return own
      ? [linkAction, shareAction, deleteAction, reportAction]
      : [linkAction, shareAction, reportAction];
  }, [actions, copyLink, currentUserId, menuTarget, share]);

  if (height <= 0) {
    return <View style={styles.flex} />;
  }

  return (
    // Hauteur explicite identique à celle des items : sans elle, la `FlatList`
    // occupe la zone de l'onglet et le snap se cale sur une autre référence que
    // la hauteur d'item, ce qui laisse apparaître la page suivante en bas.
    <View style={[styles.flex, { height }]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        style={styles.flex}
        showsVerticalScrollIndicator={false}
        // Item = écran entier : `pagingEnabled` et `snapToInterval` décrivent
        // alors la même page, donc plus de snap bancal ni de page suivante
        // visible en bas pendant le geste.
        pagingEnabled
        disableIntervalMomentum
        decelerationRate="fast"
        snapToInterval={height}
        snapToAlignment="start"
        // Pendant un glissement sur la barre, le feed ne doit pas bouger.
        scrollEnabled={!scrubbing}
        getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        // 5 = la page active, une en arrière et trois en avant : la vidéo
        // suivante est déjà montée (donc prête) quand le geste commence.
        windowSize={5}
        initialNumToRender={2}
        maxToRenderPerBatch={3}
        // `removeClippedSubviews` détache les vues dès qu'elles sortent du
        // cadre, ce qui laisse des trous noirs pendant le snap et coupe la
        // vidéo voisine en pleine préparation. On le laisse désactivé : la
        // fenêtre ci-dessus borne déjà le nombre de pages montées.
        onEndReached={onLoadMore}
        // Anticipe une page à l'avance : la requête part avant le dernier item.
        onEndReachedThreshold={1.5}
        renderItem={({ item, index }) => {
          const isActive = index === activeIndex;
          const chrome = {
            height,
            barInset,
            isActive,
            activeIndex,
            // 0 sur les autres pages : seule celle du post touché rejoue.
            burstKey: burst.id === item.id ? burst.key : 0,
            likeScale,
            distance: index - activeIndex,
          };
          const doubleTap = () => handleDoubleTap(item);
          // Le bloc infos et le rail partagent la même ancre basse. Ils remontent
          // de la hauteur de la barre, de la zone de la barre de progression
          // (24 px) et de 12 px de respiration : la ligne du son ne touche
          // jamais le trait de progression.
          const paddingBottom =
            barInset + FeedMetrics.progressTrackHeight + SOUND_TO_PROGRESS_GAP;

          return (
            <View style={[styles.page, { height, width: '100%' }]}>
              {isVideoPost(item) ? (
                <VideoPage
                  post={item}
                  chrome={chrome}
                  onDoubleTapLike={doubleTap}
                  muted={muted}
                  onToggleSound={() => setMuted((value) => !value)}
                  onScrubStateChange={setScrubbing}
                />
              ) : primaryMedia(item) ? (
                <ImagePage post={item} chrome={chrome} onDoubleTapLike={doubleTap} />
              ) : (
                <TextPage post={item} chrome={chrome} />
              )}

              <OverlayScrim />

              {/* Bloc infos et rail partagent la même ancre basse : la tab bar
                  occupe déjà `TabBarInset` sous le contenu, donc on ne
                  rajoute que le petit écart optique au-dessus d'elle. */}
              <View
                style={[styles.bottom, { paddingBottom }]}
                pointerEvents="box-none">
                <View style={styles.infoColumn} pointerEvents="box-none">
                  <PostInfoBlock
                    post={item}
                    following={item.viewer.followingAuthor}
                    followState="idle"
                    onFollow={() => void actions.follow(item)}
                    onOpenProfile={() => openProfile(item)}
                  />
                </View>

                <FeedActionRail
                  post={item}
                  likeScale={likeScale}
                  state={{
                    reacted: item.viewer.reaction !== null,
                    saved: Boolean(item.viewer.saved),
                    reposted: Boolean(item.viewer.reposted),
                    following: item.viewer.followingAuthor,
                    toast: null,
                  }}
                  actions={{
                    onToggleLike: () => void actions.toggleLike(item),
                    onOpenComments: () => openComments(item),
                    onToggleSave: () => void actions.toggleSave(item),
                    onToggleRepost: () => void actions.toggleRepost(item),
                    onShare: () => void share(item),
                    onMore: () => setMenuTarget(item),
                    onOpenProfile: () => openProfile(item),
                    onFollow: item.viewer.followingAuthor ? null : () => void actions.follow(item),
                  }}
                />
              </View>
            </View>
          );
        }}
      />

      {toast ? (
        <View style={[styles.toast, { bottom: insets.bottom + Spacing.six }]} pointerEvents="none">
          <ThemedText type="small" style={styles.toastText}>
            {toast}
          </ThemedText>
        </View>
      ) : null}

      <ActionSheet
        visible={menuTarget !== null}
        title="Options"
        subtitle={menuTarget ? `Publication de ${menuTarget.author.displayName}` : undefined}
        actions={menuActions}
        onClose={() => setMenuTarget(null)}
      />
    </View>
  );
}

/** Dégradé de lisibilité en bas de chaque page (équivalent du LinearGradient Mbolo). */
/**
 * Dégradé de lisibilité en bas de la vidéo.
 *
 * Construit en bandes empilées plutôt qu'avec `expo-linear-gradient` : ce module
 * est natif, et l'APK de développement installé ne l'embarque pas
 * (`Can't find ViewManager 'ViewManagerAdapter_ExpoLinearGradient'`). Des bandes
 * fines produisent un dégradé continu à l'œil, sans dépendance native.
 *
 * L'opacité suit une progression quadratique : quasi nulle en haut, elle
 * n'atteint ~25 % qu'au tout dernier pixel, donc la vidéo reste claire.
 */
const SCRIM_BANDS = 24;
const SCRIM_HEIGHT = 150;
const SCRIM_MAX_OPACITY = 0.25;

const SCRIM_COLORS = Array.from(
  { length: SCRIM_BANDS },
  (_, index) => `rgba(0,0,0,${(((index + 1) / SCRIM_BANDS) ** 2 * SCRIM_MAX_OPACITY).toFixed(4)})`,
);

function OverlayScrim() {
  return (
    <View pointerEvents="none" style={styles.scrimContainer}>
      {SCRIM_COLORS.map((color) => (
        <View key={color} style={[styles.scrimBand, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

function deepLink(publicationId: string): string {
  return `mbolochat://post/${publicationId}`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: {
    backgroundColor: FeedSurface.background,
  },
  // 150 px découpés en bandes égales : aucun bord visible, la vidéo reste
  // claire en haut de la zone.
  scrimContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SCRIM_HEIGHT,
  },
  scrimBand: {
    flex: 1,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingLeft: Spacing.three,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 300,
  },
  infoColumn: {
    flex: 1,
    paddingRight: Spacing.two,
  },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.full,
  },
  toastText: {
    color: FeedSurface.onMedia,
    fontWeight: '600',
  },
});
