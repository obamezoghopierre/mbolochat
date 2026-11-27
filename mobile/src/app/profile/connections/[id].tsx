import { Redirect, Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { loadProfileConnections, type ProfileConnection } from '@/lib/profile-connections-api';

type ConnectionKind = 'followers' | 'following';
type FollowStatus = 'none' | 'pending' | 'accepted';

export default function ProfileConnectionsScreen() {
  const { id, kind: kindParam } = useLocalSearchParams<{ id: string; kind?: string }>();
  const kind: ConnectionKind = kindParam === 'following' ? 'following' : 'followers';
  const { token } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ProfileConnection[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followStatus, setFollowStatus] = useState<Record<string, FollowStatus>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    try {
      const page = await loadProfileConnections(token, id, kind);
      setItems(page.items);
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fr.social.followError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, kind, token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const loadMore = useCallback(async () => {
    if (!token || !id || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await loadProfileConnections(token, id, kind, cursor);
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !known.has(item.id))];
      });
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fr.social.followError);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, id, kind, loadingMore, token]);

  const toggleFollow = useCallback(async (connectionId: string) => {
    if (!token || busyId) return;
    const current = followStatus[connectionId] ?? 'none';
    setBusyId(connectionId);
    try {
      const result = current === 'none'
        ? await api.followUser(token, connectionId)
        : await api.unfollowUser(token, connectionId);
      setFollowStatus((previous) => ({ ...previous, [connectionId]: result.status }));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fr.social.followError);
    } finally {
      setBusyId(null);
    }
  }, [busyId, followStatus, token]);

  if (!token) return <Redirect href="/login" />;

  const renderItem = ({ item }: { item: ProfileConnection }) => {
    const status = followStatus[item.id] ?? 'none';
    const label = status === 'accepted'
      ? fr.social.unfollow
      : status === 'pending'
        ? fr.social.requested
        : fr.social.follow;
    return (
      <View style={[styles.row, { borderBottomColor: theme.border }]}>
        <Pressable
          onPress={() => router.push(`/user/${item.id}`)}
          style={styles.identity}
          accessibilityRole="button"
          accessibilityLabel={item.displayName}>
          <Avatar name={item.displayName} uri={item.avatarUrl} size={48} />
          <View style={styles.copy}>
            <ThemedText numberOfLines={1} style={styles.name}>{item.displayName}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              @{item.username}
            </ThemedText>
          </View>
        </Pressable>
        <Pressable
          onPress={() => void toggleFollow(item.id)}
          disabled={busyId !== null}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={({ pressed }) => [
            styles.followButton,
            { backgroundColor: status === 'none' ? theme.accent : theme.backgroundElement },
            pressed && styles.pressed,
          ]}>
          {busyId === item.id ? (
            <ActivityIndicator size="small" color={status === 'none' ? theme.onAccent : theme.text} />
          ) : (
            <ThemedText
              type="small"
              style={{ color: status === 'none' ? theme.onAccent : theme.text }}>
              {label}
            </ThemedText>
          )}
        </Pressable>
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: kind === 'followers' ? fr.social.followers : fr.social.following }} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.four }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          loading ? <ActivityIndicator color={theme.accent} style={styles.state} /> : (
            <View style={styles.state}>
              <ThemedText type="small" themeColor="textSecondary">
                {error ?? fr.social.discoverNoResults}
              </ThemedText>
              {error ? (
                <Pressable onPress={() => void load()} accessibilityRole="button">
                  <ThemedText type="link">{fr.common.retry}</ThemedText>
                </Pressable>
              ) : null}
            </View>
          )
        }
        ListFooterComponent={
          loadingMore ? <ActivityIndicator color={theme.accent} style={styles.footer} /> :
          cursor ? (
            <Pressable onPress={() => void loadMore()} style={styles.footer} accessibilityRole="button">
              <ThemedText type="link">{fr.social.repostsMore}</ThemedText>
            </Pressable>
          ) : error && items.length > 0 ? (
            <Pressable onPress={() => void loadMore()} style={styles.footer} accessibilityRole="button">
              <ThemedText type="link">{fr.common.retry}</ThemedText>
            </Pressable>
          ) : undefined
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { flexGrow: 1, paddingHorizontal: Spacing.three },
  row: {
    minHeight: Spacing.six,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  copy: { flex: 1, minWidth: 0, gap: Spacing.half },
  name: { ...Type.body },
  followButton: {
    minHeight: Spacing.five,
    minWidth: Spacing.six,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.75 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  footer: { alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
});
