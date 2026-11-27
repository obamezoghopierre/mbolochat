import { Redirect } from 'expo-router';
import { Bell } from 'lucide-react-native';
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
import { EmptyState } from '@/components/empty-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing, TabBarHeight, Type } from '@/constants/theme';
import {
  countUnread,
  notificationLabel,
} from '@/features/social/notifications/notifications-model';
import { useNotifications } from '@/features/social/notifications/use-notifications';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { useAuth } from '@/lib/auth-context';
import { formatListTimestamp } from '@/lib/format';

/**
 * Activité : réactions, commentaires, abonnements et modération.
 *
 * Une notification non lue est marquée au moment où on l'ouvre, et le marquage
 * global reste possible. Le contenu cible ouvre le détail de la publication.
 */
export default function NotificationsScreen() {
  const { token, loading } = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const activity = useNotifications();

  if (loading) {
    return <ThemedView style={{ flex: 1 }} />;
  }
  if (!token) {
    return <Redirect href="/login" />;
  }

  const unread = countUnread(activity.items);

  const empty = () => {
    if (activity.status === 'loading') {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.accent} />
        </View>
      );
    }
    if (activity.status === 'error') {
      return (
        <View style={styles.centered}>
          <ThemedText style={styles.stateTitle}>{fr.social.activityErrorTitle}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.stateBody}>
            {fr.social.activityErrorBody}
          </ThemedText>
          <Pressable
            onPress={activity.retry}
            accessibilityRole="button"
            style={[styles.retry, { backgroundColor: theme.accentSoft }]}>
            <ThemedText type="small" style={{ color: theme.accent }}>
              {fr.social.feedRetry}
            </ThemedText>
          </Pressable>
        </View>
      );
    }
    return (
      <EmptyState
        icon={Bell}
        title={fr.social.notificationsTitle}
        description={fr.social.notificationsBody}
      />
    );
  };

  return (
    <ThemedView style={[styles.screen, { paddingTop: insets.top + Spacing.two }]}>
      <View style={styles.header}>
        <ThemedText style={styles.title}>{fr.social.activityTitle}</ThemedText>
        {unread > 0 ? (
          <Pressable
            onPress={() => void activity.markAllRead()}
            accessibilityRole="button"
            hitSlop={8}>
            <ThemedText type="small" style={{ color: theme.accent }}>
              {fr.social.markAllRead}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {activity.error && activity.items.length > 0 ? (
        <ThemedText type="small" style={[styles.inlineError, { color: theme.danger }]}>
          {activity.error}
        </ThemedText>
      ) : null}

      <FlatList
        data={activity.items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const actorName = item.actor?.displayName ?? 'Un compte supprimé';
          return (
            <Pressable
              onPress={() => void activity.open(item)}
              accessibilityRole="button"
              accessibilityLabel={notificationLabel(item.type, actorName)}
              style={styles.row}>
              <Avatar name={actorName} uri={item.actor?.avatarUrl ?? null} size={40} />
              <View style={styles.rowBody}>
                <ThemedText
                  style={item.readAt === null ? styles.rowTextUnread : styles.rowText}
                  themeColor={item.readAt === null ? undefined : 'textSecondary'}>
                  {notificationLabel(item.type, actorName)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatListTimestamp(item.createdAt)}
                </ThemedText>
              </View>
              {item.readAt === null ? (
                <View style={[styles.dot, { backgroundColor: theme.accent }]} />
              ) : null}
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: theme.border }]} />
        )}
        contentContainerStyle={[
          styles.list,
          activity.items.length === 0 && styles.listEmpty,
          { paddingBottom: TabBarHeight + insets.bottom + Spacing.five },
        ]}
        ListEmptyComponent={<>{empty()}</>}
        refreshControl={
          <RefreshControl
            refreshing={activity.refreshing}
            onRefresh={activity.refresh}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        onEndReached={activity.loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          activity.loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ) : undefined
        }
        showsVerticalScrollIndicator={false}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingBottom: Spacing.three,
  },
  title: {
    ...Type.screenTitle,
  },
  list: {
    paddingTop: Spacing.one,
  },
  listEmpty: {
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.threeHalf,
    paddingVertical: Spacing.threeHalf,
  },
  rowBody: {
    flex: 1,
    gap: Spacing.half,
  },
  rowText: {
    ...Type.body,
  },
  rowTextUnread: {
    ...Type.body,
    fontWeight: '600',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radii.full,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 40 + Spacing.threeHalf,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  stateTitle: {
    ...Type.sectionTitle,
    textAlign: 'center',
  },
  stateBody: {
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
    paddingBottom: Spacing.two,
  },
  footer: {
    paddingVertical: Spacing.four,
    alignItems: 'center',
  },
});
