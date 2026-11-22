import { Home, MapPin, Plus, Search, Users } from 'lucide-react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import ReAnimated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useNetworkState } from 'expo-network';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import {
  FeedSurface,
  Motion,
  Radii,
  Spacing,
  TabBarHeight,
  TabBarSurface,
  Type,
} from '@/constants/theme';
import { fr } from '@/i18n/fr';
import type { FeedPost, FeedTab } from '@/lib/types';
import { COMMENTS_SHEET_SNAP_RATIO, CommentsSheet } from './pager/comments-sheet';
import { FLOW_TOP_BAR, FeedPager, type FeedPagerActions } from './pager/feed-pager';
import { OnMediaShadow, useTextPostTones } from './pager/feed-tokens';
import { useFeed } from './use-feed';
import { feedChromeHidden, resetFeedChromeTracking, showFeedChrome } from '@/lib/feed-chrome';
import { markLaunchReady } from '@/lib/launch-gate';
import { resolveMediaUrl } from '@/lib/media-url';
import { Image } from 'expo-image';
import { isVideoPost, primaryMedia } from './pager/feed-media';
import { useReportPublication } from './use-report-publication';

/** Onglets du haut : les trois fils, puis « Reels » (vidéos plein écran). */
type TopTab = FeedTab | 'reels';

const TABS: { id: TopTab; label: string }[] = [
  { id: 'local', label: fr.social.feedTabs.local },
  { id: 'for-you', label: fr.social.feedTabs.forYou },
  { id: 'reels', label: fr.social.feedTabs.reels },
  { id: 'following', label: fr.social.feedTabs.following },
];

const DEFAULT_TAB: FeedTab = 'for-you';
const NOTICE_DURATION = 2600;

/**
 * Fil social plein écran :
 *
 * - onglets centrés en haut (Abonnements · Pour toi · Local) et recherche à
 *   droite, sur le média ;
 * - une publication par écran, sans marge : le média est bord à bord ;
 * - retour visuel bref (toast) pour chaque action serveur.
 *
 * Tous les états restent explicites (chargement, vide, erreur, pagination).
 */
