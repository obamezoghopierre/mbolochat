import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Compass, RefreshCw, Search } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
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
import { DiscoverMetrics, Radii, Spacing, Type } from '@/constants/theme';
import { DiscoverRails } from '@/features/social/discover/discover-rails';
import { loadDiscover, type DiscoverResponse } from '@/features/social/discover/discover-api';
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
import type { FollowState, SearchResult } from '@/lib/types';

/**
 * Découvrir : sélections personnalisées quand rien n'est saisi, puis recherche
 * unifiée (comptes, publications, hashtags). La saisie est débouncée et la
 * réponse la plus récente gagne, pour éviter qu'une ancienne requête écrase la nouvelle.
 */
export default function DiscoverScreen() {
  const { token, loading } = useAuth();
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
  const [discoverData, setDiscoverData] = useState<DiscoverResponse | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [followStates, setFollowStates] = useState<Record<string, FollowState>>({});
  const [busyFollowIds, setBusyFollowIds] = useState<Set<string>>(new Set());
  const requestId = useRef(0);
  const searching = normalizeSearchQuery(query) !== '';
  const offline = network.isConnected === false || network.isInternetReachable === false;

  useEffect(() => {
    if (!token) {
      return;
    }
    const normalized = normalizeSearchQuery(query);
    const current = ++requestId.current;

    if (normalized === '') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('loading');
      loadDiscover(token)
        .then((value) => {
          if (current === requestId.current) {
            setDiscoverData(value);
            setResult(null);
            setStatus('ready');
          }
        })
        .catch(() => {
          if (current === requestId.current) {
            setStatus('error');
          }
        });
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading');
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

  const refresh = () => {
    setStatus('loading');
    setReloadKey((value) => value + 1);
  };

  const followAccount = async (userId: string) => {
    if (!token || busyFollowIds.has(userId)) {
      return;
    }
    setBusyFollowIds((current) => new Set(current).add(userId));
    try {
      const state = await api.followUser(token, userId);
      setFollowStates((current) => ({ ...current, [userId]: state }));
    } catch {
      Alert.alert(discoverFr.followError);
    } finally {
      setBusyFollowIds((current) => {
        const next = new Set(current);
        next.delete(userId);
        return next;
      });
    }
  };

  if (loading) {
    return <ThemedView style={{ flex: 1 }} />;
  }
  if (!token) {
    return <Redirect href="/login" />;
  }

  return (
    <ThemedView style={[styles.screen, { paddingTop: insets.top + Spacing.two }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={status === 'loading' && !searching}
            onRefresh={refresh}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }>
        <View style={styles.titleRow}>
          <ThemedText style={styles.title}>{fr.tabs.discover}</ThemedText>
          {!searching ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={discoverFr.refresh}
              accessibilityState={{ disabled: status === 'loading' }}
              disabled={status === 'loading'}
              onPress={refresh}
              style={styles.refreshButton}>
              <Icon icon={RefreshCw} size={Spacing.four} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.searchBox, { backgroundColor: theme.backgroundSelected }]}>
          <Icon icon={Search} size={Spacing.three} color={theme.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={fr.social.discoverPlaceholder}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text }]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel={fr.social.discoverPlaceholder}
          />
        </View>

        {offline ? (
          <View style={[styles.offlineBanner, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="small" themeColor="textSecondary">{discoverFr.offline}</ThemedText>
          </View>
        ) : null}

        {status === 'loading' ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.accent} />
            {!searching ? <ThemedText type="small" themeColor="textSecondary">{discoverFr.loading}</ThemedText> : null}
          </View>
        ) : null}

        {status === 'error' ? (
          searching ? (
            <View style={styles.errorBlock}>
              <ThemedText type="small" style={{ color: theme.danger }}>{fr.social.discoverError}</ThemedText>
              <Pressable accessibilityRole="button" onPress={refresh} style={styles.retryButton}>
                <ThemedText type="smallBold" style={{ color: theme.accent }}>{discoverFr.retry}</ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.errorBlock}>
              <EmptyState
                icon={Compass}
                title={discoverFr.errorTitle}
                description={discoverFr.errorBody}
              />
              <Pressable accessibilityRole="button" onPress={refresh} style={styles.retryButton}>
                <ThemedText type="smallBold" style={{ color: theme.accent }}>{discoverFr.retry}</ThemedText>
              </Pressable>
            </View>
          )
        ) : null}

        {status === 'ready' && !searching && discoverData ? (
          <DiscoverRails
            data={discoverData}
            followStates={followStates}
            busyFollowIds={busyFollowIds}
            onFollow={followAccount}
            onSelectHashtag={setQuery}
          />
        ) : null}

        {status === 'ready' && searching && result ? (
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
                  {result.users.items.map((user) => (
                    <Pressable
                      key={user.id}
                      onPress={() => router.push(`/user/${user.id}`)}
                      accessibilityRole="button"
                      style={styles.row}>
                      <Avatar name={user.displayName} uri={user.avatarUrl} size={Spacing.five} />
                      <View style={styles.rowBody}>
                        <ThemedText style={styles.rowTitle}>
                          {user.displayName}
                          {user.verified ? ' ✓' : ''}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          @{user.username}
                          {user.privateAccount ? ' · privé' : ''}
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
                      onPress={() => setQuery(tag.tag)}
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: Spacing.three,
  },
  content: {
    gap: Spacing.three,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...Type.screenTitle,
  },
  refreshButton: {
    padding: Spacing.two,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    height: DiscoverMetrics.searchHeight,
    borderRadius: Radii.full,
  },
  input: {
    flex: 1,
    ...Type.body,
    height: '100%',
  },
  offlineBanner: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.sm,
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
