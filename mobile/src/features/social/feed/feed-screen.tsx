import { router } from 'expo-router';
import { Home, MapPin, Users } from 'lucide-react-native';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing, Type } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { useTheme } from '@/hooks/use-theme';
import { useState } from 'react';

import type { FeedPost, FeedTab } from '@/lib/types';
import { PostCard } from './post-card';
import { useFeed } from './use-feed';

const TABS: { id: FeedTab; label: string }[] = [
  { id: 'for-you', label: fr.social.feedTabs.forYou },
  { id: 'following', label: fr.social.feedTabs.following },
  { id: 'local', label: fr.social.feedTabs.local },
];

/**
 * Fil social : classement « Pour toi », abonnements et local.
 *
 * Tous les états sont explicites (chargement, vide, erreur, pagination) ; les
 * compteurs viennent du serveur et la réaction est optimiste avec retour
 * arrière si l'enregistrement échoue.
 */
export function FeedScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<FeedTab>('for-you');

  return (
    <ThemedView style={[styles.screen, { paddingTop: insets.top + Spacing.two }]}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((entry) => {
          const active = entry.id === tab;
          return (
            <Pressable
              key={entry.id}
              onPress={() => setTab(entry.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[
                styles.tab,
                {
                  backgroundColor: active ? theme.accentSoft : theme.backgroundElement,
                  borderColor: active ? theme.accentSoft : theme.border,
                },
              ]}>
              <ThemedText
                type="small"
                style={{ color: active ? theme.accent : theme.textSecondary, fontWeight: '600' }}>
                {entry.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      {/* Remonter le fil à chaque onglet évite de réutiliser un curseur d'un
          autre classement. */}
      <FeedList key={tab} tab={tab} />
    </ThemedView>
  );
}

function FeedList({ tab }: { tab: FeedTab }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const feed = useFeed(tab);

  const renderItem = ({ item }: { item: FeedPost }) => (
    <PostCard
      post={item}
      onToggleLike={feed.toggleLike}
      onPress={() => router.push(`/post/${item.id}`)}
      onPressAuthor={() => router.push(`/user/${item.author.id}`)}
    />
  );

  const empty = () => {
    if (feed.status === 'loading') {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.accent} />
          <ThemedText type="small" themeColor="textSecondary">
            {fr.social.feedLoading}
          </ThemedText>
        </View>
      );
    }
    if (feed.status === 'error') {
      return (
        <View style={styles.centered}>
          <ThemedText style={styles.emptyTitle}>{fr.social.feedErrorTitle}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyBody}>
            {fr.social.feedErrorBody}
          </ThemedText>
          <Pressable
            onPress={feed.retry}
            accessibilityRole="button"
            style={[styles.retry, { backgroundColor: theme.accentSoft }]}>
            <ThemedText type="small" style={{ color: theme.accent }}>
              {fr.social.feedRetry}
            </ThemedText>
          </Pressable>
        </View>
      );
    }
    if (tab === 'following') {
      return (
        <EmptyState
          icon={Users}
          title={fr.social.feedFollowingTitle}
          description={fr.social.feedFollowingBody}
        />
      );
    }
    if (tab === 'local') {
      return (
        <EmptyState
          icon={MapPin}
          title={fr.social.feedLocalTitle}
          description={fr.social.feedLocalBody}
        />
      );
    }
    return (
      <EmptyState
        icon={Home}
        title={fr.social.feedTitle}
        description={fr.social.feedBody}
      />
    );
  };

  return (
    <View style={styles.listWrap}>
      {feed.error && feed.items.length > 0 ? (
        <ThemedText type="small" style={[styles.inlineError, { color: theme.danger }]}>
          {feed.error}
        </ThemedText>
      ) : null}

      <FlatList
        data={feed.items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.list,
          feed.items.length === 0 && styles.listEmpty,
          { paddingBottom: insets.bottom + Spacing.five },
        ]}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.threeHalf }} />}
        ListEmptyComponent={<>{empty()}</>}
        refreshControl={
          <RefreshControl
            refreshing={feed.refreshing}
            onRefresh={feed.refresh}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          feed.loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ) : undefined
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
  },
  tabs: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  listWrap: {
    flex: 1,
  },
  list: {
    paddingTop: Spacing.one,
  },
  listEmpty: {
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  emptyTitle: {
    ...Type.sectionTitle,
    textAlign: 'center',
  },
  emptyBody: {
    textAlign: 'center',
    maxWidth: 320,
  },
  retry: {
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radii.full,
  },
  inlineError: {
    textAlign: 'center',
  },
  footer: {
    paddingVertical: Spacing.four,
    alignItems: 'center',
  },
});