export function FeedScreen() {
  const insets = useSafeAreaInsets();
  const { width, height: screenHeight } = useWindowDimensions();
  const [tab, setTab] = useState<TopTab>(DEFAULT_TAB);
  const [commentsPost, setCommentsPost] = useState<FeedPost | null>(null);
  // Plein écran Reels ouvert depuis une carte : la barre d'onglets du haut
  // s'efface, comme sur Instagram.
  const [reelsOpen, setReelsOpen] = useState(false);
  const pager = useRef<ScrollViewInstance | null>(null);
  const navigation = useNavigation();
  // Démarrage : « Pour toi » charge seul ; Local et Abonnements suivent une
  // fois l'accueil affiché (première requête = celle qu'on regarde).
  const [homeReady, setHomeReady] = useState(false);
  const markHomeReady = useCallback(() => setHomeReady(true), []);

  // La barre d'onglets est masquée quand une feuille est ouverte.
  // Reels plein écran : barre du bas masquée aussi, comme Instagram.
  useEffect(() => {
    const hidden = commentsPost !== null || reelsOpen;
    navigation.setOptions({
      tabBarHidden: hidden,
      // Le conteneur du tab bar doit aussi se rétracter, sinon React
      // Navigation réserve 58 px vides sous la feuille.
      tabBarStyle: hidden ? { display: 'none', height: 0 } : undefined,
    } as never);
    return () => {
      navigation.setOptions({
        tabBarHidden: false,
        tabBarStyle: undefined,
      } as never);
    };
  }, [commentsPost, navigation, reelsOpen]);

  // Quand la feuille de commentaires s'ouvre, le post se réduit en carte
  // au-dessus d'elle, le feed entier tient dans
  // l'espace restant, calculé depuis le snap point de la feuille.
  // La transformation suit `animatedPosition` — la position réelle de la
  // feuille — pour que la carte grandisse/reduise PENDANT le glissement,
  // pas seulement à l'ouverture/fermeture (sinon fond noir entre les deux).
  const sheetPosition = useSharedValue(screenHeight);
  // Le bouton X démonte la feuille sans animation de fermeture : on recale la
  // position sur « fermé » pour que la carte du feed retrouve sa taille.
  useEffect(() => {
    if (!commentsPost) {
      sheetPosition.value = withTiming(screenHeight, { duration: 260 });
    }
  }, [commentsPost, screenHeight, sheetPosition]);
  const feedHeight = screenHeight;
  // Espace au-dessus de la plus haute détentes : la carte est à sa plus petite.
  const sheetOpenTop = screenHeight * (1 - COMMENTS_SHEET_SNAP_RATIO);
  // En dessous de cette hauteur d'espace, l'échelle atteint 1 (feed intact).
  const cardTopLimit = feedHeight + Spacing.two;
  const feedTransformStyle = useAnimatedStyle(() => {
    const spaceAbove = Math.min(Math.max(sheetPosition.value, 0), screenHeight);
    // Échelle continue : 1 quand la feuille est fermée ou basse, ~0.25 en haut.
    const scale = Math.min(1, Math.max(0.2, (spaceAbove - Spacing.two) / feedHeight));
    // Poids du rétrécissement : 0 = feed plein écran, 1 = carte épinglée en haut.
    const shrink = Math.min(
      1,
      Math.max(0, (cardTopLimit - spaceAbove) / (cardTopLimit - sheetOpenTop)),
    );
    // Bas de la carte visuelle au ras du bord haut de la feuille.
    const pinnedTy = spaceAbove - Spacing.two - (screenHeight + feedHeight * scale) / 2;
    return {
      transform: [{ translateY: pinnedTy * shrink }, { scale }],
    };
  });
  const feedRadiusStyle = useAnimatedStyle(() => {
    const spaceAbove = Math.min(Math.max(sheetPosition.value, 0), screenHeight);
    const scale = Math.min(1, Math.max(0.2, (spaceAbove - Spacing.two) / feedHeight));
    return {
      borderRadius: interpolate(scale, [1, 0.2], [0, 18]),
      overflow: 'hidden',
    };
  });

  // Le fil doit se taire dès qu'il n'est plus l'écran visible ou que l'app passe
  // en arrière-plan. `Tabs` garde les écrans montés : sans ces deux signaux, la
  // vidéo continuait de jouer sous l'onglet Messages.
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

  /**
   * Les trois fils sont montés côte à côte dans un pager horizontal natif :
   * ils gardent leur liste, leur curseur et leur position de scroll. Changer
   * d'onglet ne fait que glisser le pager — aucune requête, aucun démontage.
   */
  const initialIndex = TABS.findIndex((entry) => entry.id === DEFAULT_TAB);

  useEffect(() => {
    pager.current?.scrollTo({ x: initialIndex * width, animated: false });
  }, [initialIndex, width]);

  // Barres toujours visibles quand on change de fil, ouvre les Reels ou les
  // commentaires, ou quitte l'écran : le masquage ne vaut que pendant le
  // défilement d'un fil.
  useEffect(() => {
    showFeedChrome();
    resetFeedChromeTracking();
  }, [tab, reelsOpen, commentsPost, screenFocused]);
  useEffect(() => () => showFeedChrome(), []);

  const changeTab = useCallback(
    (next: TopTab) => {
      const index = TABS.findIndex((entry) => entry.id === next);
      if (index >= 0) {
        pager.current?.scrollTo({ x: index * width, animated: true });
      }
      setTab(next);
    },
    [width],
  );

  const onPagerSettled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width));
      const next = TABS[index]?.id;
      if (next) {
        setTab(next);
      }
    },
    [width],
  );

  return (
    <View style={styles.screen}>
      <ReAnimated.View style={[styles.screen, feedTransformStyle, feedRadiusStyle]}>
      <ScrollView
        ref={pager}
        testID="feed-horizontal-pager"
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        directionalLockEnabled
        onMomentumScrollEnd={onPagerSettled}
        style={styles.screen}>
        {TABS.map((entry) => (
          <View key={entry.id} style={[styles.screen, { width }]}>
            {entry.id === 'reels' ? (
              <ReelsTabView
                deferNetwork={!homeReady}
                onOpenComments={setCommentsPost}
                hideOverlays={commentsPost !== null}
                playbackActive={tab === 'reels' && screenFocused && appActive}
              />
            ) : (
            <FeedSurfaceView
              tab={entry.id}
              deferNetwork={entry.id !== DEFAULT_TAB && !homeReady}
              onHomeReady={entry.id === DEFAULT_TAB ? markHomeReady : undefined}
              topInset={insets.top}
              onOpenComments={setCommentsPost}
              hideOverlays={commentsPost !== null}
              playbackActive={entry.id === tab && screenFocused && appActive}
              onReelsOpenChange={entry.id === tab ? setReelsOpen : undefined}
            />
            )}
          </View>
        ))}
      </ScrollView>
      </ReAnimated.View>

      {/* Barre du haut FIXE : posée une seule fois au-dessus du pager, elle ne
          glisse pas pendant le swipe horizontal. */}
      {commentsPost || reelsOpen ? null : (
        <FeedTopBar tab={tab} onTabChange={changeTab} topInset={insets.top} />
      )}

      {commentsPost ? (
        <CommentsSheet
          post={commentsPost}
          onClose={() => setCommentsPost(null)}
          sheetPosition={sheetPosition}
        />
      ) : null}
    </View>
  );
}

