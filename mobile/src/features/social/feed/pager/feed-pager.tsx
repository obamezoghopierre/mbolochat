import * as Haptics from 'expo-haptics';
import { NetworkStateType, useNetworkState } from 'expo-network';
import {
  Bookmark,
  CircleUser,
  HeartOff,
  MessageCircleOff,
  Pin,
  EyeOff,
  Flame,
  Info,
  Link2,
  QrCode,
  Share2,
  UserMinus,
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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Image,
  Platform,
  Pressable,
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
import { postDeepLink, postShareLink } from '@/lib/deep-link';
import { trackFeedScroll } from '@/lib/feed-chrome';
import { setFeedPageIsLight } from '@/lib/feed-page-tone';
import { setPendingPostShare } from '@/lib/pending-post-share';
import { sendPostToMany } from '@/lib/send-post-to-many';
import { shareToNetwork } from '@/lib/share-to-network';
import { useThemePreference } from '@/lib/theme-preference';
import type { ConversationSummary, FeedPost, SocialReaction } from '@/lib/types';
import { FeedActionRail, type FeedActions, type FeedActionState } from './action-rail';
import { isVideoPost, primaryMedia } from './feed-media';
import { useTextPostTones } from './feed-tokens';
import { videoPosterUrl, videoSourceUrl } from './video-source';
import { ImagePage } from './image-page';
import { isPageActive, videoPageMode } from './preload';
import { PostInfoBlock } from './post-info';
import { PostQrSheet } from './post-qr-sheet';
import { SuggestedAccountsCard } from '../suggested-accounts-card';
import { AboutAccountSheet } from '../about-account-sheet';
import { SaveCollectionSheet } from '../save-collection-sheet';
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
  /** Annule l'abonnement ou la demande en attente. */
  unfollow: (post: FeedPost) => Promise<boolean>;
  remove: (post: FeedPost) => Promise<void>;
  /** Remplace une publication par la version autoritaire renvoyée par l'API. */
  replacePost: (post: FeedPost) => void;
  /** Ouvre le compositeur en mode édition (posts texte uniquement). */
  edit: (post: FeedPost) => void;
  report: (post: FeedPost) => void;
  /** Ouvre les commentaires dans une feuille au-dessus du feed. */
  onOpenComments: (post: FeedPost) => void;
  notifyError: (message: string) => void;
}

