import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetFlatList,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing, Type } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { applyReaction } from '@/features/social/feed/feed-model';
import { PostCard } from '@/features/social/feed/post-card';
import { appendComment, mergeCommentPage } from '@/features/social/publication/comments-model';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { newClientId } from '@/lib/client-id';
import { formatListTimestamp } from '@/lib/format';
import type { FeedPost, PublicationComment } from '@/lib/types';

/** Hauteur de la feuille, partagée avec `FeedScreen` pour dimensionner le feed réduit. */
export const COMMENTS_SHEET_SNAP_RATIO = 0.72;

/**
 * Feuille de commentaires façon TikTok / Instagram.
 *
 * Le glissement, le suivi du doigt, les snap points et la fermeture sont gérés
 * par `@gorhom/bottom-sheet` (la même approche que les bottom sheets natives).
 * Le feed reste monté derrière et se réduit, voir `FeedScreen`.
 */
export function CommentsSheet({
  post,
  onClose,
}: {
  post: FeedPost;
  onClose: () => void;
}) {
  const { token } = useAuth();
  const theme = useTheme();

  const [current, setCurrent] = useState<FeedPost>(post);
  const [comments, setComments] = useState<PublicationComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const pending = useRef<{ clientId: string; body: string } | null>(null);

  // Un seul snap point : la feuille s'ouvre à 72 % et ne peut pas monter plus
  // haut. Le drag vers le bas la ferme (enablePanDownToClose).
  const snapPoints = useMemo(() => [`${COMMENTS_SHEET_SNAP_RATIO * 100}%`], []);

  // Tap sur le feed réduit derrière la feuille : elle se ferme, comme Instagram.
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        pressBehavior="close"
        opacity={0.35}
      />
    ),
    [],
  );

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const page = await api.comments(token, current.id);
      setComments(page.items);
      setCursor(page.nextCursor);
      setError(null);
      setStatus('ready');
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 404
          ? fr.social.postMissing
          : fr.social.commentsError,
      );
      setStatus('error');
    }
  }, [current.id, token]);

  useEffect(() => {
    // Les états sont posés après la réponse réseau, pas pendant le montage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!token || !cursor) {
      return;
    }
    try {
      const page = await api.comments(token, current.id, cursor);
      const merged = mergeCommentPage(comments, page);
      setComments(merged.items);
      setCursor(merged.nextCursor);
    } catch {
      setError(fr.social.commentsError);
    }
  }, [comments, cursor, current.id, token]);

  const toggleLike = useCallback(async () => {
    if (!token) {
      return;
    }
    const removing = current.viewer.reaction !== null;
    setCurrent((value) =>
      applyReaction([value], value.id, removing ? null : 'like')[0] ?? value,
    );
    try {
      if (removing) {
        await api.removeReaction(token, current.id);
      } else {
        await api.reactToPublication(token, current.id, 'like');
      }
    } catch {
      setCurrent(post);
      setError(fr.social.reactionError);
    }
  }, [current, post, token]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!token || body.length === 0 || sending) {
      return;
    }
    const clientId = pending.current?.body === body ? pending.current.clientId : newClientId();
    pending.current = { clientId, body };
    setSending(true);
    try {
      const created = await api.addComment(token, current.id, body, clientId);
      const replay = comments.some((item) => item.id === created.id);
      setComments((items) => appendComment(items, created));
      if (!replay) {
        setCurrent((value) => ({
          ...value,
          counters: { ...value.counters, comments: value.counters.comments + 1 },
        }));
      }
      setDraft('');
      pending.current = null;
      setError(null);
    } catch {
      setError(fr.social.commentError);
    } finally {
      setSending(false);
    }
  }, [comments, current.id, draft, sending, token]);

  return (
    <BottomSheet
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableDynamicSizing={false}
      onClose={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme.backgroundElement }}
      handleIndicatorStyle={{ backgroundColor: theme.textSecondary }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore">
      <BottomSheetView style={styles.content}>
        <View style={styles.header}>
          <ThemedText style={styles.title}>{fr.social.commentsTitle}</ThemedText>
          <Pressable
            onPress={() => router.push(`/post/${current.id}`)}
            accessibilityRole="button"
            accessibilityLabel={fr.social.seeFullPost}>
            <ThemedText type="caption" style={styles.fullPost}>
              {fr.social.seeFullPost}
            </ThemedText>
          </Pressable>
        </View>

        {status === 'loading' && comments.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : status === 'error' && comments.length === 0 ? (
          <View style={styles.center}>
            <ThemedText type="small" style={{ color: theme.danger }}>
              {error}
            </ThemedText>
          </View>
        ) : (
          <BottomSheetFlatList
            data={comments}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={styles.postBlock}>
                <PostCard post={current} onToggleLike={() => void toggleLike()} />
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.comment}>
                <Avatar name={item.author.displayName} uri={item.author.avatarUrl} size={32} />
                <View style={styles.commentBody}>
                  <View style={styles.commentMeta}>
                    <ThemedText type="small" style={styles.commentAuthor}>
                      {item.author.displayName}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatListTimestamp(item.createdAt)}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.commentText}>{item.body}</ThemedText>
                </View>
              </View>
            )}
            onEndReached={() => void loadMore()}
            onEndReachedThreshold={0.4}
          />
        )}

        <View
          style={[
            styles.composer,
            {
              borderTopColor: theme.border,
              backgroundColor: theme.backgroundElement,
            },
          ]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={fr.social.commentPlaceholder}
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.backgroundSelected },
            ]}
            maxLength={1000}
            multiline
            accessibilityLabel={fr.social.commentPlaceholder}
          />
          <Pressable
            onPress={() => void send()}
            disabled={sending || draft.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel={fr.social.commentSend}
            style={[
              styles.send,
              {
                backgroundColor:
                  draft.trim().length === 0 ? theme.backgroundSelected : theme.accent,
              },
            ]}>
            {sending ? (
              <ActivityIndicator color={theme.onAccent} size="small" />
            ) : (
              <ThemedText
                type="small"
                style={{
                  color: draft.trim().length === 0 ? theme.textSecondary : theme.onAccent,
                  fontWeight: '600',
                }}>
                {fr.social.commentSend}
              </ThemedText>
            )}
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  title: { ...Type.sectionTitle, fontWeight: '700' },
  fullPost: { color: '#3C87F7' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four },
  postBlock: { paddingBottom: Spacing.three },
  comment: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  commentBody: { flex: 1, gap: Spacing.half },
  commentMeta: { flexDirection: 'row', gap: Spacing.two, alignItems: 'baseline' },
  commentAuthor: { fontWeight: '600' },
  commentText: { ...Type.body },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 96,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  send: {
    minHeight: 40,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