/** Barre d'onglets + création + recherche, calque fixe au-dessus du fil. */
function FeedTopBar({
  tab,
  onTabChange,
  topInset,
}: {
  tab: TopTab;
  onTabChange: (tab: TopTab) => void;
  topInset: number;
}) {
  // Fil libre façon Instagram : bandeau opaque à la teinte des cartes, les
  // posts défilent dessous.
  const tones = useTextPostTones();
  const openSearch = useCallback(() => router.push('/discover'), []);
  // Masquée au défilement vers le bas, comme Instagram : la barre remonte de
  // toute sa hauteur et revient dès qu'on remonte un peu.
  const barHeight = topInset + FLOW_TOP_BAR;
  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -barHeight * feedChromeHidden.value }],
  }));
  const openCreate = useCallback(() => router.push('/create'), []);

  return (
    <>
    <ReAnimated.View
      pointerEvents="box-none"
      style={[
        styles.fixedTop,
        { height: barHeight, backgroundColor: tab === 'reels' ? 'transparent' : tones.surface },
        tab === 'reels' ? null : slideStyle,
      ]}>
      <View
        style={[styles.topBar, { paddingTop: topInset + Spacing.two }]}
        pointerEvents="box-none">
        <View style={styles.topBarSide} />
        <View style={styles.tabs} accessibilityRole="tablist">
          {TABS.map((entry) => {
            const active = entry.id === tab;
            return (
              <Pressable
                key={entry.id}
                onPress={() => onTabChange(entry.id)}
                hitSlop={8}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={styles.tab}>
                <ThemedText
                  numberOfLines={1}
                  style={[
                    styles.tabLabel,
                    { color: tab === 'reels' ? FeedSurface.onMediaFaint : tones.textFaint },
                    active && styles.tabLabelActive,
                    tab === 'reels' && OnMediaShadow,
                  ]}>
                  {entry.label}
                </ThemedText>
                <View style={[styles.tabUnderline, active && styles.tabUnderlineActive]} />
              </Pressable>
            );
          })}
        </View>
        <View style={[styles.topBarSide, styles.topBarSideRight]}>
          <Pressable
            onPress={openSearch}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={fr.social.discoverSearch}
            style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}>
            <Icon icon={Search} size={22} color={tones.text} />
          </Pressable>
        </View>
      </View>

      <Pressable
        onPress={openCreate}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={fr.social.createTitle}
        style={({ pressed }) => [
          styles.createFab,
          { top: topInset + Spacing.two, left: Spacing.three },
          pressed && styles.pressed,
        ]}>
        <Icon icon={Plus} size={24} color={tones.text} strokeWidth={2.6} />
      </Pressable>
    </ReAnimated.View>
    {/* Zone de la barre d'état : reste couverte quand la barre glisse, comme
        Instagram — le fil ne passe jamais sous l'heure et la batterie. */}
    <View
      pointerEvents="none"
      style={[
        styles.fixedTop,
        { height: topInset, backgroundColor: tab === 'reels' ? 'transparent' : tones.surface },
      ]}
    />
    </>
  );
}

