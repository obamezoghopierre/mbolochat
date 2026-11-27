import { Redirect, router, useLocalSearchParams } from 'expo-router';
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

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing, TabBarHeight, Type } from '@/constants/theme';
import { DiscoverExploreGrid } from '@/features/social/discover/discover-explore-grid';
import { readDiscoverSnapshot } from '@/features/social/discover/discover-snapshot';
import {
  normalizeSearchQuery,
  totalResults,
} from '@/features/social/discover/search-model';
import { useTheme } from '@/hooks/use-theme';
import { discoverFr } from '@/i18n/discover-fr';
import { fr } from '@/i18n/fr';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatListTimestamp } from '@/lib/format';
import type { SearchResult } from '@/lib/types';

/**
 * Découvrir : mosaïque Explorer plein écran (une seule grille continue, sans
 * rail ni section), et recherche unifiée (comptes, publications, hashtags) dès
 * qu'une requête est saisie. La saisie est débouncée et la réponse la plus
 * récente gagne, pour éviter qu'une ancienne requête écrase la nouvelle.
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

  // Première page de la grille gardée sur l'appareil : les vignettes
  // s'affichent tout de suite, le réseau les remplace en arrière-plan.
  const initialPage = useMemo(
    () => (user?.id ? readDiscoverSnapshot(user.id) : null),
    [user],
  );

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
  }, [query, token, reloadKey]);

  const changeQuery = (value: string) => {
    setQuery(value);
    setStatus(normalizeSearchQuery(value) === '' ? 'idle' : 'loading');
  };

  const retrySearch = () => {
    setStatus('loading');
    setReloadKey((value) => value + 1);
  };

  if (loading) {
    return <ThemedView style={{ flex: 1 }} />;
  }
  if (!token) {
    return <Redirect href="/login" />;
  }

  return (
    <ThemedView style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.two }]}>
        <View style={[styles.searchBox, { backgroundColor: theme.backgroundSelected }]}>
          <Icon icon={Search} size={Spacing.four} color={theme.textSecondary} />
          <TextInput
            value={query}
            onChangeText={changeQuery}
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

      {searching ? (
        <ScrollView
          contentContainerStyle={[
            styles.searchContent,
            { paddingBottom: TabBarHeight + insets.bottom + Spacing.five },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {status === 'loading' ? (
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
            totalResults(result) === 0 ? (
              <EmptyState
                icon={Compass}
                title={fr.social.discoverNoResults}
                description={fr.social.discoverPlaceholder}
              />
            ) : (
              <>
                {result.users.items.length > 0 ? (
                  <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>{fr.social.discoverUsers}</ThemedText>
                    {result.users.items.map((account) => (
                      <Pressable
                        key={account.id}
                        onPress={() => router.push(`/user/${account.id}`)}
                        accessibilityRole="button"
                        style={styles.row}>
                        <Avatar name={account.displayName} uri={account.avatarUrl} size={Spacing.five} />
                        <View style={styles.rowBody}>
                          <ThemedText style={styles.rowTitle}>
                            {account.displayName}
                            {account.verified ? ' ✓' : ''}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            @{account.username}
                            {account.privateAccount ? ' · privé' : ''}
                          </ThemedText>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {result.publications.items.length > 0 ? (
                  <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>
                      {fr.social.discoverPublications}
                    </ThemedText>
                    {result.publications.items.map((publication) => (
                      <Pressable
                        key={publication.id}
                        onPress={() => router.push(`/post/${publication.id}`)}
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

                {result.hashtags.items.length > 0 ? (
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
        <DiscoverExploreGrid
          token={token}
          userId={user?.id ?? null}
          initialPage={initialPage}
          bottomInset={TabBarHeight + insets.bottom + Spacing.three}
        />
      )}
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
  searchContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.three,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.threeHalf,
    paddingVertical: Spacing.two,
  },
  rowBody: {
    flex: 1,
    gap: Spacing.half,
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
});