const TOAST_DURATION = 1600;
/** Position de la carte « Suggestions pour toi » dans le fil libre. */
const SUGGESTIONS_AFTER = 4;
/** Barre d'onglets du haut sous la zone sûre, dans le fil libre. */
export const FLOW_TOP_BAR = 52;

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
  mode = 'pager',
  initialIndex = 0,
  onOpenReels,
  freshCount = 0,
  onShowFresh,
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
  /**
   * `flow` : fil d'accueil façon Instagram, défilement libre, toutes les
   * publications en carte (les vidéos verticales aussi, tap = plein écran).
   * `pager` : plein écran page par page (Reels).
   */
  mode?: 'flow' | 'pager';
  /** Page affichée à l'ouverture (Reels ouverts depuis une carte). */
  initialIndex?: number;
  /** Fil libre : ouvre le plein écran Reels sur cette vidéo. */
  onOpenReels?: (post: FeedPost) => void;
  /** Publications arrivées depuis le chargement (bouton « Nouvelles »). */
  freshCount?: number;
  /** Tap sur le bouton : remonter en haut et recharger. */
  onShowFresh?: () => void;
}) {
  const listRef = useRef<FlatList<FeedPost> | null>(null);
  const flow = mode === 'flow';
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
  const tones = useTextPostTones();
  const [activeIndex, setActiveIndex] = useState(initialIndex);

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
  /** Menu ⋯ de l'en-tête de publication (options façon Instagram). */
  const [menuTarget, setMenuTarget] = useState<FeedPost | null>(null);
  /** « À propos de ce compte » : identifiant du compte affiché. */
  const [aboutTarget, setAboutTarget] = useState<string | null>(null);
  /** Publication à ranger dans une collection (« Enregistrer dans… »). */
  const [collectionTarget, setCollectionTarget] = useState<string | null>(null);
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
  // Cartes texte et photo : fond clair en thème clair ; seules les vidéos
  // restent sur fond sombre.
  // Fil libre : tout est en carte, donc clair en thème clair.
  const feedPageIsLight =
    scheme === 'light' && (flow || (!!activeItem && !isVideoPost(activeItem)));
  // Seul le fil visible publie sa teinte : le fil d'accueil et les Reels
  // ouverts par-dessus sont montés ensemble.
  useEffect(() => {
    if (!playbackActive) {
      return;
    }
    setFeedPageIsLight(feedPageIsLight);
    return () => setFeedPageIsLight(false);
  }, [feedPageIsLight, playbackActive]);

  // Bandeau avec action (« Republié · Annuler »), comme Instagram/X.
  const [undo, setUndo] = useState<{ label: string; run: () => void } | null>(null);
  const showToast = useCallback((message: string, undoAction?: { label: string; run: () => void }) => {
    setToast(message);
    setUndo(undoAction ?? null);
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
    toastTimer.current = setTimeout(
      () => {
        setToast(null);
        setUndo(null);
      },
      undoAction ? TOAST_DURATION * 2.5 : TOAST_DURATION,
    );
  }, []);

  /** Republie avec bandeau « Annuler » : un second appel retire la republication. */
  const repostWithUndo = useCallback(
    (target: FeedPost) => {
      const wasReposted = target.viewer.reposted === true;
      void Haptics.selectionAsync().catch(() => undefined);
      void actions.toggleRepost(target);
      if (!wasReposted) {
        const after: FeedPost = { ...target, viewer: { ...target.viewer, reposted: true } };
        showToast(fr.social.repostToast, {
          label: fr.social.undo,
          run: () => void actions.toggleRepost(after),
        });
      }
    },
    [actions, showToast],
  );

  // Fil libre : une carte est « active » (vidéo qui joue, vue comptée) dès
  // qu'elle est à moitié visible ; plein écran : 60 % de la page.
  const viewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: flow ? 50 : 60 }),
    [flow],
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

  /** Options de l'auteur (commentaires, nombre de J'aime), effet au prochain affichage. */
  const setAuthorOption = useCallback(
    async (post: FeedPost, option: 'commentsDisabled' | 'hideLikeCount') => {
      if (!token) {
        return;
      }
      const next = !post[option];
      try {
        const updated = await api.updatePublication(token, post.id, { [option]: next });
        actions.replacePost(updated);
        showToast(
          option === 'commentsDisabled'
            ? next
              ? fr.social.commentsTurnedOff
              : fr.social.commentsTurnedOn
            : next
              ? fr.social.likesHidden
              : fr.social.likesShown,
        );
      } catch {
        actions.notifyError(fr.social.shareError);
      }
    },
    [actions, showToast, token],
  );

  const togglePin = useCallback(
    async (post: FeedPost) => {
      if (!token) {
        return;
      }
      try {
        const updated = await api.pinPublication(token, post.id, !post.pinned);
        actions.replacePost(updated);
        showToast(post.pinned ? fr.social.unpinnedToast : fr.social.pinnedToast);
      } catch (cause) {
        actions.notifyError(cause instanceof Error ? cause.message : fr.social.shareError);
      }
    },
    [actions, showToast, token],
  );

  /** « Ne plus suivre » depuis le menu ⋯. */
  const unfollowAuthor = useCallback(
    async (post: FeedPost) => {
      const removed = await actions.unfollow(post);
      if (removed) {
        showToast(fr.social.unfollowedToast(post.author.displayName));
      }
    },
    [actions, showToast],
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
      try {
        const result = await Share.share({
          message: `${title}\n\n${postShareLink(post.id)}`,
          title,
        });
        if (result.action === Share.sharedAction) {
          trackShare(post);
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '';
        if (!/cancel|dismiss|did not share/i.test(message)) {
          actions.notifyError(fr.social.shareError);
        }
      }
    },
    [actions, trackShare],
  );

  const copyLink = useCallback(
    async (post: FeedPost) => {
      // Vrai presse-papiers, pas la feuille de partage : le libellé promet
      // une copie, pas un envoi.
      if (await copyToClipboard(postShareLink(post.id))) {
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

  // `repostWithUndo` n'est lu que dans les `onPress` des actions : le
  // compilateur craint une lecture de ref au render, d'où la directive.
  const repostSheetActions = REPOST_ACTIONS(
    repostTarget,
    actions,
    () => setRepostTarget(null),
    // eslint-disable-next-line react-hooks/refs
    repostWithUndo,
  );

  const menuActions = useMemo<SheetAction[]>(
    // Le constructeur est pur ; ses callbacks ne lisent des refs qu'au tap.
    // eslint-disable-next-line react-hooks/refs
    () =>
      menuTarget
        ? postMenuActions(menuTarget, {
            own: menuTarget.author.id === user?.id,
            save: () => void actions.toggleSave(menuTarget),
            copyLink: () => void copyLink(menuTarget),
            share: () => setShareTarget(menuTarget),
            qr: () => setQrTarget(menuTarget),
            profile: () => openProfile(menuTarget),
            unfollow: () => void unfollowAuthor(menuTarget),
            about: () => setAboutTarget(menuTarget.author.id),
            toggleComments: () => void setAuthorOption(menuTarget, 'commentsDisabled'),
            toggleLikes: () => void setAuthorOption(menuTarget, 'hideLikeCount'),
            togglePin: () => void togglePin(menuTarget),
            rest: moderationActions(menuTarget, actions, user?.id ?? null, () =>
              setMenuTarget(null),
            ),
          })
        : [],
    [actions, copyLink, menuTarget, openProfile, setAuthorOption, togglePin, unfollowAuthor, user?.id],
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
        ref={listRef as never}
        data={items}
        keyExtractor={(item) => item.id}
        style={styles.flex}
        showsVerticalScrollIndicator={false}
        // Item = écran entier : `pagingEnabled` et `snapToInterval` décrivent
        // alors la même page, donc plus de snap bancal ni de page suivante
        // visible en bas pendant le geste.
        pagingEnabled={!flow}
        snapToInterval={flow ? undefined : height}
        snapToAlignment={flow ? undefined : 'start'}
        // Plein écran : un geste = une page, même lancé vite (comme TikTok).
        disableIntervalMomentum={!flow}
        decelerationRate={flow ? 'normal' : 'fast'}
        // Pendant un glissement sur la barre, le feed ne doit pas bouger.
        scrollEnabled={!scrubbing}
        getItemLayout={
          flow ? undefined : (_, index) => ({ length: height, offset: height * index, index })
        }
        initialScrollIndex={!flow && initialIndex > 0 ? initialIndex : undefined}
        // Fil libre : la barre d'onglets du haut et celle du bas flottent
        // par-dessus ; la liste leur laisse la place.
        // Fil libre : le défilement pilote le masquage des barres haut et bas
        // (seulement pour l'onglet visible, pas pour les fils voisins montés).
        onScroll={
          flow && playbackActive
            ? (event: NativeSyntheticEvent<NativeScrollEvent>) =>
                trackFeedScroll(event.nativeEvent.contentOffset.y)
            : undefined
        }
        scrollEventThrottle={flow ? 16 : undefined}
        contentContainerStyle={
          flow ? { paddingTop: insets.top + FLOW_TOP_BAR, paddingBottom: barInset } : undefined
        }
        ListFooterComponent={
          flow && !hasMore && items.length > 0
            ? () => (
                <ThemedText type="small" style={[styles.flowEnd, { color: tones.textFaint }]}>
                  {fr.social.endOfFeed}
                </ThemedText>
              )
            : undefined
        }
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        // 3 = la page active et ses deux voisines. Seule la page active monte
        // une `VideoView` ; les voisines se contentent d'un poster ou d'un
        // lecteur détaché (cache disque).
        windowSize={flow ? 7 : 3}
        initialNumToRender={flow ? 3 : 2}
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
            progressViewOffset={flow ? insets.top + FLOW_TOP_BAR : undefined}
            tintColor={FeedSurface.onMedia}
            colors={[FeedSurface.onMedia]}
            progressBackgroundColor={FeedSurface.refreshTrack}
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
            flow,
          };
          const doubleTap = (point?: { x: number; y: number } | null) =>
            handleDoubleTap(item, point ?? null);
          const videoMode = videoPageMode(distance, preloadNeighbors);
          const sourceUrl =
            videoMode === 'prefetch' ? videoSourceUrl(item, preferLowQuality) : null;
          // Publication texte ou photo : carte au format Instagram avec son
          // propre pied (barre d'actions horizontale), sans rail vertical ni
          // bloc infos. Seules les vidéos verticales seules restent en plein écran (Reels).
          const isCardPost = flow || !isVideoPost(item);
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
            onToggleSave: () => {
              const willSave = !item.viewer.saved;
              void actions.toggleSave(item);
              // Comme Instagram : « Enregistré · Ajouter à une collection ».
              if (willSave) {
                showToast(fr.social.savedToast, {
                  label: fr.social.saveToCollectionShort,
                  run: () => setCollectionTarget(item.id),
                });
              }
            },
            onPickCollection: () => {
              // L'appui long enregistre d'abord si besoin, puis ouvre le choix.
              if (!item.viewer.saved) {
                void actions.toggleSave(item);
              }
              setCollectionTarget(item.id);
            },
            onToggleRepost: () => setRepostTarget(item),
            onShare: () => setShareTarget(item),
            onMore: () => setMenuTarget(item),
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
            <>
            <View style={[flow ? styles.flowItem : styles.page, flow ? null : { height }, { width: '100%' }]}>
              {!flow && isVideoPost(item) ? (
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
                <>
                {/* Vidéo seule affichée en carte (carrée ou paysage) : même
                    préchargement détaché que les Reels voisins. */}
                {sourceUrl && primaryMedia(item)?.kind === 'video' ? (
                  <VideoPrefetch url={sourceUrl} />
                ) : null}
                <ImagePage
                  post={item}
                  chrome={chrome}
                  actions={railActions}
                  state={railState}
                  likeScale={likeScale}
                  onDoubleTapLike={doubleTap}
                  muted={muted}
                  onToggleMuted={() => setMuted((value) => !value)}
                  onOpenReels={
                    flow && onOpenReels && isVideoPost(item) ? () => onOpenReels(item) : undefined
                  }
                />
                </>
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

              {!isCardPost ? <OverlayScrim /> : null}

              {/* Le média réduit s'affiche seul quand la feuille
                  est ouverte : ni rail d'actions, ni infos auteur/son.
                  Les cartes texte et photo portent leurs actions. */}
              {!hideOverlays && !isCardPost ? (
                <View
                  style={[styles.bottom, { paddingBottom }]}
                  pointerEvents="box-none">
                  <View style={styles.infoColumn} pointerEvents="box-none">
                    <PostInfoBlock
                      post={item}
                      following={item.viewer.followingAuthor}
                      followState={item.viewer.followRequestPending ? 'pending' : 'idle'}
                      showCaption={item.format !== 'text'}
                      railHasAuthor
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
            </View>
            {/* « Suggestions pour toi » après la 4e publication (fil libre). */}
            {flow && token && index === SUGGESTIONS_AFTER - 1 ? (
              <SuggestedAccountsCard token={token} />
            ) : null}
            </>
          );
        }}
      />

      {/* Dégradé haut fixe : les onglets restent lisibles sur les Reels. Le
          fil libre a son propre bandeau opaque (barre du haut). */}
      {flow ? null : <TopScrim />}

      {/* Fin du fil : posée en overlay, jamais en pied de liste — un élément
          supplémentaire casserait le snap plein écran. */}
      {!flow && !hasMore && items.length > 0 && activeIndex === items.length - 1 ? (
        <View style={[styles.endOfFeed, { bottom: barInset + Spacing.four }]} pointerEvents="none">
          <ThemedText type="small" style={styles.endOfFeedText}>
            {fr.social.endOfFeed}
          </ThemedText>
        </View>
      ) : null}

      {/* « Nouvelles publications » : pastille en haut du fil libre. */}
      {flow && freshCount > 0 && onShowFresh ? (
        <View style={[styles.freshWrap, { top: insets.top + FLOW_TOP_BAR + Spacing.two }]} pointerEvents="box-none">
          <Pressable
            onPress={() => {
              listRef.current?.scrollToOffset({ offset: 0, animated: true });
              onShowFresh();
            }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.freshPill, pressed && { opacity: 0.8 }]}>
            <ThemedText type="small" style={styles.freshText}>
              {fr.social.freshPosts(freshCount)}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      {toast ? (
        <View
          style={[styles.toast, styles.toastRow, { bottom: barInset + Spacing.four }]}
          pointerEvents={undo ? 'box-none' : 'none'}>
          <ThemedText type="small" style={styles.toastText}>
            {toast}
          </ThemedText>
          {undo ? (
            <Pressable
              onPress={() => {
                const action = undo;
                setUndo(null);
                setToast(null);
                action.run();
              }}
              hitSlop={10}
              accessibilityRole="button">
              <ThemedText type="small" style={styles.toastAction}>
                {undo.label}
              </ThemedText>
            </Pressable>
          ) : null}
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
              onSendMany={async (conversations, message) => {
                const target = shareTarget;
                if (!target || !token) {
                  return;
                }
                const link = postDeepLink(target.id);
                const sent = await sendPostToMany(token, conversations, link, message);
                setShareTarget(null);
                if (sent > 0) {
                  trackShare(target);
                  showToast(fr.social.shareSentTo(sent));
                } else {
                  actions.notifyError(fr.social.shareError);
                }
              }}
              onSocial={(network) => {
                const target = shareTarget;
                setShareTarget(null);
                if (!target) {
                  return;
                }
                void shareToNetwork(network, postShareLink(target.id)).then((opened) => {
                  if (opened) {
                    trackShare(target);
                  } else {
                    actions.notifyError(fr.social.networkMissing);
                  }
                });
              }}
              onShowQr={() => {
                const target = shareTarget;
                setShareTarget(null);
                setQrTarget(target);
              }}
              extraActions={
                shareTarget
                  ? [
                      // Republier / Citer en tête, comme la feuille Partager
                      // de TikTok (le rail n'a plus de bouton dédié).
                      {
                        key: 'repost',
                        label: shareTarget.viewer.reposted
                          ? fr.social.unrepostLabel
                          : fr.social.repostLabel,
                        icon: Repeat2,
                        onPress: () => {
                          const target = shareTarget;
                          setShareTarget(null);
                          repostWithUndo(target);
                        },
                      },
                      {
                        key: 'quote',
                        label: fr.social.quoteLabel,
                        icon: Quote,
                        onPress: () => {
                          const target = shareTarget;
                          setShareTarget(null);
                          router.push(`/quote/${target.id}`);
                        },
                      },
                    ]
                  : []
              }
              moreActions={
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

      {/* ⋯ de l'en-tête, comme Instagram : actions rapides en tête, puis
          options de la publication. */}
      <ActionSheet
        visible={menuTarget !== null}
        title={menuTarget ? fr.social.postOptionsTitle(menuTarget.author.displayName) : undefined}
        actions={menuActions}
        onClose={() => setMenuTarget(null)}
      />

      <PostQrSheet post={qrTarget} onClose={() => setQrTarget(null)} />

      {token ? (
        <AboutAccountSheet token={token} userId={aboutTarget} onClose={() => setAboutTarget(null)} />
      ) : null}

      {token ? (
        <SaveCollectionSheet
          token={token}
          publicationId={collectionTarget}
          onClose={() => setCollectionTarget(null)}
          onDone={(collection) => showToast(fr.social.savedInCollection(collection.name))}
        />
      ) : null}

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
        actions={repostSheetActions}
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
    // Post texte : compositeur complet. Photo, carrousel ou vidéo : la
    // légende seule, comme Instagram (les médias ne changent pas).
    list.push({
      key: 'edit',
      label: fr.social.editPublication,
      icon: Pencil,
      onPress: run(() => actions.edit(target)),
    });
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

/**
 * Menu ⋯ d'une publication, comme Instagram : Enregistrer, Partager, lien et
 * QR en tête ; puis profil / ne plus suivre / à propos du compte ; puis les
 * options de modération (pas intéressé, masquer, modifier, supprimer,
 * signaler).
 */
function postMenuActions(
  target: FeedPost,
  handlers: {
    own: boolean;
    save: () => void;
    copyLink: () => void;
    share: () => void;
    qr: () => void;
    profile: () => void;
    unfollow: () => void;
    about: () => void;
    toggleComments: () => void;
    toggleLikes: () => void;
    togglePin: () => void;
    rest: ShareSheetAction[];
  },
): SheetAction[] {
  const saved = target.viewer.saved === true;
  const list: SheetAction[] = [
    {
      key: 'save',
      label: saved ? fr.social.savedLabel : fr.social.saveLabel,
      icon: Bookmark,
      selected: saved,
      onPress: handlers.save,
    },
    { key: 'share', label: fr.social.shareLabel, icon: Share2, onPress: handlers.share },
    { key: 'link', label: fr.social.copyLink, icon: Link2, onPress: handlers.copyLink },
    { key: 'qr', label: fr.social.qrCodeLabel, icon: QrCode, onPress: handlers.qr },
  ];
  if (handlers.own) {
    // Réglages de l'auteur, comme Instagram.
    list.push({
      key: 'pin',
      label: target.pinned ? fr.social.unpinFromProfile : fr.social.pinToProfile,
      icon: Pin,
      onPress: handlers.togglePin,
    });
    list.push({
      key: 'likes',
      label: target.hideLikeCount ? fr.social.showLikeCount : fr.social.hideLikeCount,
      icon: HeartOff,
      onPress: handlers.toggleLikes,
    });
    list.push({
      key: 'comments',
      label: target.commentsDisabled ? fr.social.turnOnComments : fr.social.turnOffComments,
      icon: MessageCircleOff,
      onPress: handlers.toggleComments,
    });
  }
  if (!handlers.own) {
    list.push({ key: 'profile', label: fr.social.viewProfile, icon: CircleUser, onPress: handlers.profile });
    if (target.viewer.followingAuthor) {
      list.push({ key: 'unfollow', label: fr.social.unfollow, icon: UserMinus, destructive: true, onPress: handlers.unfollow });
    }
    list.push({ key: 'about', label: fr.social.aboutAccount, icon: Info, onPress: handlers.about });
  }
  // Les options existantes (déjà fermantes) : ActionSheet ferme aussi.
  for (const action of handlers.rest) {
    list.push({ key: action.key, label: action.label, icon: action.icon, destructive: action.danger, onPress: action.onPress });
  }
  return list;
}

/** Actions de republication : republier sur son profil ou citer avec avis. */
function REPOST_ACTIONS(
  target: FeedPost | null,
  actions: FeedPagerActions,
  close: () => void,
  repost: (post: FeedPost) => void,
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
        repost(target);
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
  flowItem: {},
  flowEnd: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
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
  freshWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  freshPill: {
    backgroundColor: FeedSurface.follow,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  freshText: { color: FeedSurface.onFollow, fontWeight: '700' },
  toastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  toastAction: {
    color: FeedSurface.follow,
    fontWeight: '700',
  },
});