function FeedSurfaceView({
  tab,
  deferNetwork,
  onHomeReady,
  topInset,
  onOpenComments,
  hideOverlays,
  playbackActive,
  onReelsOpenChange,
}: {
  tab: FeedTab;
  /** Onglet voisin au démarrage : pas de requête avant l'accueil. */
  deferNetwork: boolean;
  /** Accueil seulement : son premier contenu est prêt. */
  onHomeReady?: () => void;
  topInset: number;
  onOpenComments: (post: FeedPost) => void;
  hideOverlays: boolean;
  playbackActive: boolean;
  /** Le plein écran Reels s'ouvre ou se ferme (masque la barre du haut). */
  onReelsOpenChange?: (open: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  // Reels ouverts depuis une vidéo verticale du fil : la vidéo touchée puis
  // les suivantes, page par page.
  const [reelsFrom, setReelsFrom] = useState<string | null>(null);
  const [screenHeight, setScreenHeight] = useState(0);
  const feed = useFeed(tab, { deferNetwork });

  // Démarrage : l'écran de lancement natif disparaît quand le fil d'accueil
  // a quelque chose à montrer (posts, état vide ou erreur), jamais avant. Le
  // premier média est préchargé pour s'afficher sans « pop » au fondu.
  const firstPost = feed.items[0];
  const [launchMediaReady, setLaunchMediaReady] = useState(false);
  useEffect(() => {
    if (!onHomeReady || !firstPost || launchMediaReady) {
      return;
    }
    let cancelled = false;
    void prefetchFirstMedia(firstPost).finally(() => {
      if (!cancelled) {
        setLaunchMediaReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [firstPost, launchMediaReady, onHomeReady]);
  const homeContentReady =
    feed.status !== 'loading' && screenHeight > 0 && (!firstPost || launchMediaReady);
  useEffect(() => {
    if (onHomeReady && homeContentReady) {
      markLaunchReady();
      onHomeReady();
    }
  }, [homeContentReady, onHomeReady]);
  // État réseau : le fil reste lisible hors ligne (contenu déjà chargé), mais
  // l'utilisateur doit savoir pourquoi rien de nouveau n'arrive.
  const network = useNetworkState();
  const offline = network.isConnected === false;
  // La vidéo couvre tout l'écran, y compris sous la zone de gestes système —
  // comme un fil vidéo immersif. La barre d'onglets (transparente sur le fil)
  // flotte par-dessus : les overlays remontent de sa hauteur + l'inset pour ne
  // jamais passer dessous, et la ligne de progression se loge dans la bande
  // vide sous les icônes.
  const height = screenHeight;
  const barInset = TabBarHeight + insets.bottom;
  const report = useReportPublication(feed.notifyError);

  // Point de départ des Reels : la vidéo touchée et les vidéos verticales qui
  // la suivent dans le fil. Le fil vidéo dédié prend le relais ensuite.
  const reelSeed = useMemo(() => {
    if (!reelsFrom) {
      return [];
    }
    const start = feed.items.findIndex((item) => item.id === reelsFrom);
    return start < 0 ? [] : feed.items.slice(start).filter(isVideoPost);
  }, [feed.items, reelsFrom]);
  const reelsVisible = reelSeed.length > 0;
  const closeReels = useCallback(() => setReelsFrom(null), []);
  useEffect(() => {
    onReelsOpenChange?.(reelsVisible);
  }, [onReelsOpenChange, reelsVisible]);
  // Retour Android : ferme les Reels avant de quitter le fil.
  useEffect(() => {
    if (!reelsVisible) {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeReels();
      return true;
    });
    return () => subscription.remove();
  }, [closeReels, reelsVisible]);
  const pagerActions = {
    toggleLike: feed.toggleLike,
    setReaction: feed.setReaction,
    dismiss: feed.dismiss,
    muteAuthor: feed.muteAuthor,
    toggleSave: feed.toggleSave,
    toggleRepost: feed.toggleRepost,
    follow: feed.follow,
    remove: feed.remove,
    // Réouverture du compositeur texte en mode édition.
    edit: (post: FeedPost) =>
      router.push(
        post.format === 'text' ? `/create/text?id=${post.id}` : `/post/edit/${post.id}`,
      ),
    report: (post: FeedPost) => report.open(post),
    onOpenComments,
    notifyError: feed.notifyError,
  };

  // Le toast ne doit jamais rester affiché indéfiniment.
  const noticeOpacity = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    if (!feed.notice) {
      return;
    }
    noticeOpacity.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(noticeOpacity, {
        toValue: 1,
        duration: Motion.fast,
        useNativeDriver: true,
      }),
      Animated.delay(NOTICE_DURATION),
      Animated.timing(noticeOpacity, {
        toValue: 0,
        duration: Motion.base,
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [feed.notice, noticeOpacity]);

  return (
    <View
      style={styles.container}
      onLayout={(event) => setScreenHeight(event.nativeEvent.layout.height)}>
      {feed.items.length === 0 ? (
        <View style={styles.emptyFill}>{renderEmpty(feed, tab)}</View>
      ) : (
        <FeedPager
          mode="flow"
          items={feed.items}
          height={height}
          barInset={barInset}
          playbackActive={playbackActive && !reelsVisible}
          refreshing={feed.refreshing}
          hasMore={feed.hasMore}
          hideOverlays={hideOverlays}
          onLoadMore={feed.loadMore}
          onRefresh={feed.refresh}
          onOpenReels={(post) => setReelsFrom(post.id)}
          actions={pagerActions}
        />
      )}

      {reelsVisible ? (
        <ReelsLayer
          // Nouvelle ouverture = nouvelle séquence, en partant de la vidéo touchée.
          key={reelsFrom ?? ''}
          tab={tab}
          seed={reelSeed}
          homeActions={pagerActions}
          onOpenComments={onOpenComments}
          height={height}
          // Barre du bas masquée en Reels : les infos et le rail descendent
          // au-dessus de la seule zone système.
          barInset={insets.bottom + Spacing.four}
          topInset={topInset}
          playbackActive={playbackActive}
          hideOverlays={hideOverlays}
          onClose={closeReels}
        />
      ) : null}

      {offline ? (
        <View style={[styles.offline, { top: topInset + Spacing.six }]} pointerEvents="none">
          <ThemedText type="small" style={styles.offlineText}>
            {fr.social.offlineNotice}
          </ThemedText>
        </View>
      ) : null}

      {feed.notice ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.notice,
            {
              opacity: noticeOpacity,
              top: topInset + Spacing.six,
              backgroundColor:
                feed.notice.tone === 'error' ? 'rgba(180,28,40,0.94)' : 'rgba(20,22,26,0.92)',
            },
          ]}>
          <ThemedText style={styles.noticeText}>{feed.notice.message}</ThemedText>
        </Animated.View>
      ) : null}

      {feed.loadingMore ? (
        <View style={[styles.footer, { bottom: insets.bottom + Spacing.five }]}>
          <ActivityIndicator color={FeedSurface.onMedia} />
        </View>
      ) : null}

      {report.sheet}
    </View>
  );
}

/**
 * Reels plein écran ouverts depuis une vidéo du fil, comme Instagram : la vidéo
 * touchée et celles qui la suivent dans le fil, puis le fil vidéo dédié de
 * l'onglet (`?format=video`), chargé au fur et à mesure. Seules les vidéos
 * verticales y figurent ; les doublons avec le fil d'accueil sont écartés.
 */
/**
 * Onglet « Reels » : le fil vidéo dédié (vidéos verticales seules) en plein
 * écran, page par page, comme l'onglet Reels d'Instagram ou le fil TikTok.
 */
function ReelsTabView({
  deferNetwork,
  onOpenComments,
  hideOverlays,
  playbackActive,
}: {
  deferNetwork: boolean;
  onOpenComments: (post: FeedPost) => void;
  hideOverlays: boolean;
  playbackActive: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  const videos = useFeed('for-you', { format: 'video', deferNetwork });
  const report = useReportPublication(videos.notifyError);
  const items = useMemo(() => videos.items.filter(isVideoPost), [videos.items]);
  const actions: FeedPagerActions = {
    toggleLike: videos.toggleLike,
    setReaction: videos.setReaction,
    dismiss: videos.dismiss,
    muteAuthor: videos.muteAuthor,
    toggleSave: videos.toggleSave,
    toggleRepost: videos.toggleRepost,
    follow: videos.follow,
    remove: videos.remove,
    edit: (post) => router.push(`/post/edit/${post.id}`),
    report: (post) => report.open(post),
    onOpenComments,
    notifyError: videos.notifyError,
  };
  return (
    <View style={styles.container} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
      {height > 0 && items.length > 0 ? (
        <FeedPager
          mode="pager"
          items={items}
          height={height}
          barInset={TabBarHeight + insets.bottom}
          playbackActive={playbackActive}
          refreshing={videos.refreshing}
          hasMore={videos.hasMore}
          hideOverlays={hideOverlays}
          onLoadMore={videos.loadMore}
          onRefresh={videos.refresh}
          actions={actions}
        />
      ) : (
        <View style={styles.emptyFill}>
          {videos.status === 'loading' ? (
            <ActivityIndicator color={FeedSurface.onMedia} />
          ) : (
            <ThemedText style={[styles.centeredText, OnMediaShadow]}>
              {fr.social.reelsEmpty}
            </ThemedText>
          )}
        </View>
      )}
      {report.sheet}
    </View>
  );
}

function ReelsLayer({
  tab,
  seed,
  homeActions,
  onOpenComments,
  height,
  barInset,
  topInset,
  playbackActive,
  hideOverlays,
  onClose,
}: {
  tab: FeedTab;
  seed: FeedPost[];
  homeActions: FeedPagerActions;
  onOpenComments: (post: FeedPost) => void;
  height: number;
  barInset: number;
  topInset: number;
  playbackActive: boolean;
  hideOverlays: boolean;
  onClose: () => void;
}) {
  const videos = useFeed(tab, { format: 'video' });
  // La séquence de départ est figée à l'ouverture : la liste ne saute pas
  // sous le doigt si le fil d'accueil se recharge pendant le visionnage.
  const [seedIds] = useState(() => seed.map((post) => post.id));
  const homeById = useMemo(() => new Map(seed.map((post) => [post.id, post])), [seed]);
  const items = useMemo(() => {
    const head = seedIds
      .map((id) => homeById.get(id))
      .filter((post): post is FeedPost => Boolean(post));
    const taken = new Set(head.map((post) => post.id));
    const more = videos.items.filter((post) => isVideoPost(post) && !taken.has(post.id));
    return [...head, ...more];
  }, [homeById, seedIds, videos.items]);

  // Une action part vers le fil qui détient la publication : le fil d'accueil
  // pour la séquence de départ, le fil vidéo pour la suite.
  const actions = useMemo<FeedPagerActions>(() => {
    const home = (post: FeedPost) => homeById.has(post.id);
    return {
      ...homeActions,
      toggleLike: (post) => (home(post) ? homeActions.toggleLike(post) : videos.toggleLike(post)),
      setReaction: (post, kind) =>
        home(post) ? homeActions.setReaction(post, kind) : videos.setReaction(post, kind),
      dismiss: (post) => (home(post) ? homeActions.dismiss(post) : videos.dismiss(post)),
      muteAuthor: (post) =>
        home(post) ? homeActions.muteAuthor(post) : videos.muteAuthor(post),
      toggleSave: (post) =>
        home(post) ? homeActions.toggleSave(post) : videos.toggleSave(post),
      toggleRepost: (post) =>
        home(post) ? homeActions.toggleRepost(post) : videos.toggleRepost(post),
      follow: (post) => (home(post) ? homeActions.follow(post) : videos.follow(post)),
      remove: (post) => (home(post) ? homeActions.remove(post) : videos.remove(post)),
      onOpenComments,
    };
  }, [homeActions, homeById, onOpenComments, videos]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <FeedPager
        mode="pager"
        items={items}
        initialIndex={0}
        height={height}
        barInset={barInset}
        playbackActive={playbackActive}
        refreshing={false}
        hasMore={videos.hasMore || videos.status === 'loading'}
        hideOverlays={hideOverlays}
        onLoadMore={videos.loadMore}
        onRefresh={() => undefined}
        actions={actions}
      />
      {hideOverlays ? null : (
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={fr.social.reelsClose}
          style={({ pressed }) => [
            styles.reelsBack,
            { top: topInset + Spacing.two },
            pressed && styles.pressed,
          ]}>
          <Icon icon={ChevronLeft} size={28} color={FeedSurface.onMedia} />
        </Pressable>
      )}
    </View>
  );
}

/**
 * Précharge le premier média du fil (image, ou poster d'une vidéo) dans le
 * cache d'`expo-image`, plafonné pour ne jamais retenir l'écran de lancement.
 */
const FIRST_MEDIA_TIMEOUT_MS = 1500;
function prefetchFirstMedia(post: FeedPost): Promise<void> {
  const media = primaryMedia(post);
  const url = resolveMediaUrl(media?.kind === 'video' ? media.posterUrl : media?.url ?? null);
  if (!url) {
    return Promise.resolve();
  }
  return Promise.race([
    Image.prefetch(url).then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => setTimeout(resolve, FIRST_MEDIA_TIMEOUT_MS)),
  ]);
}

function renderEmpty(
  feed: ReturnType<typeof useFeed>,
  tab: FeedTab,
) {
  if (feed.status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={FeedSurface.onMedia} />
        <ThemedText style={styles.centeredText}>{fr.social.feedLoading}</ThemedText>
      </View>
    );
  }
  if (feed.status === 'error') {
    return (
      <View style={styles.centered}>
        <ThemedText style={[styles.centeredTitle, OnMediaShadow]}>
          {fr.social.feedErrorTitle}
        </ThemedText>
        <ThemedText style={[styles.centeredText, OnMediaShadow]}>
          {fr.social.feedErrorBody}
        </ThemedText>
        <Pressable
          onPress={feed.retry}
          accessibilityRole="button"
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
          <ThemedText style={styles.retryText}>{fr.social.feedRetry}</ThemedText>
        </Pressable>
      </View>
    );
  }
  if (tab === 'following') {
    return (
      <View style={styles.centered}>
        <Icon icon={Users} size={40} color={FeedSurface.onMediaFaint} />
        <ThemedText style={[styles.centeredTitle, OnMediaShadow]}>
          {fr.social.feedFollowingTitle}
        </ThemedText>
        <ThemedText style={[styles.centeredText, OnMediaShadow]}>
          {fr.social.feedFollowingBody}
        </ThemedText>
      </View>
    );
  }
  if (tab === 'local') {
    return (
      <View style={styles.centered}>
        <Icon icon={MapPin} size={40} color={FeedSurface.onMediaFaint} />
        <ThemedText style={[styles.centeredTitle, OnMediaShadow]}>
          {fr.social.feedLocalTitle}
        </ThemedText>
        <ThemedText style={[styles.centeredText, OnMediaShadow]}>
          {fr.social.feedLocalBody}
        </ThemedText>
      </View>
    );
  }
  return (
    <View style={styles.centered}>
      <Icon icon={Home} size={40} color={FeedSurface.onMediaFaint} />
      <ThemedText style={[styles.centeredTitle, OnMediaShadow]}>{fr.social.feedTitle}</ThemedText>
      <ThemedText style={[styles.centeredText, OnMediaShadow]}>{fr.social.feedBody}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: FeedSurface.background,
  },
  container: {
    flex: 1,
  },
  emptyFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Calque unique posé au-dessus du pager horizontal : la barre reste fixe
  // pendant le swipe, contrairement aux anciennes copies par onglet.
  reelsBack: {
    position: 'absolute',
    left: Spacing.three,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fixedTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  topBarSide: {
    // Même largeur que le bouton de création : les onglets se centrent dans
    // l'espace restant et ne passent jamais dessous.
    width: 44,
    alignItems: 'flex-start',
  },
  topBarSideRight: {
    alignItems: 'flex-end',
  },
  // `flexShrink` + gaps resserrés : avec une police agrandie, les onglets se
  // compriment autour de la loupe au lieu de la recouvrir.
  tabs: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
    paddingHorizontal: Spacing.one,
  },
  tab: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
    flexShrink: 1,
    minWidth: 0,
  },
  tabLabel: {
    ...Type.body,
    fontWeight: '600',
    color: FeedSurface.onMediaFaint,
  },
  tabLabelActive: {
    // Même cyan que l'onglet actif de la barre du bas.
    color: TabBarSurface.active,
    fontWeight: '700',
  },
  tabUnderline: {
    marginTop: Spacing.one,
    height: 2,
    width: 18,
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  tabUnderlineActive: {
    backgroundColor: TabBarSurface.active,
  },
  roundButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offline: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 12,
    backgroundColor: 'rgba(20,22,26,0.86)',
  },
  offlineText: {
    color: FeedSurface.onMedia,
    fontWeight: '600',
  },
  notice: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '86%',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 12,
  },
  noticeText: {
    color: FeedSurface.onMedia,
    fontWeight: '600',
    textAlign: 'center',
  },
  // Calque transparent cerclé de bleu : le média reste visible dessous et le
  // bouton ne se confond plus avec la pastille « Suivre » (rouge, plus bas).
  createFab: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: FeedSurface.accent,
  },
  footer: {
    position: 'absolute',
    alignSelf: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  centeredTitle: {
    ...Type.sectionTitle,
    color: FeedSurface.onMedia,
    textAlign: 'center',
  },
  centeredText: {
    ...Type.body,
    color: FeedSurface.onMediaSoft,
    textAlign: 'center',
    maxWidth: 320,
  },
  retry: {
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    backgroundColor: FeedSurface.onMedia,
  },
  retryText: {
    ...Type.caption,
    fontWeight: '700',
    color: '#000000',
  },
  pressed: {
    opacity: 0.7,
  },
});
