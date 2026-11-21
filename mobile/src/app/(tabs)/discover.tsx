import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Compass, Search } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing, Type } from '@/constants/theme';
import {
  normalizeSearchQuery,
  totalResults,
} from '@/features/social/discover/search-model';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatListTimestamp } from '@/lib/format';
import type { SearchHashtag, SearchResult } from '@/lib/types';

/**
 * Découvrir : tendances quand rien n'est saisi, puis recherche unifiée
 * (comptes, publications, hashtags). La saisie est débouncée et la réponse la
 * plus récente gagne, pour éviter qu'une ancienne requête écrase la nouvelle.
 */
export default function DiscoverScreen() {
  const { token, loading } = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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
  const [trending, setTrending] = useState<SearchHashtag[]>([]);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const requestId = useRef(0);

  useEffect(() => {
    if (!token) {
      return;
    }
    const normalized = normalizeSearchQuery(query);
    const current = ++requestId.current;

    if (normalized === '') {
      api
        .trendingHashtags(token)
        .then((rows) => {
          if (current === requestId.current) {
            setTrending(rows);
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
  }, [query, token]);

  if (loading) {
    return <ThemedView style={{ flex: 1 }} />;
  }
  if (!token) {
    return <Redirect href="/login" />;
  }

  const searching = normalizeSearchQuery(query) !== '';

  return (
    <ThemedView style={[styles.screen, { paddingTop: insets.top + Spacing.two }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <ThemedText style={styles.title}>{fr.tabs.discover}</ThemedText>

        <View style={[styles.searchBox, { backgroundColor: theme.backgroundSelected }]}>
          <Icon icon={Search} size={18} color={theme.textSecondary} />
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

        {status === 'loading' ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : null}

        {status === 'error' ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {fr.social.discoverError}
          </ThemedText>
        ) : null}

        {status === 'ready' && !searching ? (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>{fr.social.discoverTrendingTitle}</ThemedText>
            {trending.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {fr.social.discoverNoTrending}
              </ThemedText>
            ) : (
              trending.map((tag) => (
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
              ))
            )}
          </View>
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
                      <Avatar name={user.displayName} uri={user.avatarUrl} size={40} />
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
  title: {
    ...Type.screenTitle,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    height: 44,
    borderRadius: Radii.full,
  },
  input: {
    flex: 1,
    fontSize: 15,
    height: '100%',
  },
  centered: {
    paddingVertical: Spacing.five,
    alignItems: 'center',
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
