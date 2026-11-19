import { Home, MapPin, Plus, Search, Users } from 'lucide-react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
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
import { FeedPager } from './pager/feed-pager';
import { OnMediaShadow } from './pager/feed-tokens';
import { useFeed } from './use-feed';
import { useReportPublication } from './use-report-publication';

const TABS: { id: FeedTab; label: string }[] = [
  { id: 'local', label: fr.social.feedTabs.local },
  { id: 'for-you', label: fr.social.feedTabs.forYou },
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
  const [tab, setTab] = useState<FeedTab>(DEFAULT_TAB);
  const [commentsPost, setCommentsPost] = useState<FeedPost | null>(null);
  const pager = useRef<ScrollViewInstance | null>(null);
  const navigation = useNavigation();

  // La barre d'onglets est masquée quand une feuille est ouverte.
  useEffect(() => {
    const hidden = commentsPost !== null;
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
  }, [commentsPost, navigation]);

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
  const feedHeight = Math.max(1, screenHeight - insets.bottom);
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

  const changeTab = useCallback(
    (next: FeedTab) => {
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
            <FeedSurfaceView
              tab={entry.id}
              topInset={insets.top}
              onOpenComments={setCommentsPost}
              hideOverlays={commentsPost !== null}
              playbackActive={entry.id === tab && screenFocused && appActive}
            />
          </View>
        ))}
      </ScrollView>
      </ReAnimated.View>

      {/* Barre du haut FIXE : posée une seule fois au-dessus du pager, elle ne
          glisse pas pendant le swipe horizontal. */}
      {commentsPost ? null : (
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
  tab: FeedTab;
  onTabChange: (tab: FeedTab) => void;
  topInset: number;
}) {
  const openSearch = useCallback(() => router.push('/discover'), []);
  const openCreate = useCallback(() => router.push('/create'), []);

  return (
    <View pointerEvents="box-none" style={styles.fixedTop}>
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
                  style={[styles.tabLabel, active && styles.tabLabelActive, OnMediaShadow]}>
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
            <Icon icon={Search} size={20} color={FeedSurface.onMedia} />
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
        <Icon icon={Plus} size={24} color={FeedSurface.onMedia} strokeWidth={2.6} />
      </Pressable>
    </View>
  );
}

function FeedSurfaceView({
  tab,
  topInset,
  onOpenComments,
  hideOverlays,
  playbackActive,
}: {
  tab: FeedTab;
  topInset: number;
  onOpenComments: (post: FeedPost) => void;
  hideOverlays: boolean;
  playbackActive: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [screenHeight, setScreenHeight] = useState(0);
  const feed = useFeed(tab);
  // État réseau : le fil reste lisible hors ligne (contenu déjà chargé), mais
  // l'utilisateur doit savoir pourquoi rien de nouveau n'arrive.
  const network = useNetworkState();
  const offline = network.isConnected === false;
  // La vidéo ne passe jamais sous la barre système (Retour/Accueil/Récents) :
  // l'item s'arrête juste au-dessus. On retire donc l'inset
  // du bas à la hauteur mesurée par `onLayout`.
  const height = Math.max(0, screenHeight - insets.bottom);
  // La barre d'onglets flotte au-dessus de la vidéo : elle occupe sa propre
  // hauteur utile, et repose sur la barre système. Les overlays remontent de
  // cette valeur pour ne pas se retrouver dessous.
  const barInset = TabBarHeight;
  const report = useReportPublication(feed.notifyError);

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
          items={feed.items}
          height={height}
          barInset={barInset}
          playbackActive={playbackActive}
          refreshing={feed.refreshing}
          hasMore={feed.hasMore}
          hideOverlays={hideOverlays}
          onLoadMore={feed.loadMore}
          onRefresh={feed.refresh}
          actions={{
            toggleLike: feed.toggleLike,
            setReaction: feed.setReaction,
            dismiss: feed.dismiss,
            muteAuthor: feed.muteAuthor,
            toggleSave: feed.toggleSave,
            toggleRepost: feed.toggleRepost,
            follow: feed.follow,
            remove: feed.remove,
            report: (post) => report.open(post),
            onOpenComments,
            notifyError: feed.notifyError,
          }}
        />
      )}

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
  },
  // Calque unique posé au-dessus du pager horizontal : la barre reste fixe
  // pendant le swipe, contrairement aux anciennes copies par onglet.
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
    backgroundColor: 'rgba(0,0,0,0.28)',
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
