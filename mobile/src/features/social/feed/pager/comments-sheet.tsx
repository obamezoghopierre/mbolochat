import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetFlatList,
} from '@gorhom/bottom-sheet';
import { SendHorizontal, Smile, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  UIManager,
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
import { detectAutocompleteToken } from '@/features/social/publication/rich-text';
import { useReportComment } from '@/features/social/publication/use-report-comment';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { newClientId } from '@/lib/client-id';
import type { FeedPost, PublicationComment } from '@/lib/types';

/** Hauteur de la feuille, partagée avec `FeedScreen` pour dimensionner le feed réduit. */
export const COMMENTS_SHEET_SNAP_RATIO = 0.72;

/** Marge minimale sous le composeur quand la barre système ne remonte pas `insets.bottom`. */
const COMPOSER_SYSTEM_BAR_FALLBACK = 48;

const EMOJIS = ['👍', '❤️', '😂', '🎉', '🙏', '🔥', '😮', '👏'];

type AutocompleteSuggestion = {
  value: string;
  displayName: string;
  avatarUrl?: string | null;
  isUser: boolean;
};

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

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
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
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
    if (!token || !cursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await api.comments(token, current.id, cursor);
      const merged = mergeCommentPage(comments, page);
      setComments(merged.items);
      setCursor(merged.nextCursor);
    } catch {
      setError(fr.social.commentsError);
    } finally {
      setLoadingMore(false);
    }
  }, [comments, cursor, current.id, loadingMore, token]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const updateScore = useCallback((commentId: string, score: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setComments((items) =>
      items
        .map((item) => (item.id === commentId ? { ...item, score } : item))
        .sort(
          (a, b) =>
            b.score - a.score ||
            a.createdAt.localeCompare(b.createdAt) ||
            a.id.localeCompare(b.id),
        ),
    );
  }, []);

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
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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

  const report = useReportComment(setNotice);

  useEffect(() => {
    const active = detectAutocompleteToken(draft);
    if (!token || !active || active.query.length === 0) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await api.search(
          token,
          active.query,
          active.kind === 'mention' ? 'users' : 'hashtags',
        );
        if (cancelled) {
          return;
        }
        setSuggestions(
          active.kind === 'mention'
            ? result.users.items.slice(0, 4).map((item) => ({
                value: `@${item.username}`,
                displayName: item.displayName,
                avatarUrl: item.avatarUrl,
                isUser: true,
              }))
            : result.hashtags.items.slice(0, 4).map((item) => ({
                value: `#${item.tag}`,
                displayName: `#${item.tag}`,
                isUser: false,
              })),
        );
      } catch {
        if (!cancelled) {
          setSuggestions([]);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, token]);

  const handleDraftChange = useCallback((value: string) => {
    setDraft(value);
    const active = detectAutocompleteToken(value);
    if (!active || active.query.length === 0) {
      setSuggestions([]);
    }
  }, []);

  const insertSuggestion = useCallback(
    (value: string) => {
      const active = detectAutocompleteToken(draft);
      setDraft(active ? `${draft.slice(0, active.start)}${value} ` : `${draft}${value} `);
      setSuggestions([]);
    },
    [draft],
  );

  const insertEmoji = useCallback((emoji: string) => {
    setDraft((value) => value + emoji);
    setEmojiOpen(false);
  }, []);

  const repliesCount = useMemo(
    () => [...grouped.repliesByParent.values()].reduce((total, items) => total + items.length, 0),
    [grouped],
  );

  const toggleAllReplies = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((current) =>
      current.size > 0
        ? new Set()
        : new Set(
            grouped.roots
              .filter((root) => grouped.repliesByParent.has(root.id))
              .map((root) => root.id),
          ),
    );
  }, [grouped]);

  // Les confirmations (copie, signalement, suppression) sont éphémères.
  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const deleteComment = useCallback(
    async (comment: PublicationComment) => {
      if (!token) {
        return;
      }
      try {
        await api.deleteComment(token, comment.id);
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setComments((items) =>
          items.filter((item) => item.id !== comment.id && item.parentId !== comment.id),
        );
        const removed = comments.filter(
          (item) => item.id === comment.id || item.parentId === comment.id,
        ).length;
        setCurrent((value) => ({
          ...value,
          counters: {
            ...value.counters,
            comments: Math.max(0, value.counters.comments - removed),
          },
        }));
        setNotice(fr.social.commentDeleted);
      } catch {
        setNotice(fr.social.commentDeleteError);
      }
    },
    [comments, token],
  );

  return (
    <>
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
        {repliesCount > 0 ? (
          <Pressable
            onPress={toggleAllReplies}
            hitSlop={6}
            accessibilityRole="button"
            style={styles.headerSide}>
            <ThemedText type="caption" themeColor="textSecondary">
              {expanded.size > 0 ? fr.social.collapseAllReplies : fr.social.expandAllReplies}
            </ThemedText>
          </Pressable>
        ) : (
          <View style={styles.headerSide} />
        )}
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
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={theme.accent}
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.center}>
                <ActivityIndicator color={theme.accent} size="small" />
              </View>
            ) : undefined
          }
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
                <Pressable onPress={() => void load()} hitSlop={8} accessibilityRole="button">
                  <ThemedText type="small" style={{ color: theme.accent, marginTop: Spacing.two }}>
                    {fr.common.retry}
                  </ThemedText>
                </Pressable>
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
                <CommentRow
                  comment={item}
                  onReply={handleReply}
                  onReport={report.open}
                  onDelete={(target) => void deleteComment(target)}
                  onNotice={setNotice}
                  onScoreChange={updateScore}
                />
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
                        onReport={report.open}
                        onDelete={(target) => void deleteComment(target)}
                        onNotice={setNotice}
                        onScoreChange={updateScore}
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

      {notice ? (
        <View style={[styles.notice, { backgroundColor: theme.accentSoft }]}>
          <ThemedText type="caption" style={{ color: theme.accent }}>
            {notice}
          </ThemedText>
          <Pressable onPress={() => setNotice(null)} hitSlop={8} accessibilityRole="button">
            <X size={14} color={theme.accent} />
          </Pressable>
        </View>
      ) : null}

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

      {suggestions.length > 0 ? (
        <View style={[styles.suggestions, { borderTopColor: theme.border }]}>
          {suggestions.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => insertSuggestion(item.value)}
              accessibilityRole="button"
              style={styles.suggestionRow}>
              {item.isUser ? (
                <Avatar name={item.displayName} uri={item.avatarUrl} size={32} shape="rounded" />
              ) : (
                <View
                  style={[styles.hashtagAvatar, { backgroundColor: theme.backgroundSelected }]}>
                  <ThemedText style={{ color: theme.accent }}>#</ThemedText>
                </View>
              )}
              <ThemedText type="small">{item.displayName}</ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}

      {emojiOpen ? (
        <View style={[styles.suggestions, { borderTopColor: theme.border }]}>
          {EMOJIS.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => insertEmoji(emoji)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={emoji}>
              <ThemedText style={styles.emoji}>{emoji}</ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}

      {draft.length > 0 ? (
        <ThemedText type="caption" themeColor="textSecondary" style={styles.charCount}>
          {draft.length}/1000
        </ThemedText>
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
        <Pressable
          onPress={() => setEmojiOpen((value) => !value)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={fr.social.addEmoji}>
          <Smile size={20} color={theme.textSecondary} />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={handleDraftChange}
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
    {report.sheet}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  headerSide: { position: 'absolute', left: Spacing.three },
  close: { position: 'absolute', right: Spacing.three, padding: Spacing.one },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four },
  repliesToggle: { paddingLeft: 42, paddingTop: Spacing.half, paddingBottom: Spacing.one },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  suggestions: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  hashtagAvatar: {
    width: 32,
    height: 32,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 22 },
  charCount: { textAlign: 'right', paddingHorizontal: Spacing.three },
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
