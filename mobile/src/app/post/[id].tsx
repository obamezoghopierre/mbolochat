import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing, Type } from '@/constants/theme';
import { PostCard } from '@/features/social/feed/post-card';
import { applyReaction } from '@/features/social/feed/feed-model';
import { CommentRow } from '@/features/social/publication/comment-row';
import {
  appendComment,
  applyCommentReaction,
  mergeCommentPage,
  upsertComment,
} from '@/features/social/publication/comments-model';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { newClientId } from '@/lib/client-id';
import { fr } from '@/i18n/fr';
import type {
  CommentReactionKind,
  FeedPost,
  PublicationComment,
} from '@/lib/types';

/**
 * Détail d'une publication et ses commentaires.
 *
 * L'envoi est idempotent (`clientId`) : si le réseau coupe après l'écriture
 * serveur, réessayer avec la même clé renvoie le commentaire existant au lieu
 * d'en créer un second.
 */
export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [post, setPost] = useState<FeedPost | null>(null);
  const [comments, setComments] = useState<PublicationComment[]>([]);
  const [pinned, setPinned] = useState<PublicationComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const pending = useRef<{ clientId: string; body: string } | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) {
      return;
    }
    try {
      const [publication, page] = await Promise.all([
        api.publication(token, id),
        api.comments(token, id),
      ]);
      setPost(publication);
      setComments(page.items);
      setPinned(page.pinned ?? []);
      setCursor(page.nextCursor);
      setError(null);
      setStatus('ready');
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 404
          ? fr.social.postMissing
          : fr.social.postError,
      );
      setStatus('error');
    }
  }, [id, token]);

  useEffect(() => {
    // Les états sont posés après la réponse réseau, pas pendant le montage ;
    // l'analyse statique ne fait pas cette distinction.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!token || !id || !cursor) {
      return;
    }
    try {
      const page = await api.comments(token, id, { cursor });
      setComments((current) => {
        const merged = mergeCommentPage(current, page);
        setCursor(merged.nextCursor);
        return merged.items;
      });
      setPinned(page.pinned ?? []);
    } catch {
      setError(fr.social.commentsError);
    }
  };

  const toggleLike = useCallback(
    async (target: FeedPost) => {
      if (!token) {
        return;
      }
      const removing = target.viewer.reaction !== null;
      const previous = post;
      setPost((current) =>
        current ? applyReaction([current], target.id, removing ? null : 'like')[0] : current,
      );
      try {
        if (removing) {
          await api.removeReaction(token, target.id);
        } else {
          await api.reactToPublication(token, target.id, 'like');
        }
      } catch {
        setPost(previous);
        setError(fr.social.reactionError);
      }
    },
    [post, token],
  );

  /** Réaction emoji sur un commentaire, optimiste puis confirmée par le serveur. */
  const reactToComment = useCallback(
    async (target: PublicationComment, kind: CommentReactionKind | null) => {
      if (!token) {
        return;
      }
      const optimistic = (item: PublicationComment) =>
        item.id === target.id ? applyCommentReaction(item, kind) : item;
      setComments((items) => items.map(optimistic));
      setPinned((items) => items.map(optimistic));
      try {
        const updated = await api.reactComment(token, target.id, kind);
        const replace = (items: PublicationComment[]) =>
          items.some((item) => item.id === updated.id) ? upsertComment(items, updated) : items;
        setComments(replace);
        setPinned(replace);
      } catch {
        setError(fr.social.commentActionError);
      }
    },
    [token],
  );

  /** Épingle/désépingle un commentaire racine (auteur de la publication). */
  const togglePin = useCallback(
    async (target: PublicationComment, pinnedFlag: boolean) => {
      if (!token) {
        return;
      }
      try {
        const updated = await api.pinComment(token, target.id, pinnedFlag);
        setComments((items) => items.filter((item) => item.id !== target.id));
        setPinned((items) => {
          const rest = items.filter((item) => item.id !== target.id);
          return updated.pinned ? [updated, ...rest] : rest;
        });
        if (!updated.pinned) {
          setComments((items) => [...items, updated]);
        }
      } catch {
        setError(fr.social.commentActionError);
      }
    },
    [token],
  );

  const send = async () => {
    const body = draft.trim();
    if (!token || !id || body.length === 0 || sending) {
      return;
    }
    // Même clé tant que le texte n'a pas changé : un nouvel essai ne crée pas
    // de doublon si le premier a réussi côté serveur.
    const clientId =
      pending.current?.body === body ? pending.current.clientId : newClientId();
    pending.current = { clientId, body };
    setSending(true);
    try {
      const created = await api.addComment(token, id, body, clientId);
      const replay = comments.some((item) => item.id === created.id);
      setComments((current) => appendComment(current, created));
      if (!replay) {
        // Le serveur a incrémenté `commentCount` ; on aligne la carte affichée
        // sans attendre un rechargement complet.
        setPost((current) =>
          current
            ? {
                ...current,
                counters: { ...current.counters, comments: current.counters.comments + 1 },
              }
            : current,
        );
      }
      setDraft('');
      pending.current = null;
      setError(null);
    } catch {
      setError(fr.social.commentError);
    } finally {
      setSending(false);
    }
  };

  if (status === 'loading' && !post) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={theme.accent} />
      </ThemedView>
    );
  }

  if (status === 'error' || !post) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText style={styles.stateTitle}>{fr.social.postErrorTitle}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.stateBody}>
          {error ?? fr.social.postError}
        </ThemedText>
        <Pressable
          onPress={() => void load()}
          accessibilityRole="button"
          style={[styles.retry, { backgroundColor: theme.accentSoft }]}>
          <ThemedText type="small" style={{ color: theme.accent }}>
            {fr.social.feedRetry}
          </ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <View
        style={[
          styles.topBar,
          { paddingTop: insets.top + Spacing.two, borderBottomColor: theme.border },
        ]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={fr.social.back}>
          <Icon icon={ArrowLeft} size={22} color={theme.text} />
        </Pressable>
        <ThemedText style={styles.topTitle}>{fr.social.postTitle}</ThemedText>
        <View style={styles.topSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        // Android ne redimensionne pas toujours la fenêtre en mode bord à bord :
        // `height` garde le compositeur visible au-dessus du clavier.
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}>
        <FlatList
          data={[...pinned, ...comments]}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              <PostCard post={post} onToggleLike={toggleLike} />
              <ThemedText style={styles.sectionTitle}>{fr.social.commentsTitle}</ThemedText>
              {error ? (
                <ThemedText type="small" style={{ color: theme.danger }}>
                  {error}
                </ThemedText>
              ) : null}
              {comments.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {fr.social.commentsEmpty}
                </ThemedText>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <CommentRow
              comment={item}
              onReact={(target, kind) => void reactToComment(target, kind)}
              onPin={(target, pinnedFlag) => void togglePin(target, pinnedFlag)}
              isPublicationAuthor={user?.id === post.author.id}
              replyToName={
                item.parentId
                  ? [...pinned, ...comments].find(
                      (candidate) => candidate.id === item.parentId,
                    )?.author.username
                  : undefined
              }
            />
          )}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          showsVerticalScrollIndicator={false}
        />

        <View
          style={[
            styles.composer,
            {
              borderTopColor: theme.border,
              backgroundColor: theme.backgroundElement,
              paddingBottom: insets.bottom + Spacing.two,
            },
          ]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={fr.social.commentPlaceholder}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSelected }]}
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
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  stateTitle: { ...Type.sectionTitle, textAlign: 'center' },
  stateBody: { textAlign: 'center', maxWidth: 320 },
  retry: {
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radii.full,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topTitle: { ...Type.sectionTitle },
  topSpacer: { width: 22 },
  list: {
    padding: Spacing.three,
    gap: Spacing.threeHalf,
  },
  headerBlock: { gap: Spacing.three },
  sectionTitle: { ...Type.sectionTitle, marginTop: Spacing.two },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    fontSize: 15,
  },
  send: {
    height: 40,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
