import { Redirect, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Compass, Search, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useNetworkState } from 'expo-network';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { hydrateSearchPublication } from '@/features/social/discover/discover-feed-model';
import { readDiscoverSnapshot } from '@/features/social/discover/discover-snapshot';
import { SearchHistoryPanel } from '@/features/social/discover/search-history-panel';
import { SearchUserRow } from '@/features/social/discover/search-user-row';
import { SearchFilterTabs, type SearchFilter } from '@/features/social/discover/search-filter-tabs';
import {
  clearSearchHistory,
  hydrateSearchHistory,
  readSearchHistory,
  removeSearchHistory,
  saveSearchHistory,
} from '@/features/social/discover/search-history';
import { useDiscoverFeed } from '@/features/social/discover/use-discover-feed';
import { normalizeSearchQuery } from '@/features/social/discover/search-model';
import { useTheme } from '@/hooks/use-theme';
import { discoverFr } from '@/i18n/discover-fr';
import { fr } from '@/i18n/fr';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatListTimestamp } from '@/lib/format';
import type { FeedPost, SearchResult } from '@/lib/types';

/**
 * Découvrir : mosaïque Explorer plein écran (une seule grille continue, sans
 * rail ni section), et recherche unifiée (comptes, publications, hashtags)
 * dès qu'une requête est saisie.
 *
 * La recherche imite Instagram : historique des recherches récentes au focus
 * du champ, suggestions pendant la saisie, onglets de filtre sur les
 * résultats, et suivi en ligne des comptes. La saisie est débouncée et la
 * réponse la plus récente gagne.
 *
 * La grille et le visionneuse plein écran partagent une seule liste
 * (`useDiscoverFeed`) : une réaction, un signet ou une republication pris
 * dans le visionneuse met à jour la vignette au retour.
 */
