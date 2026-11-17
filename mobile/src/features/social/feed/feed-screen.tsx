import { Home, MapPin, Plus, Search, Users } from 'lucide-react-native';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedSurface, Motion, Radii, Spacing, TabBarHeight, Type } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { FeedPager } from './pager/feed-pager';
import { OnMediaShadow } from './pager/feed-tokens';
import { useFeed } from './use-feed';
import { useReportPublication } from './use-report-publication';
import type { FeedTab } from '@/lib/types';

const TABS: { id: FeedTab; label: string }[] = [
  { id: 'following', label: fr.social.feedTabs.following },
  { id: 'for-you', label: fr.social.feedTabs.forYou },
  { id: 'local', label: fr.social.feedTabs.local },
];

const DEFAULT_TAB: FeedTab = 'for-you';
const NOTICE_DURATION = 2600;

/**
 * Fil social plein écran façon TikTok :
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
  const [tab, setTab] = useState<FeedTab>(DEFAULT_TAB);

  return (
    <View style={styles.screen}>
      {/* Remonter le fil à chaque onglet évite de réutiliser un curseur d'un
          autre classement. */}
      <FeedSurfaceView key={tab} tab={tab} onTabChange={setTab} topInset={insets.top} />
    </View>
  );
}

function FeedSurfaceView({
  tab,
  onTabChange,
  topInset,
}: {
  tab: FeedTab;
  onTabChange: (tab: FeedTab) => void;
  topInset: number;
}) {
  const insets = useSafeAreaInsets();
  const [screenHeight, setScreenHeight] = useState(0);
  const feed = useFeed(tab);
  // La vidéo ne passe jamais sous la barre système (Retour/Accueil/Récents) :
  // l'item s'arrête juste au-dessus, comme sur TikTok. On retire donc l'inset
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

  const openSearch = useCallback(() => router.push('/discover'), []);
  const openCreate = useCallback(() => router.push('/create'), []);

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
          onLoadMore={feed.loadMore}
          actions={{
            toggleLike: feed.toggleLike,
            toggleSave: feed.toggleSave,
            toggleRepost: feed.toggleRepost,
            follow: feed.follow,
            remove: feed.remove,
            report: (post) => report.open(post),
            notifyError: feed.notifyError,
          }}
        />
      )}

      {/* Onglets posés sur le média, comme TikTok : jamais de bandeau opaque. */}
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
                  allowFontScaling={false}
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

      {/* Création : à gauche, sur la même ligne que la barre d'onglets, en face
          de « Abonnements ». Rendue ICI et non dans `topBar` : c'est un calque
          indépendant posé sur le média, il ne fait pas partie de la barre. */}
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
    color: FeedSurface.onMedia,
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
    backgroundColor: FeedSurface.onMedia,
  },
  roundButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.28)',
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
  // bouton ne se confond plus avec la pastille « Suivre » (jaune, plus bas).
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
