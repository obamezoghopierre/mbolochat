import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetFlatList,
} from '@gorhom/bottom-sheet';
import { SendHorizontal, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { CommentRow } from '@/features/social/publication/comment-row';
import {
  appendComment,
  appendReply,
  groupComments,
  mergeCommentPage,
} from '@/features/social/publication/comments-model';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { newClientId } from '@/lib/client-id';
import type { FeedPost, PublicationComment } from '@/lib/types';

/** Hauteur de la feuille, partagée avec `FeedScreen` pour dimensionner le feed réduit. */
export const COMMENTS_SHEET_SNAP_RATIO = 0.72;

/** Marge minimale sous le composeur quand la barre système ne remonte pas `insets.bottom`. */
const COMPOSER_SYSTEM_BAR_FALLBACK = 48;

/**
 * Feuille de commentaires façon Instagram.
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
  const { token, user } = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const screenHeight = useMemo(() => Dimensions.get('window').height, []);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const [current, setCurrent] = useState<FeedPost>(post);
  const [comments, setComments] = useState<PublicationComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<PublicationComment | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const pending = useRef<{ clientId: string; body: string; parentId?: string } | null>(null);

  const grouped = useMemo(() => groupComments(comments), [comments]);

  // Un seul snap point : la feuille s'ouvre à 72 % et ne peut pas monter plus
  // haut. Le drag vers le bas la ferme (enablePanDownToClose).
  const snapPoints = useMemo(
    () =>
      keyboardHeight > 0
        ? [Math.max(240, screenHeight - keyboardHeight)]
        : [`${COMMENTS_SHEET_SNAP_RATIO * 100}%`],
    [keyboardHeight, screenHeight],
  );

  // Le clavier se superpose à la fenêtre sur Waydroid : on remonte la feuille
  // de sa hauteur et on réduit son snap point pour garder le composeur visible.
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

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

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!token || body.length === 0 || sending) {
      return;
    }
    const parentId = replyTo?.id;
    const reusable = pending.current?.body === body && pending.current.parentId === parentId;
    const clientId = reusable ? (pending.current?.clientId ?? newClientId()) : newClientId();
    pending.current = { clientId, body, parentId };
    setSending(true);
    try {
      const created = await api.addComment(token, current.id, body, clientId, parentId);
      const replay = comments.some((item) => item.id === created.id);
      setComments((items) =>
        parentId ? appendReply(items, created) : appendComment(items, created),
      );
      if (parentId && !replay) {
        setExpanded((ids) => new Set(ids).add(parentId));
      }
      if (!replay) {
        setCurrent((value) => ({
          ...value,
          counters: { ...value.counters, comments: value.counters.comments + 1 },
        }));
      }
      setDraft('');
      setReplyTo(null);
      pending.current = null;
      setError(null);
    } catch {
      setError(fr.social.commentError);
    } finally {
      setSending(false);
    }
  }, [comments, current.id, draft, replyTo, sending, token]);

  const handleReply = useCallback(
    (target: PublicationComment) => {
      // Une seule ligne de réponses est affichée : on répond toujours au fil racine.
      const root = target.parentId
        ? comments.find((item) => item.id === target.parentId) ?? target
        : target;
      setReplyTo(root);
    },
    [comments],
  );

  const toggleReplies = useCallback((id: string) => {
    setExpanded((ids) => {
      const next = new Set(ids);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

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
      containerStyle={{ transform: [{ translateY: -keyboardHeight }] }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore">
      {/* En-tête hors de la liste : il reste fixe pendant le défilement. */}
      <View style={styles.header}>
        <View style={styles.headerSide} />
        <ThemedText type="sectionTitle">
          {fr.social.commentsCount(current.counters.comments)}
        </ThemedText>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={fr.common.close}
          style={styles.close}>
          <X size={20} color={theme.text} />
        </Pressable>
      </View>

      <BottomSheetFlatList
          data={grouped.roots}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            status === 'loading' && comments.length === 0 ? (
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
              <View style={styles.center}>
                <ThemedText type="small" themeColor="textSecondary">
                  {fr.social.commentsEmpty}
                </ThemedText>
              </View>
            )
          }
          renderItem={({ item }) => {
            const replies = grouped.repliesByParent.get(item.id) ?? [];
            const open = expanded.has(item.id);
            return (
              <View>
                <CommentRow comment={item} onReply={handleReply} />
                {replies.length > 0 ? (
                  <Pressable
                    onPress={() => toggleReplies(item.id)}
                    accessibilityRole="button"
                    style={styles.repliesToggle}>
                    <ThemedText type="caption" themeColor="textSecondary">
                      {open
                        ? fr.social.hideReplies
                        : fr.social.viewReplies(Math.max(item.replyCount, replies.length))}
                    </ThemedText>
                  </Pressable>
                ) : null}
                {open
                  ? replies.map((reply) => (
                      <CommentRow
                        key={reply.id}
                        comment={reply}
                        onReply={handleReply}
                        indented
                        replyToName={
                          grouped.roots.find((root) => root.id === reply.parentId)?.author.username
                        }
                      />
                    ))
                  : null}
              </View>
            );
          }}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
        />

      {replyTo ? (
        <View style={[styles.replyBanner, { borderTopColor: theme.border }]}>
          <ThemedText type="caption" themeColor="textSecondary">
            {fr.social.replyingTo(replyTo.author.displayName)}
          </ThemedText>
          <Pressable
            onPress={() => setReplyTo(null)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={fr.common.close}>
            <X size={14} color={theme.textSecondary} />
          </Pressable>
        </View>
      ) : null}

      <View
        style={[
          styles.composer,
          {
            borderTopColor: theme.border,
            backgroundColor: theme.backgroundElement,
            paddingBottom: Math.max(insets.bottom, COMPOSER_SYSTEM_BAR_FALLBACK),
          },
        ]}>
        <Avatar
          name={user?.displayName ?? ''}
          uri={user?.avatarUrl}
          gender={user?.gender}
          size={34}
        />
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
            <SendHorizontal
              size={18}
              color={draft.trim().length === 0 ? theme.textSecondary : theme.onAccent}
              strokeWidth={2.2}
            />
          )}
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  headerSide: { width: 28 },
  close: { padding: Spacing.one },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four },
  repliesToggle: { paddingLeft: 42, paddingTop: Spacing.half, paddingBottom: Spacing.one },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
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
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
