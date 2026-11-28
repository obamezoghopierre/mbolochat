import { Redirect, router, useLocalSearchParams, useNavigation } from 'expo-router';
import {
  Bookmark,
  Compass,
  Flag,
  EyeOff,
  Repeat2,
  Search,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  type TextInputInstance,
  View,
} from 'react-native';
import { useNetworkState } from 'expo-network';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet } from '@/components/action-sheet';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing, TabBarHeight, Type } from '@/constants/theme';
import { DiscoverViewer } from '@/features/social/discover/discover-viewer';
import {
  DiscoverExploreGrid,
  type DiscoverExploreGridHandle,
} from '@/features/social/discover/discover-explore-grid';
import { readDiscoverSnapshot } from '@/features/social/discover/discover-snapshot';
import { SearchHistoryPanel } from '@/features/social/discover/search-history-panel';
import { SearchResultsList } from '@/features/social/discover/search-results-list';
import { SearchFilterTabs } from '@/features/social/discover/search-filter-tabs';
import {
  blockForFilter,
  buildSearchEntries,
  hasSearchContent,
  normalizeSearchQuery,
  type SearchBlockKey,
  type SearchFilter,
} from '@/features/social/discover/search-model';
import {
  clearSearchHistory,
  hydrateSearchHistory,
  readSearchHistory,
  removeSearchHistory,
  saveSearchHistory,
} from '@/features/social/discover/search-history';
import { useDiscoverFeed } from '@/features/social/discover/use-discover-feed';
import { useSearchResults } from '@/features/social/discover/use-search-results';
import { useReportPublication } from '@/features/social/feed/use-report-publication';
import { useTheme } from '@/hooks/use-theme';
import { discoverFr } from '@/i18n/discover-fr';
import { fr } from '@/i18n/fr';
import { useAuth } from '@/lib/auth-context';
import type { FeedPost } from '@/lib/types';

/**
 * Découvrir : mosaïque Explorer plein écran (une seule grille continue, sans
 * rail ni section), et recherche unifiée (comptes, publications, hashtags)
 * dès qu'une requête est saisie.
 *
 * La recherche imite Instagram : historique des recherches récentes au focus
 * du champ, suggestions pendant la saisie, bouton « Annuler » qui rend la
 * mosaïque, onglets de filtre sur les résultats, grille de vignettes pour les
 * publications trouvées, suivi en ligne des comptes, et pagination par
 * curseur quand un onglet précis est ouvert. L'historique n'enregistre que
 * les recherches menées à leur terme (Entrée, résultat ouvert, entrée
 * reprise), jamais les préfixes d'une frappe.
 *
 * La grille et les résultats portent chacun une liste vivante ; la
 * visionneuse lit celle dont elle a été ouverte, donc une réaction ou un
 * « Pas intéressé » pris dedans met à jour la source au retour.
 */