export default function DiscoverScreen() {
  const { token, loading, user } = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const network = useNetworkState();
  const params = useLocalSearchParams<{ q?: string }>();

  const [query, setQuery] = useState(typeof params.q === 'string' ? params.q : '');
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
  const [result, setResult] = useState<SearchResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);
  const searching = normalizeSearchQuery(query) !== '';
  const offline = network.isConnected === false || network.isInternetReachable === false;
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

  // Première page de la grille gardée sur l'appareil : les vignettes
  // s'affichent tout de suite, le réseau les remplace en arrière-plan.
  const initialPage = useMemo(
    () => (user?.id ? readDiscoverSnapshot(user.id) : null),
    [user],
  );

  // L'API de la grille ne renvoie pas l'état du lecteur : la grille démarre
  // sans réaction ni signet, et le visionneuse récupère le détail exact de
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

  const gridRef = useRef<DiscoverExploreGridHandle | null>(null);
  // Visionneuse : liste affichée + index. Viennent de la grille (avec la
  // position de vignette pour le retour) ou d'un résultat de recherche.
  const [viewer, setViewer] = useState<{
    items: FeedPost[];
    index: number;
    gridIndex?: number;
  } | null>(null);
  const navigation = useNavigation();

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

  useEffect(() => {
    if (!token) {
      return;
    }
    const normalized = normalizeSearchQuery(query);
    const current = ++requestId.current;

    if (normalized === '') {
      // La grille gère elle-même son chargement et sa pagination.
      return;
    }

    // `status` a déjà été posé à la saisie (`onChangeText`), pas ici : un
    // setState synchrone dans un effet provoquerait des rendus en cascade.
    const timer = setTimeout(() => {
      // L'historique retient la recherche effectivement exécutée.
      const nextHistory = saveSearchHistory(user?.id ?? null, normalized);
      setHistory(nextHistory);
      api
        .search(token, normalized)
        .then((value) => {
          if (current === requestId.current) {
            setResult(value);
            setStatus('ready');
          }
        })
        .catch(() => {
          if (current === requestId.current) {
            setStatus('error');
          }
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, token, reloadKey, user?.id]);

  const changeQuery = (value: string) => {
    setQuery(value);
    setStatus(normalizeSearchQuery(value) === '' ? 'idle' : 'loading');
  };

  const retrySearch = () => {
    setStatus('loading');
    setReloadKey((value) => value + 1);
  };

  const pickHistory = (entry: string) => {
    setQuery(entry);
    setStatus('loading');
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
  const showUsers = filter === 'all' || filter === 'users';
  const showPublications = filter === 'all' || filter === 'publications';
  const showHashtags = filter === 'all' || filter === 'hashtags';
  const visibleCount =
    (showUsers ? result?.users.items.length ?? 0 : 0) +
    (showPublications ? result?.publications.items.length ?? 0 : 0) +
    (showHashtags ? result?.hashtags.items.length ?? 0 : 0);

  return (
    <ThemedView style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.two }]}>
        <View style={[styles.searchBox, { backgroundColor: theme.backgroundSelected }]}>
          <Icon icon={Search} size={Spacing.four} color={theme.textSecondary} />
          <TextInput
            value={query}
            onChangeText={changeQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
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
        <ScrollView
          contentContainerStyle={[
            styles.searchContent,
            { paddingBottom: TabBarHeight + insets.bottom + Spacing.five },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {focused && status !== 'ready' ? (
            <SearchHistoryPanel
              entries={history}
              query={query}
              onPick={pickHistory}
              onRemove={removeHistory}
              onClear={clearHistory}
            />
          ) : null}

          {status === 'loading' && !focused ? (
            <View style={styles.centered}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ) : null}

          {status === 'error' ? (
            <View style={styles.errorBlock}>
              <ThemedText type="small" style={{ color: theme.danger }}>
                {fr.social.discoverError}
              </ThemedText>
              <Pressable accessibilityRole="button" onPress={retrySearch} style={styles.retryButton}>
                <ThemedText type="smallBold" style={{ color: theme.accent }}>
                  {discoverFr.retry}
                </ThemedText>
              </Pressable>
            </View>
          ) : null}

          {status === 'ready' && result ? (
            visibleCount === 0 ? (
              <EmptyState
                icon={Compass}
                title={fr.social.discoverNoResults}
                description={fr.social.discoverPlaceholder}
              />
            ) : (
              <>
                <SearchFilterTabs value={filter} onChange={setFilter} labels={filterLabels} />
                <View style={styles.filterGap} />

                {showUsers && result.users.items.length > 0 ? (
                  <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>{fr.social.discoverUsers}</ThemedText>
                    {result.users.items.map((account) => (
                      <SearchUserRow
                        key={account.id}
                        account={account}
                        onOpenProfile={(id) => router.push(`/user/${id}`)}
                      />
                    ))}
                  </View>
                ) : null}

                {showPublications && result.publications.items.length > 0 ? (
                  <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>
                      {fr.social.discoverPublications}
                    </ThemedText>
                    {result.publications.items.map((publication) => (
                      <Pressable
                        key={publication.id}
                        onPress={() =>
                          setViewer({
                            items: [hydrateSearchPublication(publication, hydrate)],
                            index: 0,
                          })
                        }
                        accessibilityRole="button"
                        style={styles.publicationRow}>
                        <ThemedText type="small" style={styles.rowTitle}>
                          {publication.author.displayName} ·{' '}
                          {formatListTimestamp(publication.createdAt)}
                        </ThemedText>
                        <ThemedText numberOfLines={3} style={styles.publicationText}>
                          {publication.caption ?? '—'}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {showHashtags && result.hashtags.items.length > 0 ? (
                  <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>{fr.social.discoverHashtags}</ThemedText>
                    {result.hashtags.items.map((tag) => (
                      <Pressable
                        key={tag.id}
                        onPress={() => changeQuery(tag.tag)}
                        accessibilityRole="button"
                        style={styles.trendRow}>
                        <ThemedText style={styles.trendTag}>#{tag.tag}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {tag.usageCount} {fr.social.discoverUses}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </>
            )
          ) : null}
        </ScrollView>
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
            onTilePress={(post: FeedPost, index: number) =>
              setViewer({ items: feed.items, index, gridIndex: index })
            }
            onTileDoubleTapLike={(post: FeedPost) => feed.actions.toggleLike(post)}
            onRefresh={feed.refresh}
            onLoadMore={feed.loadMore}
            onRetryFirst={feed.retryFirst}
          />
        </>
      )}

      {viewer ? (
        <DiscoverViewer
          items={viewer.items}
          initialIndex={viewer.index}
          hasMore={false}
          onLoadMore={() => undefined}
          onRefresh={() => undefined}
          actions={feed.actions}
          onClose={closeViewer}
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
  searchBox: {
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
  },
  iconButton: {
    padding: Spacing.one,
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
  filterGap: {
    height: Spacing.three,
  },
  centered: {
    paddingVertical: Spacing.five,
    alignItems: 'center',
    gap: Spacing.two,
  },
  errorBlock: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  retryButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  section: {
    gap: Spacing.one,
  },
  sectionTitle: {
    ...Type.sectionTitle,
    marginBottom: Spacing.one,
  },
  rowTitle: {
    ...Type.body,
    fontWeight: '600',
  },
  publicationRow: {
    paddingVertical: Spacing.two,
    gap: Spacing.half,
  },
  publicationText: {
    ...Type.body,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
  },
  trendTag: {
    ...Type.body,
    fontWeight: '600',
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
