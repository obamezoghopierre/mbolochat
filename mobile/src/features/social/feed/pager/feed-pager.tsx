import * as Haptics from 'expo-haptics';
import { NetworkStateType, useNetworkState } from 'expo-network';
import {
  EyeOff,
  Flame,
  Heart,
  Pencil,
  Quote,
  Repeat2,
  ShieldAlert,
  Star,
  Trash2,
  UserX,
} from 'lucide-react-native';
import { router } from 'expo-router';
import { setVideoCacheSizeAsync } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  type FlatListProps,
  Image,
  Platform,
  RefreshControl,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { ThemedText } from '@/components/themed-text';
import { FeedSurface, Radii, Spacing } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { copyToClipboard } from '@/lib/clipboard';
import { postDeepLink } from '@/lib/deep-link';
import { setFeedPageIsLight } from '@/lib/feed-page-tone';
import { setPendingPostShare } from '@/lib/pending-post-share';
import { useThemePreference } from '@/lib/theme-preference';
import type { ConversationSummary, FeedPost, SocialReaction } from '@/lib/types';
import { FeedActionRail, type FeedActions, type FeedActionState } from './action-rail';
import { isVideoPost, primaryMedia } from './feed-media';
import { videoPosterUrl, videoSourceUrl } from './video-source';
import { ImagePage } from './image-page';
import { isPageActive, videoPageMode } from './preload';
import { PostInfoBlock } from './post-info';
import { PostQrSheet } from './post-qr-sheet';
import { ShareTargetsRow, type ShareSheetAction } from './share-targets';
import { TextPage } from './text-page';
import { FeedViewTracker } from './view-tracker';
import { VideoPage } from './video-page';
import { VideoPrefetch } from './video-prefetch';

export interface FeedPagerActions {
  toggleLike: (post: FeedPost) => Promise<void>;
  /** Change la réaction (ou la retire) : `null` retire. */
  setReaction: (post: FeedPost, kind: SocialReaction | null) => Promise<void>;
  /** « Pas intéressé » : retire la publication du fil. */
  dismiss: (post: FeedPost) => Promise<void>;
  /** Masque toutes les publications de l'auteur. */
  muteAuthor: (post: FeedPost) => Promise<void>;
  toggleSave: (post: FeedPost) => Promise<void>;
  toggleRepost: (post: FeedPost) => Promise<void>;
  follow: (post: FeedPost) => Promise<void>;
  remove: (post: FeedPost) => Promise<void>;
  /** Ouvre le compositeur en mode édition (posts texte uniquement). */
  edit: (post: FeedPost) => void;
  report: (post: FeedPost) => void;
  /** Ouvre les commentaires dans une feuille au-dessus du feed. */
  onOpenComments: (post: FeedPost) => void;
  notifyError: (message: string) => void;
}

const TOAST_DURATION = 1600;

/**
 * `FlatList` animée : obligatoire pour un `onScroll` piloté par
 * `Animated.event` en `useNativeDriver` — une liste simple crashe avec
 * « VirtualizedList must be wrapped with Animated.createAnimatedComponent ».
 */
const AnimatedFlatList = Animated.createAnimatedComponent(
  FlatList as new (props: FlatListProps<FeedPost>) => FlatList<FeedPost>,
);