export default function DiscoverScreen() {
  const { token, loading, user } = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const network = useNetworkState();
  const params = useLocalSearchParams<{ q?: string }>();

  const [query, setQuery] = useState(typeof params.q === 'string' ? params.q : '');
  // Champ de recherche : « Annuler » et la touche Entrée rendent le clavier.
  const inputRef = useRef<TextInputInstance>(null);
  // Un hashtag touché dans le fil ouvre cet onglet avec `?q=#tag` : l'onglet
  // peut déjà être monté, donc on suit le paramètre et pas seulement sa
  // valeur initiale (ajustement d'état au render, sans effet en cascade).
  const [seenQuery, setSeenQuery] = useState(params.q);
  if (params.q !== seenQuery) {
    setSeenQuery(params.q);
    if (typeof params.q === 'string') {
      setQuery(params.q);
    }
  }
  // Focus du champ : l'historique et les suggestions s'affichent à ce moment.
  const [focused, setFocused] = useState(false);
  // Historique des recherches récentes du compte.
  const [history, setHistory] = useState<string[]>([]);
  const [historyOwner, setHistoryOwner] = useState<string | null>(user?.id ?? null);
  if (user?.id !== historyOwner) {
    // Changement de compte (ou déconnecté) : l'historique du précédent ne
    // s'applique pas, on repart d'une liste vide (ajustement au render).
    setHistoryOwner(user?.id ?? null);
    setHistory([]);
  }
  // Onglet de filtre actif sur les résultats.
  const [filter, setFilter] = useState<SearchFilter>('all');
  const searching = normalizeSearchQuery(query) !== '';
  const offline = network.isConnected === false || network.isInternetReachable === false;

  // Première page de la grille gardée sur l'appareil : les vignettes
  // s'affichent tout de suite, le réseau les remplace en arrière-plan.
  const initialPage = useMemo(
    () => (user?.id ? readDiscoverSnapshot(user.id) : null),
    [user],
  );

  // L'API de la grille ne renvoie pas l'état du lecteur : la grille démarre
  // sans réaction ni signet, et la visionneuse récupère le détail exact de
  // la publication ouverte.
  const hydrate = useMemo(
    () => ({ viewer: { reaction: null, followingAuthor: false } }),
    [],
  );

  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(timer);
  }, [notice]);

  const feed = useDiscoverFeed({
    token: token ?? '',
    initialPage,
    hydrate,
    onError: setNotice,
  });
  const search = useSearchResults({
    token: token ?? '',
    query,
    filter,
    hydrate,
    onError: setNotice,
  });
  const entries = useMemo(
    () =>
      search.result
        ? buildSearchEntries(search.result, search.posts, filter)
        : [],
    [search.result, search.posts, filter],
  );

  const gridRef = useRef<DiscoverExploreGridHandle | null>(null);
  // Visionneuse : `feed` lit la grille vivante, `search` la liste des
  // publications trouvées. Seule la position est gardée ici.
  const [viewer, setViewer] = useState<{
    source: 'feed' | 'search';
    index: number;
    gridIndex?: number;
  } | null>(null);
  const navigation = useNavigation();
  // Publication sur laquelle la longue-pression a ouvert le menu rapide, et
  // la liste dont elle vient (la grille ou les résultats de recherche).
  const [menu, setMenu] = useState<{
    post: FeedPost;
    index: number;
    source: 'feed' | 'search';
  } | null>(null);
  const report = useReportPublication((message) => setNotice(message));

  // Liste réellement affichée par la visionneuse, et index borné : un
  // « Pas intéressé » peut raccourcir la liste pendant qu'elle est ouverte.
  const viewerItems = viewer
    ? viewer.source === 'search'
      ? search.posts
      : feed.items
    : [];
  const viewerIndex = viewer
    ? Math.min(viewer.index, Math.max(0, viewerItems.length - 1))
    : 0;
  const viewerActions = viewer?.source === 'search' ? search.actions : feed.actions;

  // Chargement de l'historique au changement de compte. La liste démarre
  // vide ; l'asynchrone remplit l'état, sans setState synchrone dans l'effet.
  useEffect(() => {
    const accountId = user?.id;
    if (!accountId) {
      return;
    }
    let active = true;
    void hydrateSearchHistory(accountId).then(() => {
      if (active) {
        setHistory(readSearchHistory(accountId));
      }
    });
    return () => {
      active = false;
    };
  }, [user?.id]);

  // Visionneuse plein écran : la barre d'onglets se masque, comme les
  // Reels du fil — le média prend toute la hauteur de l'écran.
  useEffect(() => {
    const hidden = viewer !== null;
    navigation.setOptions({
      tabBarHidden: hidden,
      // Le conteneur du tab bar doit aussi se rétracter, sinon React
      // Navigation réserve 58 px vides sous le média.
      tabBarStyle: hidden ? { display: 'none', height: 0 } : undefined,
    } as never);
    return () => {
      navigation.setOptions({
        tabBarHidden: false,
        tabBarStyle: undefined,
      } as never);
    };
  }, [navigation, viewer]);

  const changeQuery = (value: string) => {
    // Une nouvelle saisie repart du filtre « Tout » : un onglet laissé actif
    // ne doit pas masquer les résultats de la recherche suivante.
    if (normalizeSearchQuery(value) !== normalizeSearchQuery(query)) {
      setFilter('all');
    }
    setQuery(value);
  };

  /**
   * Retient la recherche courante dans l'historique. Appelé quand la
   * recherche est réellement engagée (Entrée, résultat ouvert, entrée
   * reprise) et non à chaque frappe : sinon chaque pause de saisie y
   * laisserait un préfixe.
   */
  const rememberQuery = useCallback(() => {
    const normalized = normalizeSearchQuery(query);
    if (normalized !== '') {
      setHistory(saveSearchHistory(user?.id ?? null, normalized));
    }
  }, [query, user?.id]);

  /** Entrée au clavier : la recherche est retenue, le clavier se referme. */
  const submitSearch = () => {
    rememberQuery();
    Keyboard.dismiss();
  };

  /** « Annuler » : vide la saisie, referme le clavier et rend la mosaïque. */
  const cancelSearch = () => {
    changeQuery('');
    Keyboard.dismiss();
    inputRef.current?.blur();
  };

  const pickHistory = (entry: string) => {
    setQuery(entry);
    setHistory(saveSearchHistory(user?.id ?? null, entry));
    Keyboard.dismiss();
  };

  const removeHistory = (entry: string) => {
    setHistory(removeSearchHistory(user?.id ?? null, entry));
  };

  const clearHistory = () => {
    setHistory(clearSearchHistory(user?.id ?? null));
  };

  const closeViewer = () => {
    // Retour à la vignette ouverte, comme un retour d'écran publication.
    setViewer((current) => {
      if (current?.gridIndex !== undefined) {
        gridRef.current?.scrollToIndex(current.gridIndex);
      }
      return null;
    });
  };

  // Ouvre la visionneuse sur la grille : callback stable pour que les
  // vignettes mémorisées ne se rerendent pas sans raison.
  const openGridPost = useCallback((_post: FeedPost, index: number) => {
    setViewer({ source: 'feed', index, gridIndex: index });
  }, []);

  // Ouvre la visionneuse sur un résultat de recherche, en retenant la
  // requête : c'est une recherche menée à son terme.
  const openSearchPost = useCallback(
    (_post: FeedPost, index: number) => {
      rememberQuery();
      setViewer({ source: 'search', index });
    },
    [rememberQuery],
  );

  const handleDoubleTapLike = useCallback(
    (post: FeedPost) => {
      feed.actions.toggleLike(post);
    },
    [feed.actions],
  );

  // Double-tap sur une vignette de résultat : la liste de recherche, pas la
  // grille — les deux listes ont leurs propres publications.
  const handleSearchDoubleTapLike = useCallback(
    (post: FeedPost) => {
      search.actions.toggleLike(post);
    },
    [search.actions],
  );

  const openTileMenu = (post: FeedPost, index: number) => {
    setMenu({ post, index, source: 'feed' });
  };

  const openSearchTileMenu = (post: FeedPost, index: number) => {
    setMenu({ post, index, source: 'search' });
  };

  const closeTileMenu = () => {
    setMenu(null);
  };

  // Actions du menu rapide, selon la liste d'où vient la publication.
  const menuActions = menu?.source === 'search' ? search.actions : feed.actions;

  const onSeeAll = (block: SearchBlockKey) => setFilter(block);

  const onPickHashtag = (tag: { tag: string }) => {
    rememberQuery();
    changeQuery(tag.tag);
  };

  if (loading) {
    return <ThemedView style={{ flex: 1 }} />;
  }
  if (!token) {
    return <Redirect href="/login" />;
  }

  const filterLabels = {
    all: fr.social.searchFilterAll,
    users: fr.social.searchFilterUsers,
    publications: fr.social.searchFilterPublications,
    hashtags: fr.social.searchFilterHashtags,
  };
  // « Annuler » accompagne le champ dès qu'il est actif, comme Instagram.
  const showCancel = searching || focused;
  const showTabs = search.status === 'ready' && hasSearchContent(entries);
  // Un onglet de type précis charge la suite par curseur ; « Tous » reste un
  // aperçu, donc sa fin de liste ne demande rien.
  const canLoadMore = blockForFilter(filter) !== null;

  return (
    <ThemedView style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.two }]}>
        <View style={styles.headerRow}>
          <View style={[styles.searchBox, { backgroundColor: theme.backgroundSelected }]}>
            <Icon icon={Search} size={Spacing.four} color={theme.textSecondary} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={changeQuery}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onSubmitEditing={submitSearch}
              placeholder={fr.social.discoverPlaceholder}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text }]}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel={fr.social.discoverPlaceholder}
            />
            {query !== '' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={discoverFr.clearSearch}
                onPress={() => changeQuery('')}
                style={styles.iconButton}>
                <Icon icon={X} size={Spacing.three} color={theme.textSecondary} />
              </Pressable>
            ) : null}
          </View>
          {showCancel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={discoverFr.cancel}
              onPress={cancelSearch}
              hitSlop={Spacing.two}
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                {discoverFr.cancel}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      </View>

      {offline ? (
        <View style={[styles.offlineBanner, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="small" themeColor="textSecondary">{discoverFr.offline}</ThemedText>
        </View>
      ) : null}

      {notice ? (
        <View style={[styles.notice, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="small" style={{ color: theme.text }}>
            {notice}
          </ThemedText>
        </View>
      ) : null}

      {searching ? (
        <>
          {/* Historique et suggestions au focus, avant l'affichage des résultats. */}
          {focused && search.status !== 'ready' ? (
            <ScrollView
              contentContainerStyle={[
                styles.searchContent,
                { paddingBottom: TabBarHeight + insets.bottom + Spacing.five },
              ]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}>
              <SearchHistoryPanel
                entries={history}
                query={query}
                onPick={pickHistory}
                onRemove={removeHistory}
                onClear={clearHistory}
              />
            </ScrollView>
          ) : search.status === 'loading' ? (
            <View style={styles.centered}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ) : search.status === 'error' ? (
            <View style={styles.errorBlock}>
              <ThemedText type="small" style={{ color: theme.danger }}>
                {fr.social.discoverError}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={search.retry}
                style={styles.retryButton}>
                <ThemedText type="smallBold" style={{ color: theme.accent }}>
                  {discoverFr.retry}
                </ThemedText>
              </Pressable>
            </View>
          ) : !hasSearchContent(entries) ? (
            <EmptyState
              icon={Compass}
              title={fr.social.discoverNoResults}
              description={discoverFr.noResultsBody}
            />
          ) : showTabs ? (
            <SearchResultsList
              entries={entries}
              header={
                <View style={styles.tabsWrap}>
                  <SearchFilterTabs
                    value={filter}
                    onChange={setFilter}
                    labels={filterLabels}
                  />
                </View>
              }
              bottomInset={TabBarHeight + insets.bottom + Spacing.three}
              loadingMore={search.loadingMore}
              moreError={search.moreError}
              onEndReached={canLoadMore ? search.loadMore : () => undefined}
              onOpenProfile={(id) => {
                rememberQuery();
                router.push(`/user/${id}`);
              }}
              onOpenPost={openSearchPost}
              onPickHashtag={onPickHashtag}
              onSeeAll={onSeeAll}
              onTileDoubleTapLike={handleSearchDoubleTapLike}
              onTileLongPress={openSearchTileMenu}
            />
          ) : null}
        </>
      ) : (
        <>
          {focused ? (
            <SearchHistoryPanel
              entries={history}
              query={query}
              onPick={pickHistory}
              onRemove={removeHistory}
              onClear={clearHistory}
            />
          ) : null}
          {feed.freshCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                feed.freshCount > 1
                  ? fr.social.freshPostsLabelPlural(feed.freshCount)
                  : fr.social.freshPostsLabel(feed.freshCount)
              }
              onPress={() => {
                // Remonte en haut et recharge, comme la pastille du fil.
                gridRef.current?.scrollToIndex(0);
                feed.refresh();
              }}
              style={({ pressed }) => [
                styles.freshPill,
                { backgroundColor: theme.backgroundSelected },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                {feed.freshCount > 1
                  ? fr.social.freshPostsLabelPlural(feed.freshCount)
                  : fr.social.freshPostsLabel(feed.freshCount)}
              </ThemedText>
            </Pressable>
          ) : null}
          <DiscoverExploreGrid
            ref={gridRef}
            items={feed.items}
            status={feed.status}
            refreshing={feed.refreshing}
            loadingMore={feed.loadingMore}
            moreError={feed.moreError}
            bottomInset={TabBarHeight + insets.bottom + Spacing.three}
            onTilePress={openGridPost}
            onTileDoubleTapLike={handleDoubleTapLike}
            onTileLongPress={openTileMenu}
            onRefresh={feed.refresh}
            onLoadMore={feed.loadMore}
            onRetryFirst={feed.retryFirst}
          />
        </>
      )}

      {viewer && viewerItems.length > 0 ? (
        <DiscoverViewer
          // La visionneuse repart de la source choisie : un changement de
          // requête pendant la lecture ne la remplace pas en cours de route.
          key={`${viewer.source}-${query}`}
          items={viewerItems}
          initialIndex={viewerIndex}
          // La grille continue de charger pendant la lecture ; la liste de
          // recherche aussi quand un onglet précis est ouvert.
          hasMore={
            viewer.source === 'search'
              ? search.postsCursor !== null
              : feed.cursor !== null
          }
          onLoadMore={
            viewer.source === 'search' ? search.loadMore : feed.loadMore
          }
          onRefresh={viewer.source === 'search' ? search.retry : feed.refresh}
          actions={viewerActions}
          onClose={closeViewer}
        />
      ) : null}

      {menu ? (
        <ActionSheet
          visible
          title={menu.post.author.displayName}
          subtitle={fr.social.postTitle}
          onClose={closeTileMenu}
          actions={[
            {
              key: 'open',
              label: fr.social.openPost,
              onPress: () => {
                closeTileMenu();
                if (menu.source === 'search') {
                  openSearchPost(menu.post, menu.index);
                } else {
                  openGridPost(menu.post, menu.index);
                }
              },
            },
            {
              key: 'save',
              label: menu.post.viewer.saved
                ? fr.social.savedLabel
                : fr.social.saveLabel,
              icon: Bookmark,
              selected: menu.post.viewer.saved,
              onPress: () => {
                menuActions.toggleSave(menu.post);
              },
            },
            {
              key: 'repost',
              label: menu.post.viewer.reposted
                ? fr.social.unrepostLabel
                : fr.social.repostLabel,
              icon: Repeat2,
              selected: menu.post.viewer.reposted,
              onPress: () => {
                menuActions.toggleRepost(menu.post);
              },
            },
            {
              key: 'report',
              label: fr.social.reportPublication,
              icon: Flag,
              destructive: true,
              onPress: () => {
                closeTileMenu();
                report.open(menu.post);
              },
            },
            {
              key: 'dismiss',
              label: fr.social.notInterested,
              icon: EyeOff,
              destructive: true,
              onPress: () => {
                menuActions.dismiss(menu.post);
              },
            },
          ]}
        />
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    height: Spacing.five,
    borderRadius: Radii.full,
  },
  input: {
    flex: 1,
    ...Type.body,
    height: '100%',
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  iconButton: {
    padding: Spacing.one,
  },
  cancelButton: {
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.two,
  },
  offlineBanner: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.sm,
  },
  notice: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.sm,
  },
  searchContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.three,
  },
  tabsWrap: {
    paddingHorizontal: Spacing.three,
  },
  centered: {
    paddingVertical: Spacing.five,
    alignItems: 'center',
    gap: Spacing.two,
  },
  errorBlock: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.five,
  },
  retryButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  freshPill: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.full,
    alignSelf: 'flex-start',
  },
  pressed: {
    opacity: 0.7,
  },
});
