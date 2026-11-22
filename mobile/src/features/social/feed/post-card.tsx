import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Heart, MessageCircle } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing, Type } from '@/constants/theme';
import { MediaFilterOverlay } from '@/features/media/media-filter';
import { primaryMedia } from './pager/feed-media';
import { LikedByLine } from './liked-by-line';
import { formatListTimestamp } from '@/lib/format';
import { fr } from '@/i18n/fr';
import type { FeedPost } from '@/lib/types';
import { useTheme } from '@/hooks/use-theme';

/**
 * Carte d'une publication du fil : auteur, texte, compteurs et réaction.
 *
 * Le ratio d'engagement est lisible sans ouvrir le détail : le nombre de
 * réactions et de commentaires vient du serveur, jamais d'un total recalculé
 * côté client.
 */
export function PostCard({
  post,
  onToggleLike,
  onPress,
  onPressAuthor,
}: {
  post: FeedPost;
  onToggleLike: (post: FeedPost) => void;
  /** Ouvre le détail de la publication. */
  onPress?: () => void;
  /** Ouvre le profil de l'auteur. */
  onPressAuthor?: () => void;
}) {
  const theme = useTheme();
  const reacted = post.viewer.reaction !== null;
  const media = primaryMedia(post);
  // Une vidéo n'a pas d'image dans `url` : on affiche son poster, jamais un
  // lecteur dans une carte de liste.
  const preview = media ? (media.kind === 'video' ? media.posterUrl : media.url) : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `Ouvrir la publication de ${post.author.displayName}` : undefined}
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <Pressable
        onPress={onPressAuthor}
        disabled={!onPressAuthor}
        accessibilityRole={onPressAuthor ? 'button' : undefined}
        accessibilityLabel={
          onPressAuthor ? `Voir le profil de ${post.author.displayName}` : undefined
        }
        style={styles.header}>
        <Avatar
          name={post.author.displayName}
          uri={post.author.avatarUrl}
          size={40}
        />
        <View style={styles.identity}>
          <View style={styles.nameRow}>
            <ThemedText numberOfLines={1} style={styles.name}>
              {post.author.displayName}
            </ThemedText>
            {post.author.verified ? (
              <ThemedText type="small" style={{ color: theme.accent }}>
                ✓
              </ThemedText>
            ) : null}
          </View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            @{post.author.username} · {formatListTimestamp(post.createdAt)}
          </ThemedText>
        </View>
      </Pressable>

      {preview ? (
        <View>
          <Image
            source={{ uri: preview }}
            style={[styles.media, { backgroundColor: theme.backgroundSelected }]}
            contentFit="cover"
            transition={120}
            accessibilityLabel={media?.altText ?? 'Média de la publication'}
          />
          <MediaFilterOverlay filterKey={post.mediaFilter} style={styles.filterOverlay} />
        </View>
      ) : null}

      {post.quoted ? (
        <Pressable
          onPress={() => router.push(`/post/${post.quoted!.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Voir la publication de ${post.quoted.authorDisplayName}`}
          style={styles.quoted}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {fr.social.quotedFrom(post.quoted.authorDisplayName)}
          </ThemedText>
          {post.quoted.caption ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {post.quoted.caption}
            </ThemedText>
          ) : null}
        </Pressable>
      ) : null}

      {post.caption ? (
        <ThemedText style={styles.caption}>{post.caption}</ThemedText>
      ) : null}

      <View style={styles.footer}>
        <Pressable
          onPress={() => onToggleLike(post)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            reacted ? `Retirer ma réaction (${post.counters.likes})` : `Réagir (${post.counters.likes})`
          }
          accessibilityState={{ selected: reacted }}
          style={styles.action}>
          <Icon
            icon={Heart}
            size={18}
            color={reacted ? theme.danger : theme.textSecondary}
            fill={reacted ? theme.danger : 'none'}
          />
          <ThemedText
            type="small"
            themeColor={reacted ? 'text' : 'textSecondary'}
            style={styles.count}>
            {post.counters.likes}
          </ThemedText>
        </Pressable>

        <View
          style={styles.action}
          accessible
          accessibilityLabel={`${post.counters.comments} commentaires`}>
          <Icon icon={MessageCircle} size={18} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.count}>
            {post.counters.comments}
          </ThemedText>
        </View>
      </View>

      {/* « Aimé par X et N autres » : seulement avec un compte suivi, le
          nombre de J'aime est déjà dans le pied de carte. */}
      <LikedByLine post={post} color={theme.text} requireLikedBy />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.lg,
    padding: Spacing.three,
    gap: Spacing.threeHalf,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.threeHalf,
  },
  identity: {
    flex: 1,
    gap: Spacing.half,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  name: {
    ...Type.body,
    fontWeight: '600',
  },
  quoted: {
    gap: Spacing.half,
    paddingVertical: Spacing.one,
  },
  caption: {
    ...Type.body,
  },
  media: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: Radii.md,
  },
  /** Même boîte que le média, pour que le filtre suive ses coins arrondis. */
  filterOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
    marginTop: Spacing.half,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: 32,
  },
  count: {
    fontVariant: ['tabular-nums'],
  },
});
