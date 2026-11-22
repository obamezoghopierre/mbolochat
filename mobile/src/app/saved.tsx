import { Image } from 'expo-image';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Images, MoreHorizontal, Play } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { ActionSheet } from '@/components/action-sheet';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FeedSurface, Radii, Spacing } from '@/constants/theme';
import { extraMediaCount, primaryMedia } from '@/features/social/feed/pager/feed-media';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { resolveMediaUrl } from '@/lib/media-url';
import type { FeedPost, SaveCollection } from '@/lib/types';

const COLUMNS = 3;
const GAP = 2;

/**
 * « Enregistrés », comme Instagram : tous les enregistrements puis une puce
 * par collection, en grille de vignettes. Privé : seul le compte connecté y
 * accède. Appui long sur une puce de collection : renommer ou supprimer.
 */
export default function SavedScreen() {
  const { token } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS);

  const [collections, setCollections] = useState<SaveCollection[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [items, setItems] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<SaveCollection | null>(null);

  const load = useCallback(
    async (collectionId: string | null, nextCursor?: string) => {
      if (!token) {
        return;
      }
      if (!nextCursor) {
        setStatus('loading');
      }
      try {
        const [page, list] = await Promise.all([
          api.saved(token, { cursor: nextCursor, collectionId: collectionId ?? undefined }),
          nextCursor ? Promise.resolve(null) : api.saveCollections(token),
        ]);
        setItems((current) => (nextCursor ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
        if (list) {
          setCollections(list);
        }
        setStatus('ready');
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : fr.social.savedLoadError);
        setStatus('error');
      }
    },
    [token],
  );

  useFocusEffect(
    useCallback(() => {
      void load(selected);
    }, [load, selected]),
  );

  const select = (collectionId: string | null) => {
    setSelected(collectionId);
  };

  const rename = (collection: SaveCollection) => {
    if (!token) {
      return;
    }
    Alert.prompt(
      fr.social.collectionRename,
      undefined,
      (value) => {
        const name = (value ?? '').trim();
        if (!name) {
          return;
        }
        void api
          .renameSaveCollection(token, collection.id, name)
          .then(() => load(selected))
          .catch((cause) =>
            Alert.alert(cause instanceof ApiError ? cause.message : fr.social.collectionError),
          );
      },
      'plain-text',
      collection.name,
    );
  };

  const remove = (collection: SaveCollection) => {
    if (!token) {
      return;
    }
    Alert.alert(fr.social.collectionDeleteTitle, fr.social.collectionDeleteBody, [
      { text: fr.common.cancel, style: 'cancel' },
      {
        text: fr.social.collectionDelete,
        style: 'destructive',
        onPress: () => {
          void api
            .deleteSaveCollection(token, collection.id)
            .then(() => {
              if (selected === collection.id) {
                setSelected(null);
              } else {
                void load(selected);
              }
            })
            .catch(() => Alert.alert(fr.social.collectionError));
        },
      },
    ]);
  };

  const chip = (key: string, label: string, active: boolean, onPress: () => void, onLong?: () => void) => (
    <Pressable
      key={key}
      onPress={onPress}
      onLongPress={onLong}
      delayLongPress={350}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.text : theme.backgroundSelected,
        },
      ]}>
      <ThemedText
        type="small"
        numberOfLines={1}
        style={{ color: active ? theme.background : theme.text, fontWeight: '600' }}>
        {label}
      </ThemedText>
    </Pressable>
  );

  const current = collections.find((entry) => entry.id === selected) ?? null;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: fr.social.savedTitle,
          headerRight: current
            ? () => (
                <Pressable
                  onPress={() => setMenuFor(current)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={fr.social.collectionOptions}>
                  <Icon icon={MoreHorizontal} size={22} color={theme.text} />
                </Pressable>
              )
            : undefined,
        }}
      />
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}>
          {chip('all', fr.social.savedAll, selected === null, () => select(null))}
          {collections.map((collection) =>
            chip(
              collection.id,
              `${collection.name} · ${collection.count}`,
              selected === collection.id,
              () => select(collection.id),
              () => setMenuFor(collection),
            ),
          )}
        </ScrollView>
      </View>

      {status === 'loading' && items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : status === 'error' && items.length === 0 ? (
        <View style={styles.center}>
          <ThemedText type="small" style={{ color: theme.danger }}>
            {error}
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={COLUMNS}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: Spacing.six }}
          onEndReached={() => {
            if (cursor) {
              void load(selected, cursor);
            }
          }}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            <View style={styles.center}>
              <ThemedText type="sectionTitle">{fr.social.savedEmptyTitle}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                {fr.social.savedEmptyHint}
              </ThemedText>
            </View>
          }
          renderItem={({ item }) => {
            const media = primaryMedia(item);
            const uri = resolveMediaUrl(
              media?.kind === 'video' ? media.posterUrl : (media?.url ?? null),
            );
            return (
              <Pressable
                onPress={() => router.push(`/post/${item.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Publication de ${item.author.displayName}`}
                style={[styles.cell, { width: cell, height: cell, backgroundColor: theme.backgroundElement }]}>
                {uri ? (
                  <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
                ) : (
                  <ThemedText numberOfLines={4} style={styles.textCell}>
                    {item.caption ?? ''}
                  </ThemedText>
                )}
                {media?.kind === 'video' ? (
                  <View style={styles.badge}>
                    <Icon icon={Play} size={11} color={FeedSurface.onMedia} fill={FeedSurface.onMedia} />
                  </View>
                ) : extraMediaCount(item) > 0 ? (
                  <View style={styles.badge}>
                    <Icon icon={Images} size={11} color={FeedSurface.onMedia} />
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}

      <ActionSheet
        visible={menuFor !== null}
        title={menuFor?.name}
        actions={
          menuFor
            ? [
                // `Alert.prompt` n'existe que sur iOS.
                ...(Platform.OS === 'ios'
                  ? [
                      {
                        key: 'rename',
                        label: fr.social.collectionRename,
                        onPress: () => rename(menuFor),
                      },
                    ]
                  : []),
                {
                  key: 'delete',
                  label: fr.social.collectionDelete,
                  destructive: true,
                  onPress: () => remove(menuFor),
                },
              ]
            : []
        }
        onClose={() => setMenuFor(null)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  chips: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  chip: {
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    maxWidth: 200,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
    gap: Spacing.two,
  },
  emptyHint: { textAlign: 'center' },
  cell: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  textCell: { fontSize: 12, padding: Spacing.two, textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.one,
    width: 20,
    height: 20,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FeedSurface.glassStrong,
  },
});
