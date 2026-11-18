import { Heart } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Spacing, Type } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatListTimestamp } from '@/lib/format';
import type { PublicationComment } from '@/lib/types';

/**
 * Ligne de commentaire façon Instagram : nom et texte sur la même ligne,
 * date et action « Répondre » en dessous, cœur de J’aime à droite.
 * Composant partagé entre la feuille du fil et l'écran de détail.
 */
export function CommentRow({
  comment,
  onReply,
  indented = false,
  replyToName,
}: {
  comment: PublicationComment;
  onReply?: (comment: PublicationComment) => void;
  indented?: boolean;
  /** Pseudo du commentaire parent, affiché en gris devant une réponse. */
  replyToName?: string;
}) {
  const { token } = useAuth();
  const theme = useTheme();
  const [override, setOverride] = useState<{ liked: boolean; count: number } | null>(null);

  const liked = override?.liked ?? comment.viewerLiked;
  const likeCount = override?.count ?? comment.likeCount;

  const toggleLike = useCallback(async () => {
    if (!token) {
      return;
    }
    const next = !liked;
    setOverride({
      liked: next,
      count: Math.max(0, likeCount + (next ? 1 : -1)),
    });
    try {
      const updated = await api.likeComment(token, comment.id, next);
      setOverride({ liked: updated.viewerLiked, count: updated.likeCount });
    } catch {
      setOverride(null);
    }
  }, [comment.id, token, likeCount, liked]);

  return (
    <View style={[styles.row, indented ? styles.indented : null]}>
      <Avatar name={comment.author.displayName} uri={comment.author.avatarUrl} size={indented ? 28 : 34} />
      <View style={styles.body}>
        <ThemedText style={styles.text}>
          <ThemedText style={styles.author}>{comment.author.displayName}</ThemedText>{' '}
          {replyToName ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.replyPrefix}>
              {fr.social.replyToPrefix(replyToName)}{' '}
            </ThemedText>
          ) : null}
          {comment.body}
        </ThemedText>
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
          {likeCount > 0 ? (
            <ThemedText type="caption" themeColor="textSecondary">
              {fr.social.likesCount(likeCount)}
            </ThemedText>
          ) : null}
        </View>
      </View>
      <Pressable
        onPress={() => void toggleLike()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ selected: liked }}
        accessibilityLabel={fr.social.likesCount(likeCount)}
        style={styles.like}>
        <Heart
          size={16}
          color={liked ? theme.danger : theme.textSecondary}
          fill={liked ? theme.danger : 'transparent'}
          strokeWidth={2}
        />
      </Pressable>
    </View>
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
  body: { flex: 1, gap: Spacing.half },
  text: { ...Type.body, fontWeight: '400', flexWrap: 'wrap' },
  author: { fontWeight: '600', fontSize: (Type.body.fontSize ?? 15) + 0.5 },
  replyPrefix: { fontWeight: '400' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  like: { paddingVertical: Spacing.half, paddingLeft: Spacing.one },
});
