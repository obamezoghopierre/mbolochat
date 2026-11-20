import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Images, Play } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedSurface, Radii, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { fr } from '@/i18n/fr';
import type { FeedPost, PublicationMedia } from '@/lib/types';
import { extraMediaCount, primaryMedia } from './pager/feed-media';

/** Colonnes de la grille, comme la grille de profil Instagram. */
const COLUMNS = 3;

function thumbnail(post: FeedPost): { uri: string | null; media: PublicationMedia | null } {
  const media = primaryMedia(post);
  if (!media) {
    return { uri: null, media: null };
  }
  // Vidéo : poster, jamais de lecteur dans une vignette de grille.
  return { uri: media.kind === 'video' ? media.posterUrl : media.url, media };
}

/**
 * Vignette d'une republication : média en carré, pastille vidéo/carrousel,
 * extrait de légende pour les posts texte. Le tap ouvre le détail.
 */
function RepostCell({ post, width, onPress }: { post: FeedPost; width: number; onPress: () => void }) {
  const theme = useTheme();
  const { uri, media } = thumbnail(post);
  const extras = extraMediaCount(post);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Voir la republication de ${post.author.displayName}`}
      style={({ pressed }) => [
        styles.cell,
        { width, backgroundColor: theme.backgroundElement },
        pressed && styles.pressed,
      ]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={120}
          accessibilityLabel={media?.altText ?? 'Média de la republication'}
        />
      ) : (
        <View style={styles.textPost}>
          <ThemedText numberOfLines={4} style={styles.textCaption}>
            {post.caption ?? ''}
          </ThemedText>
        </View>
      )}

      {media?.kind === 'video' ? (
        <View style={styles.badge}>
          <Icon icon={Play} size={11} color={FeedSurface.onMedia} fill={FeedSurface.onMedia} />
        </View>
      ) : extras > 0 ? (
        <View style={styles.badge}>
          <Icon icon={Images} size={11} color={FeedSurface.onMedia} />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Section « Republications » d'un profil, en grille de vignettes comme la
 * grille Instagram. Masquée silencieusement quand le profil est privé sans
 * abonnement ou quand il n'y a rien à montrer.
 */
export function RepostsSection({ userId, token }: { userId: string; token: string }) {
  const theme = useTheme();
  const [items, setItems] = useState<FeedPost[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);

  const onGridLayout = useCallback((event: LayoutChangeEvent) => {
    setGridWidth(event.nativeEvent.layout.width);
  }, []);

  const load = useCallback(async () => {
    try {
      const page = await api.userReposts(token, userId);
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch {
      // Profil privé ou inexistant : la section reste masquée, l'écran de
      // profil porte déjà l'état correspondant.
      setItems([]);
    }
  }, [token, userId]);

  useEffect(() => {
    // La requête part après le montage ; les états suivent la réponse.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await api.userReposts(token, userId, cursor);
      setItems((current) => {
        const known = new Set((current ?? []).map((item) => item.id));
        return [...(current ?? []), ...page.items.filter((item) => !known.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      // La page suivante reste disponible via un nouvel essai.
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, token, userId]);

  if (!items || items.length === 0) {
    return null;
  }

  const cellWidth = gridWidth > 0 ? (gridWidth - (COLUMNS - 1) * Spacing.one) / COLUMNS : 0;

  return (
    <View style={styles.section}>
      <ThemedText style={styles.title}>{fr.social.repostsTitle}</ThemedText>
      <View style={styles.grid} onLayout={onGridLayout}>
        {cellWidth > 0
          ? items.map((post) => (
              <RepostCell
                key={post.id}
                post={post}
                width={cellWidth}
                onPress={() => router.push(`/post/${post.id}`)}
              />
            ))
          : null}
      </View>
      {cursor ? (
        <Pressable
          onPress={() => void loadMore()}
          disabled={loadingMore}
          accessibilityRole="button"
          style={[styles.more, { backgroundColor: theme.accentSoft }]}>
          <ThemedText type="small" style={{ color: theme.accent }}>
            {loadingMore ? '…' : fr.social.repostsMore}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.three,
  },
  title: {
    ...Type.sectionTitle,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  cell: {
    aspectRatio: 1,
    borderRadius: Radii.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textPost: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.two,
  },
  textCaption: {
    ...Type.caption,
    textAlign: 'center',
  },
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
  pressed: {
    opacity: 0.8,
  },
  more: {
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
});
