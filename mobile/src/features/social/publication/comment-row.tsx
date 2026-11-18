import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Copy, Flag, Heart, Link2, Reply, ThumbsDown, Trash2 } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { FeedSurface, Spacing, Type } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatListTimestamp } from '@/lib/format';
import type { PublicationComment } from '@/lib/types';
import { parseSocialText } from './rich-text';

/** Nombre de lignes affichées avant « voir plus », comme sur Instagram. */
const COLLAPSED_LINES = 2;

/**
 * Ligne de commentaire : nom en gras sur sa ligne, texte en dessous, puis date
 * et action « Répondre », avec le cœur de J’aime à droite.
 * Composant partagé entre la feuille du fil et l'écran de détail.
 */
export function CommentRow({
  comment,
  onReply,
  onReport,
  onDelete,
  onNotice,
  onScoreChange,
  indented = false,
  replyToName,
}: {
  comment: PublicationComment;
  onReply?: (comment: PublicationComment) => void;
  onReport?: (comment: PublicationComment) => void;
  onDelete?: (comment: PublicationComment) => void;
  onNotice?: (message: string) => void;
  onScoreChange?: (commentId: string, score: number) => void;
  indented?: boolean;
  /** Pseudo du commentaire parent, affiché en gris devant une réponse. */
  replyToName?: string;
}) {
  const { token, user } = useAuth();
  const theme = useTheme();
  const [override, setOverride] = useState<{
    liked: boolean;
    count: number;
    disliked: boolean;
    dislikes: number;
    score: number;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [followOverride, setFollowOverride] = useState<{
    following: boolean;
    followedBy: boolean;
    pending?: boolean;
  } | null>(null);
  // La largeur de la feuille est connue et stable : au-delà de ~100 caractères
  // ou 2 lignes explicites, le texte sera coupé par `numberOfLines`.
  const isLong =
    comment.body.length > 100 || comment.body.split('\n').length > COLLAPSED_LINES;
  const segments = useMemo(() => parseSocialText(comment.body), [comment.body]);

  const liked = override?.liked ?? comment.viewerLiked;
  const likeCount = override?.count ?? comment.likeCount;
  const disliked = override?.disliked ?? comment.viewerDisliked;
  const dislikeCount = override?.dislikes ?? comment.dislikeCount;
  const score = override?.score ?? comment.score;
  const following = followOverride?.following ?? comment.author.following ?? false;
  const followedBy = followOverride?.followedBy ?? comment.author.followedBy ?? false;
  const pending = followOverride?.pending ?? false;
  const isOwnComment = user?.id === comment.author.id;

  const toggleLike = useCallback(async () => {
    if (!token) {
      return;
    }
    const next = !liked;
    const count = Math.max(0, likeCount + (next ? 1 : -1));
    const dislikes = disliked ? Math.max(0, dislikeCount - 1) : dislikeCount;
    const optimisticScore = Math.max(0, count - dislikes);
    setOverride({
      liked: next,
      count,
      disliked: false,
      dislikes,
      score: optimisticScore,
    });
    onScoreChange?.(comment.id, optimisticScore);
    try {
      const updated = await api.likeComment(token, comment.id, next);
      onScoreChange?.(comment.id, updated.score);
      setOverride({
        liked: updated.viewerLiked,
        count: updated.likeCount,
        disliked: updated.viewerDisliked,
        dislikes: updated.dislikeCount,
        score: updated.score,
      });
    } catch {
      setOverride(null);
    }
  }, [comment.id, token, likeCount, liked, disliked, dislikeCount, onScoreChange]);

  const toggleDislike = useCallback(async () => {
    if (!token) {
      return;
    }
    const next = !disliked;
    const count = Math.max(0, likeCount - (liked ? 1 : 0));
    const dislikes = Math.max(0, dislikeCount + (next ? 1 : -1));
    const optimisticScore = Math.max(0, count - dislikes);
    setOverride({
      liked: false,
      count,
      disliked: next,
      dislikes,
      score: optimisticScore,
    });
    onScoreChange?.(comment.id, optimisticScore);
    try {
      const updated = await api.dislikeComment(token, comment.id, next);
      onScoreChange?.(comment.id, updated.score);
      setOverride({
        liked: updated.viewerLiked,
        count: updated.likeCount,
        disliked: updated.viewerDisliked,
        dislikes: updated.dislikeCount,
        score: updated.score,
      });
    } catch {
      setOverride(null);
    }
  }, [comment.id, token, likeCount, liked, disliked, dislikeCount, onScoreChange]);

  const openMention = useCallback(
    async (username: string) => {
      if (!token) {
        return;
      }
      const result = await api.search(token, username, 'users');
      const found = result.users.items.find(
        (item) => item.username.toLowerCase() === username,
      );
      if (found) {
        router.push(`/user/${found.id}`);
      }
    },
    [token],
  );

  const openHashtag = useCallback((tag: string) => {
    router.push({ pathname: '/(tabs)/discover', params: { q: tag } });
  }, []);

  const toggleFollow = useCallback(async () => {
    if (!token || isOwnComment) {
      return;
    }
    const next = !following;
    setFollowOverride({ following: next, followedBy });
    try {
      const state = next
        ? await api.followUser(token, comment.author.id)
        : await api.unfollowUser(token, comment.author.id);
      setFollowOverride({
        following: state.status !== 'none',
        followedBy,
        pending: state.status === 'pending',
      });
    } catch {
      setFollowOverride(null);
    }
  }, [token, isOwnComment, following, followedBy, comment.author.id]);

  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(comment.body);
    onNotice?.(fr.social.commentCopied);
  }, [comment.body, onNotice]);

  const menuActions = useMemo<SheetAction[]>(() => {
    const link = segments.find((segment) => segment.kind === 'link');
    const actions: SheetAction[] = [];
    if (link?.kind === 'link') {
      actions.push({
        key: 'link',
        label: fr.social.openCommentLink,
        icon: Link2,
        onPress: () => {
          void Linking.openURL(link.url).catch(() => undefined);
        },
      });
    }
    if (onReply) {
      actions.push({
        key: 'reply',
        label: fr.social.replyToComment,
        icon: Reply,
        onPress: () => onReply(comment),
      });
    }
    actions.push({
      key: 'copy',
      label: fr.social.copyComment,
      icon: Copy,
      onPress: () => void copy(),
    });
    if (onReport && !isOwnComment) {
      actions.push({
        key: 'report',
        label: fr.social.reportComment,
        icon: Flag,
        onPress: () => onReport(comment),
      });
    }
    if (isOwnComment && onDelete) {
      actions.push({
        key: 'delete',
        label: fr.social.deleteComment,
        icon: Trash2,
        destructive: true,
        onPress: () =>
          Alert.alert(fr.social.deleteComment, fr.social.deleteComment, [
            { text: fr.common.cancel, style: 'cancel' },
            {
              text: fr.social.deleteComment,
              style: 'destructive',
              onPress: () => onDelete(comment),
            },
          ]),
      });
    }
    return actions;
  }, [comment, copy, isOwnComment, onDelete, onReply, onReport, segments]);

  const row = (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityActions={[{ name: 'openActions', label: fr.social.commentActionsTitle }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'openActions') {
          setMenuOpen(true);
        }
      }}
      onLongPress={() => setMenuOpen(true)}
      delayLongPress={350}
      style={[styles.row, indented ? styles.indented : null]}>
      <Avatar
        name={comment.author.displayName}
        uri={comment.author.avatarUrl}
        size={indented ? 28 : 34}
        shape="rounded"
      />
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <ThemedText style={styles.author}>{comment.author.displayName}</ThemedText>
          {replyToName ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.replyPrefix}>
              {fr.social.replyToPrefix(replyToName)}
            </ThemedText>
          ) : null}
          {!isOwnComment && following && followedBy ? (
            <ThemedText type="caption" themeColor="textSecondary">
              {fr.social.mutualFollow}
            </ThemedText>
          ) : null}
          {!isOwnComment && !following ? (
            <Pressable
              onPress={() => void toggleFollow()}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={
                followedBy ? fr.social.followBack : fr.social.followInline
              }>
              <ThemedText type="caption" style={{ color: FeedSurface.like, fontWeight: '600' }}>
                {pending
                  ? fr.social.requested
                  : followedBy
                    ? fr.social.followBack
                    : fr.social.followInline}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
        <ThemedText
          style={styles.text}
          numberOfLines={isLong && !expanded ? COLLAPSED_LINES : undefined}>
          {segments.map((segment, index) => {
            if (segment.kind === 'text') {
              return <ThemedText key={index}>{segment.value}</ThemedText>;
            }
            if (segment.kind === 'link') {
              return (
                <ThemedText
                  key={index}
                  onPress={() => void Linking.openURL(segment.url).catch(() => undefined)}
                  style={{ color: theme.accent, textDecorationLine: 'underline' }}>
                  {segment.value}
                </ThemedText>
              );
            }
            return (
              <ThemedText
                key={index}
                onPress={() =>
                  segment.kind === 'mention'
                    ? void openMention(segment.username)
                    : openHashtag(segment.tag)
                }
                style={{ color: theme.accent, fontWeight: '600' }}>
                {segment.value}
              </ThemedText>
            );
          })}
        </ThemedText>
        {isLong ? (
          <Pressable
            onPress={() => setExpanded((value) => !value)}
            hitSlop={6}
            accessibilityRole="button">
            <ThemedText type="caption" themeColor="textSecondary">
              {expanded ? fr.social.seeLess : fr.social.seeMore}
            </ThemedText>
          </Pressable>
        ) : null}
        <View style={styles.meta}>
          <ThemedText type="caption" themeColor="textSecondary">
            {formatListTimestamp(comment.createdAt)}
          </ThemedText>
          {onReply ? (
            <Pressable onPress={() => onReply(comment)} hitSlop={6} accessibilityRole="button">
              <ThemedText type="caption" themeColor="textSecondary">
                {fr.social.reply}
              </ThemedText>
            </Pressable>
          ) : null}
          {score > 0 ? (
            <ThemedText type="caption" themeColor="textSecondary">
              {fr.social.likesCount(score)}
            </ThemedText>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => void toggleLike()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ selected: liked }}
          accessibilityLabel={fr.social.likesCount(score)}
          style={styles.action}>
          <Heart
            size={16}
            color={liked ? FeedSurface.like : theme.textSecondary}
            fill={liked ? FeedSurface.like : 'transparent'}
            strokeWidth={2}
          />
        </Pressable>
        <Pressable
          onPress={() => void toggleDislike()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ selected: disliked }}
          accessibilityLabel={disliked ? fr.social.undislike : fr.social.dislike}
          style={styles.action}>
          <ThumbsDown
            size={16}
            color={disliked ? theme.text : theme.textSecondary}
            fill={disliked ? theme.text : 'transparent'}
            strokeWidth={2}
          />
        </Pressable>
      </View>
    </Pressable>
  );

  return (
    <>
      {row}
      <ActionSheet
        visible={menuOpen}
        title={fr.social.commentActionsTitle}
        actions={menuActions}
        onClose={() => setMenuOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  indented: { paddingLeft: Spacing.four },
  body: { flex: 1, gap: Spacing.one },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one, flexWrap: 'wrap' },
  // Nom sur sa propre ligne, commentaire en dessous : le gras et l'écart de
  // taille rendent la hiérarchie visible même avec la police Android.
  text: { ...Type.body, fontSize: 14, fontWeight: '400', flexWrap: 'wrap' },
  author: { ...Type.body, fontSize: 15.5, fontWeight: '700' },
  replyPrefix: { ...Type.body, fontSize: 13, fontWeight: '400' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginTop: Spacing.one },
  actions: { flexDirection: 'row', alignItems: 'center' },
  action: { paddingVertical: Spacing.half, paddingLeft: Spacing.one },
});