/**
 * Pager vertical plein écran : une publication par écran, snap
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
  playbackActive,
  refreshing,
  hasMore,
  hideOverlays,
  actions,
  onLoadMore,
  onRefresh,
}: {
  items: FeedPost[];
  /** Hauteur de l'écran entier : un item = un écran. */
  height: number;
  /**
   * Hauteur de la barre de navigation du bas (inset système compris). Les
   * overlays remontent d'autant pour ne jamais passer dessous.
   */
  barInset: number;
  /**
   * L'écran est au premier plan (onglet actif et application ouverte).
   * Une page ne joue que si elle est visible **et** que cet indicateur est vrai :
   * sans cela, le son du fil continuait sous l'onglet Messages.
   */
  playbackActive: boolean;
  /** Un rafraîchissement est en cours (tirer vers le bas). */
  refreshing: boolean;
  /** Reste-t-il des pages à charger ? */
  hasMore: boolean;
  /** Feuille ouverte : le média réduit s'affiche sans rail ni infos. */
  hideOverlays: boolean;
  actions: FeedPagerActions;
  onLoadMore: () => void;
  /** Recharge le fil depuis le début. */
  onRefresh: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Sur réseau mobile, on ne précharge pas la vidéo voisine : le lecteur de la
  // page active suffit, et deux flux simultanés coûtent cher en données.
  const network = useNetworkState();
  const preloadNeighbors = network.type !== NetworkStateType.CELLULAR;
  // En 3G/4G on préfère la variante basse qualité : moins de buffering, moins
  // de données. Le Wi-Fi et l'Ethernet prennent le flux principal.
  const preferLowQuality = network.type === NetworkStateType.CELLULAR;
  const { user, token } = useAuth();
  const { scheme } = useThemePreference();
  const [activeIndex, setActiveIndex] = useState(0);

  const [muted, setMuted] = useState(false);
  // Un glissement sur la barre de progression doit geler le scroll vertical :
  // sinon le Pan du feed entre en concurrence avec celui de la barre.
  const [scrubbing, setScrubbing] = useState(false);
  // Le cœur doit battre sur le post touché, pas sur toutes les pages montées :
  // la clé porte donc l'identifiant du post en plus du compteur.
  const [burst, setBurst] = useState<{
    id: string;
    key: number;
    point: { x: number; y: number } | null;
  }>({ id: '', key: 0, point: null });
  const [shareTarget, setShareTarget] = useState<FeedPost | null>(null);
  const [qrTarget, setQrTarget] = useState<FeedPost | null>(null);
  const [reactionTarget, setReactionTarget] = useState<FeedPost | null>(null);
  const [repostTarget, setRepostTarget] = useState<FeedPost | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const likeScale = useMemo(() => new Animated.Value(1), []);

  // Plafond du cache disque, appliqué une fois. `useVideoPlayer` active ensuite
  // le cache sur chaque source (`useCaching`) : c'est ce couple qui rend une
  // vidéo déjà vue relisible sans réseau. Sans cet appel, la valeur constante
  // restait du code mort et le cache prenait sa taille par défaut (1 Gio).
  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }
    void setVideoCacheSizeAsync(VIDEO_CACHE_BYTES).catch(() => undefined);
  }, []);

  // La barre d'onglets est transparente sur le fil : en thème clair, une page
  // texte a un fond pastel qui rend ses icônes blanches illisibles. On publie
  // l'état « page claire » pour qu'elle passe aux teintes foncées.
  const activeItem = items[activeIndex];
  const feedPageIsLight =
    scheme === 'light' &&
    !!activeItem &&
    !isVideoPost(activeItem) &&
    !primaryMedia(activeItem);
  useEffect(() => {
    setFeedPageIsLight(feedPageIsLight);
    return () => setFeedPageIsLight(false);
  }, [feedPageIsLight]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
    toastTimer.current = setTimeout(() => setToast(null), TOAST_DURATION);
  }, []);

  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 60 }), []);

  // Position verticale du scroll : pilote l'échelle/fondu de chaque page pour
  // une transition de type fil vidéo (la page entrante grandit légèrement,
  // la sortante rétrécit). `useNativeDriver` : aucun rendu React par frame.
  const scrollY = useMemo(() => new Animated.Value(0), []);
  const scrollHandler = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
      }),
    [scrollY],
  );
  const pageAnim = useCallback(
    (index: number) => ({
      transform: [
        {
          scale: scrollY.interpolate({
            inputRange: [(index - 1) * height, index * height, (index + 1) * height],
            outputRange: [0.94, 1, 0.94],
            extrapolate: 'clamp',
          }),
        },
      ],
      opacity: scrollY.interpolate({
        inputRange: [(index - 1) * height, index * height, (index + 1) * height],
        outputRange: [0.55, 1, 0.55],
        extrapolate: 'clamp',
      }),
    }),
    [scrollY, height],
  );

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
    (post: FeedPost, point: { x: number; y: number } | null = null) => {
      setBurst((current) => ({ id: post.id, key: current.key + 1, point }));
      // Retour haptique immédiat : c'est ce qui rend le double-tap « physique ».
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
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

  const openProfile = useCallback((post: FeedPost) => {
    router.push(`/user/${post.author.id}`);
  }, []);

  /** Compteur de partages : chaque action de partage est un événement. */
  const trackShare = useCallback(
    (post: FeedPost) => {
      if (!token) {
        return;
      }
      void api.sharePublication(token, post.id).catch(() => undefined);
    },
    [token],
  );

  const share = useCallback(
    async (post: FeedPost) => {
      const caption = (post.caption ?? '').trim();
      const title = caption.length > 0 ? caption : `Publication de ${post.author.displayName}`;
      trackShare(post);
      try {
        await Share.share({
          message: `${title}\n\n${postDeepLink(post.id)}`,
          title,
        });
      } catch {
        actions.notifyError(fr.social.shareError);
      }
    },
    [actions, trackShare],
  );

  const copyLink = useCallback(
    async (post: FeedPost) => {
      // Vrai presse-papiers, pas la feuille de partage : le libellé promet
      // une copie, pas un envoi.
      if (await copyToClipboard(postDeepLink(post.id))) {
        trackShare(post);
        showToast(fr.social.linkCopied);
      } else {
        actions.notifyError(fr.social.shareError);
      }
    },
    [actions, showToast, trackShare],
  );

  const sendPostToConversation = useCallback(
    (conversation: ConversationSummary) => {
      const target = shareTarget;
      if (!target) {
        return;
      }
      setShareTarget(null);
      // Le chat envoie le lien profond via son transport (clair ou E2EE)
      // à l'arrivée sur l'écran.
      setPendingPostShare({ publicationId: target.id });
      trackShare(target);
      router.push(`/chat/${conversation.id}`);
    },
    [shareTarget, trackShare],
  );

  if (height <= 0) {
    return <View style={styles.flex} />;
  }

  // Hauteur explicite identique à celle des items : sans elle, la `FlatList`
  // occupe la zone de l'onglet et le snap se cale sur une autre référence que
  // la hauteur d'item, ce qui laisse apparaître la page suivante en bas.
  return (
    <View style={[styles.flex, { height }]}>
      <AnimatedFlatList
        data={items}
        keyExtractor={(item) => item.id}
        style={styles.flex}
        showsVerticalScrollIndicator={false}
        // Item = écran entier : `pagingEnabled` et `snapToInterval` décrivent
        // alors la même page, donc plus de snap bancal ni de page suivante
        // visible en bas pendant le geste.
        pagingEnabled
        snapToInterval={height}
        snapToAlignment="start"
        // Pendant un glissement sur la barre, le feed ne doit pas bouger.
        scrollEnabled={!scrubbing}
        getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        // 3 = la page active et ses deux voisines. Seule la page active monte
        // une `VideoView` ; les voisines se contentent d'un poster ou d'un
        // lecteur détaché (cache disque).
        windowSize={3}
        initialNumToRender={2}
        maxToRenderPerBatch={3}
        // Désactivé explicitement : sur Android c'est **actif par défaut**, et
        // le détachement d'une `TextureVideoView` encore rattachée à un lecteur
        // est précisément ce qui déclenche l'IllegalStateException au scroll.
        removeClippedSubviews={false}
        onEndReached={onLoadMore}
        // Anticipe une page à l'avance : la requête part avant le dernier item.
        onEndReachedThreshold={1.5}
        // Tirer vers le bas recharge le classement depuis le début.
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={FeedSurface.onMedia}
            colors={[FeedSurface.onMedia]}
            progressBackgroundColor="rgba(0,0,0,0.6)"
          />
        }
        renderItem={({ item, index }) => {
          const distance = index - activeIndex;
          const isActive = isPageActive(index, activeIndex, playbackActive);
          const chrome = {
            height,
            barInset,
            isActive,
            // 0 sur les autres pages : seule celle du post touché rejoue.
            burstKey: burst.id === item.id ? burst.key : 0,
            burstPoint: burst.id === item.id ? burst.point : null,
            likeScale,
            hideOverlays,
          };
          const doubleTap = (point?: { x: number; y: number } | null) =>
            handleDoubleTap(item, point ?? null);
          const videoMode = videoPageMode(distance, preloadNeighbors);
          const sourceUrl =
            videoMode === 'prefetch' ? videoSourceUrl(item, preferLowQuality) : null;
          // Publication texte : la carte porte son propre pied de post
          // (barre d'actions horizontale), sans rail vertical ni bloc infos.
          const isTextPost = !isVideoPost(item) && !primaryMedia(item);
          const railState: FeedActionState = {
            reacted: item.viewer.reaction !== null,
            saved: Boolean(item.viewer.saved),
            reposted: Boolean(item.viewer.reposted),
            following: item.viewer.followingAuthor,
            toast: null,
          };
          const railActions: FeedActions = {
            onToggleLike: () => {
              // Retour haptique léger : le cœur doit « répondre »
              // comme le double-tap, en plus discret.
              void Haptics.selectionAsync().catch(() => undefined);
              void actions.toggleLike(item);
            },
            onPickReaction: () => setReactionTarget(item),
            onOpenComments: () => actions.onOpenComments(item),
            onToggleSave: () => void actions.toggleSave(item),
            onToggleRepost: () => setRepostTarget(item),
            onShare: () => setShareTarget(item),
            onOpenProfile: () => openProfile(item),
            onFollow: item.viewer.followingAuthor
              ? null
              : () => void actions.follow(item),
          };
          // Le bloc infos et le rail partagent la même ancre basse : ils
          // se posent ~35 px au-dessus du cluster icônes+libellés de la
          // barre d'onglets — la position basse d'un fil vidéo, sans jamais
          // passer dessous. La ligne de progression vit dans la bande basse
          // de la barre : pas d'espace à réserver ici.
          const paddingBottom = barInset - Spacing.two;

          return (
            <Animated.View style={[styles.page, { height, width: '100%' }, pageAnim(index)]}>
              {isVideoPost(item) ? (
                videoMode === 'play' ? (
                  <VideoPage
                    post={item}
                    chrome={chrome}
                    preferLowQuality={preferLowQuality}
                    onDoubleTapLike={doubleTap}
                    muted={muted}
                    scrubbing={scrubbing}
                    onToggleSound={() => setMuted((value) => !value)}
                    onScrubStateChange={setScrubbing}
                  />
                ) : videoMode === 'prefetch' ? (
                  // Voisine : lecteur détaché (aucune vue) pour remplir le
                  // cache, plus son poster affiché en attendant.
                  <>
                    {sourceUrl ? <VideoPrefetch url={sourceUrl} /> : null}
                    <VideoPoster post={item} height={height} />
                  </>
                ) : (
                  // Réseau mobile : la voisine affiche son poster, sans lecteur.
                  <VideoPoster post={item} height={height} />
                )
              ) : primaryMedia(item) ? (
                <ImagePage post={item} chrome={chrome} onDoubleTapLike={doubleTap} />
              ) : (
                <TextPage
                  post={item}
                  chrome={chrome}
                  actions={railActions}
                  state={railState}
                  likeScale={likeScale}
                  onDoubleTapLike={doubleTap}
                />
              )}

              {/* Consommation : temps réellement visible, envoyé au serveur au
                  moment où la page cesse d'être active. */}
              <FeedViewTracker
                publicationId={item.id}
                active={isActive}
                durationMs={primaryMedia(item)?.durationMs ?? null}
              />

              {!isTextPost ? <OverlayScrim /> : null}

              {/* Le média réduit s'affiche seul quand la feuille
                  est ouverte : ni rail d'actions, ni infos auteur/son.
                  Les posts texte portent leurs actions dans la carte. */}
              {!hideOverlays && !isTextPost ? (
                <View
                  style={[styles.bottom, { paddingBottom }]}
                  pointerEvents="box-none">
                  <View style={styles.infoColumn} pointerEvents="box-none">
                    <PostInfoBlock
                      post={item}
                      following={item.viewer.followingAuthor}
                      followState="idle"
                      showCaption={item.format !== 'text'}
                      onFollow={() => void actions.follow(item)}
                      onOpenProfile={() => openProfile(item)}
                    />
                  </View>

                  <FeedActionRail
                    post={item}
                    likeScale={likeScale}
                    state={railState}
                    actions={railActions}
                  />
                </View>
              ) : null}
            </Animated.View>
          );
        }}
      />

      {/* Dégradé haut fixe : les onglets restent lisibles pendant le scroll. */}
      <TopScrim />

      {/* Fin du fil : posée en overlay, jamais en pied de liste — un élément
          supplémentaire casserait le snap plein écran. */}
      {!hasMore && items.length > 0 && activeIndex === items.length - 1 ? (
        <View style={[styles.endOfFeed, { bottom: barInset + Spacing.four }]} pointerEvents="none">
          <ThemedText type="small" style={styles.endOfFeedText}>
            {fr.social.endOfFeed}
          </ThemedText>
        </View>
      ) : null}

      {toast ? (
        <View style={[styles.toast, { bottom: insets.bottom + Spacing.six }]} pointerEvents="none">
          <ThemedText type="small" style={styles.toastText}>
            {toast}
          </ThemedText>
        </View>
      ) : null}

      {/* Feuille de partage façon Instagram : discussions récentes en
          en-tête, puis copier le lien ou feuille de partage système. */}
      <ActionSheet
        visible={shareTarget !== null}
        title={fr.social.shareLabel}
        subtitle={shareTarget ? `Publication de ${shareTarget.author.displayName}` : undefined}
        header={
          shareTarget && token ? (
            <ShareTargetsRow
              token={token}
              currentUserId={user?.id ?? null}
              onPick={sendPostToConversation}
              onCopyLink={() => {
                setShareTarget(null);
                void copyLink(shareTarget);
              }}
              onShare={() => {
                setShareTarget(null);
                void share(shareTarget);
              }}
              onShareTo={() => {
                const target = shareTarget;
                setShareTarget(null);
                if (target) {
                  router.push(`/share-post/${target.id}`);
                }
              }}
              onShowQr={() => {
                const target = shareTarget;
                setShareTarget(null);
                setQrTarget(target);
              }}
              extraActions={
                shareTarget
                  ? moderationActions(shareTarget, actions, user?.id ?? null, () =>
                      setShareTarget(null),
                    )
                  : []
              }
            />
          ) : null
        }
        actions={[]}
        onClose={() => setShareTarget(null)}
      />

      <PostQrSheet post={qrTarget} onClose={() => setQrTarget(null)} />

      {/* Sélecteur de réaction : appui long sur le cœur du rail. */}
      <ActionSheet
        visible={reactionTarget !== null}
        title={fr.social.reactionPickerTitle}
        actions={REACTION_ACTIONS(reactionTarget, actions, () => setReactionTarget(null))}
        onClose={() => setReactionTarget(null)}
      />

      {/* Republication façon Instagram : republier ou citer. */}
      <ActionSheet
        visible={repostTarget !== null}
        title={fr.social.repostSheetTitle}
        actions={REPOST_ACTIONS(repostTarget, actions, () => setRepostTarget(null))}
        onClose={() => setRepostTarget(null)}
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
const SCRIM_HEIGHT = 190;
const SCRIM_MAX_OPACITY = 0.55;

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

/** Nombre de bandes du dégradé sous les onglets. */
const TOP_SCRIM_BANDS = 12;
/** Hauteur du dégradé haut : laisse respirer les onglets sans voiler le média. */
const TOP_SCRIM_HEIGHT = 96;

const TOP_SCRIM_COLORS = Array.from({ length: TOP_SCRIM_BANDS }, (_, index) => {
  const alpha = (1 - index / (TOP_SCRIM_BANDS - 1)) * 0.42;
  return `rgba(0,0,0,${alpha.toFixed(3)})`;
});

/**
 * Dégradé haut posé une seule fois au-dessus du pager : les onglets restent
 * lisibles sur n'importe quelle vidéo, sans bandeau opaque qui casserait le
 * plein écran.
 */
function TopScrim() {
  return (
    <View pointerEvents="none" style={styles.topScrim}>
      {TOP_SCRIM_COLORS.map((color) => (
        <View key={color} style={[styles.topScrimBand, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

/**
 * Actions de modération de la feuille Partager (ex- menu ⋯) : « Pas
 * intéressé » et « Masquer cet auteur » pour le contenu des autres,
 * « Supprimer » pour le sien, « Signaler » dans les deux cas.
 */
function moderationActions(
  target: FeedPost,
  actions: FeedPagerActions,
  currentUserId: string | null,
  close: () => void,
): ShareSheetAction[] {
  const own = target.author.id === currentUserId;
  const run = (fn: () => void | Promise<void>) => () => {
    close();
    void fn();
  };
  const list: ShareSheetAction[] = own
    ? []
    : [
        {
          key: 'not-interested',
          label: fr.social.notInterested,
          icon: EyeOff,
          onPress: run(() => actions.dismiss(target)),
        },
        {
          key: 'mute-author',
          label: fr.social.muteAuthor,
          icon: UserX,
          onPress: run(() => actions.muteAuthor(target)),
        },
      ];
  if (own) {
    // « Modifier » n'a de sens que pour un post texte : le compositeur
    // d'édition ne sait pas encore reprendre les publications média.
    if (target.format === 'text') {
      list.push({
        key: 'edit',
        label: fr.social.editPublication,
        icon: Pencil,
        onPress: run(() => actions.edit(target)),
      });
    }
    list.push({
      key: 'delete',
      label: fr.social.deletePublication,
      icon: Trash2,
      danger: true,
      onPress: run(() => actions.remove(target)),
    });
  }
  list.push({
    key: 'report',
    label: fr.social.reportPublication,
    icon: ShieldAlert,
    danger: true,
    onPress: run(() => actions.report(target)),
  });
  return list;
}

/** Actions de republication : republier sur son profil ou citer avec avis. */
function REPOST_ACTIONS(
  target: FeedPost | null,
  actions: FeedPagerActions,
  close: () => void,
): SheetAction[] {
  if (!target) {
    return [];
  }
  const reposted = target.viewer.reposted === true;
  return [
    {
      key: 'repost',
      label: reposted ? fr.social.unrepostLabel : fr.social.repostLabel,
      icon: Repeat2,
      selected: reposted,
      onPress: () => {
        close();
        void actions.toggleRepost(target);
      },
    },
    {
      key: 'quote',
      label: fr.social.quoteLabel,
      icon: Quote,
      onPress: () => {
        close();
        router.push(`/quote/${target.id}`);
      },
    },
  ];
}

/** Actions du sélecteur de réaction, construites pour la publication ciblée. */
function REACTION_ACTIONS(
  target: FeedPost | null,
  actions: FeedPagerActions,
  close: () => void,
): SheetAction[] {
  if (!target) {
    return [];
  }
  const pick = (kind: SocialReaction | null) => () => {
    close();
    void actions.setReaction(target, kind);
  };
  return [
    { key: 'like', label: 'J’aime', icon: Heart, selected: target.viewer.reaction === 'like', onPress: pick('like') },
    { key: 'love', label: 'J’adore', icon: Heart, selected: target.viewer.reaction === 'love', onPress: pick('love') },
    { key: 'fire', label: 'Feu', icon: Flame, selected: target.viewer.reaction === 'fire', onPress: pick('fire') },
    { key: 'clap', label: 'Bravo', icon: Star, selected: target.viewer.reaction === 'clap', onPress: pick('clap') },
    {
      key: 'none',
      label: 'Retirer ma réaction',
      icon: Trash2,
      destructive: true,
      selected: target.viewer.reaction === null,
      onPress: pick(null),
    },
  ];
}

/** Poster seul, sans lecteur : voisine non préchargée (réseau mobile). */
function VideoPoster({ post, height }: { post: FeedPost; height: number }) {
  const poster = videoPosterUrl(post);
  return (
    <View style={[styles.page, { height }]}>
      {poster ? (
        <Image source={{ uri: poster }} style={styles.surface} resizeMode="cover" />
      ) : (
        <View style={styles.surface} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: {
    backgroundColor: FeedSurface.background,
  },
  // Poster de la voisine non préchargée : mêmes bornes que la surface native.
  surface: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: TOP_SCRIM_HEIGHT,
  },
  topScrimBand: {
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
  endOfFeed: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  endOfFeedText: {
    color: FeedSurface.onMedia,
    fontWeight: '600',
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
