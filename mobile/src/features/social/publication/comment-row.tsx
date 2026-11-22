import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import {
  Copy,
  Flag,
  Heart,
  Link2,
  Pin,
  PinOff,
  Reply,
  ThumbsDown,
  Trash2,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { FeedSurface, Radii, Spacing, Type } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { postDeepLink } from '@/lib/deep-link';
import { formatCommentTimestamp } from '@/lib/format';
import { loadVoice, type VoiceComponents } from '@/lib/voice';
import { ImageViewer } from '@/features/media/MediaViewers';
import type { CommentReactionKind, PublicationComment } from '@/lib/types';
import { StickerMessage } from '@/features/stickers/StickerView';
import {
  COMMENT_REACTION_EMOJI,
  COMMENT_REACTION_KINDS,
} from './comment-reactions';
import { parseSocialText } from './rich-text';

/** Nombre de lignes affichées avant « voir plus ». */
const COLLAPSED_LINES = 2;

/** Retour haptique léger sur les actions du commentaire (best-effort). */
function tapHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

/**
 * Lecteur vocal d'un commentaire audio : le même composant que les messages
 * vocaux du chat, chargé à la demande (module natif absent des vieux builds).
 */
function CommentAudio({
  uri,
  durationMs,
  mine,
}: {
  uri: string;
  durationMs: number;
  mine: boolean;
}) {
  const [voice, setVoice] = useState<VoiceComponents | null>(null);
  useEffect(() => {
    let alive = true;
    void loadVoice().then((components) => {
      if (alive) {
        setVoice(components);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!voice) {
    return null;
  }
  const Bubble = voice.Bubble;
  return <Bubble uri={uri} durationMs={durationMs} mine={mine} />;
}

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
  onPin,
  onReact,
  indented = false,
  isPublicationAuthor = false,
  pinLimitReached = false,
  publicationAuthorId = null,
}: {
  comment: PublicationComment;
  onReply?: (comment: PublicationComment) => void;
  onReport?: (comment: PublicationComment) => void;
  onDelete?: (comment: PublicationComment) => void;
  onNotice?: (message: string) => void;
  onScoreChange?: (commentId: string, score: number) => void;
  /** Épingle/désépingle : visible uniquement pour l'auteur de la publication. */
  onPin?: (comment: PublicationComment, pinned: boolean) => void;
  /** Réaction emoji du visiteur (`null` retire sa réaction). */
  onReact?: (comment: PublicationComment, kind: CommentReactionKind | null) => void;
  indented?: boolean;
  /** Le visiteur est l'auteur de la publication parente. */
  isPublicationAuthor?: boolean;
  /** 3 commentaires déjà épinglés : l'action est masquée pour les autres. */
  pinLimitReached?: boolean;
  /** Auteur de la publication : son commentaire porte le badge « Auteur ». */
  publicationAuthorId?: string | null;
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
  /** URL de la photo ouverte en plein écran, `null` si la visionneuse est close. */
  const [viewerUri, setViewerUri] = useState<string | null>(null);
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
    tapHaptic();
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
    tapHaptic();
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
    if (onPin && isPublicationAuthor && !comment.parentId && (comment.pinned || !pinLimitReached)) {
      actions.push({
        key: 'pin',
        label: comment.pinned ? fr.social.unpinComment : fr.social.pinComment,
        icon: comment.pinned ? PinOff : Pin,
        onPress: () => onPin(comment, !comment.pinned),
      });
    }
    actions.push({
      key: 'copy',
      label: fr.social.copyComment,
      icon: Copy,
      onPress: () => void copy(),
    });
    actions.push({
      key: 'share',
      label: fr.social.shareComment,
      icon: Link2,
      onPress: () => {
        void Clipboard.setStringAsync(postDeepLink(comment.publicationId)).then(() =>
          onNotice?.(fr.social.commentLinkCopied),
        );
      },
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
  }, [comment, copy, isPublicationAuthor, isOwnComment, onDelete, onNotice, onPin, onReply, onReport, pinLimitReached, segments]);

  /** Corps du commentaire : texte simple, liens, mentions et hashtags. */
  const renderSegments = () =>
    segments.map((segment, index) => {
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
    });

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
        {comment.pinned ? (
          <View style={styles.pinnedBadge}>
            <Pin size={11} color={theme.textSecondary} />
            <ThemedText type="caption" themeColor="textSecondary">
              {fr.social.commentPinned}
            </ThemedText>
          </View>
        ) : null}
        <View style={styles.nameRow}>
          <ThemedText style={styles.author}>{comment.author.displayName}</ThemedText>
          {publicationAuthorId && comment.author.id === publicationAuthorId ? (
            <View style={[styles.creatorBadge, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="caption" style={[styles.creatorText, { color: theme.text }]}>
                {fr.social.commentCreatorBadge}
              </ThemedText>
            </View>
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
        {/* Photo : la légende vit dans la bulle média, sous l'image. */}
        {comment.attachment?.kind === 'image' && comment.attachment.url ? (
          <View
            style={[
              styles.mediaBubble,
              { backgroundColor: theme.backgroundSelected },
            ]}>
            <Pressable
              onPress={() => setViewerUri(comment.attachment?.url ?? null)}
              accessibilityRole="button"
              accessibilityLabel={fr.social.commentImageView}>
              <Image
                source={{ uri: comment.attachment.url }}
                style={styles.commentImage}
                contentFit="cover"
                transition={120}
                accessibilityLabel={fr.social.commentImage}
              />
            </Pressable>
            {comment.body.length > 0 ? (
              <View style={styles.captionWrap}>
                <ThemedText
                  style={styles.captionText}
                  numberOfLines={isLong && !expanded ? COLLAPSED_LINES : undefined}>
                  {renderSegments()}
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
              </View>
            ) : null}
          </View>
        ) : null}
        {/* Hors photo, le corps reste une ligne de texte classique. */}
        {comment.body.length > 0 && comment.attachment?.kind !== 'image' ? (
        <ThemedText
          style={styles.text}
          numberOfLines={isLong && !expanded ? COLLAPSED_LINES : undefined}>
          {renderSegments()}
        </ThemedText>
        ) : null}
        {isLong && comment.attachment?.kind !== 'image' ? (
          <Pressable
            onPress={() => setExpanded((value) => !value)}
            hitSlop={6}
            accessibilityRole="button">
            <ThemedText type="caption" themeColor="textSecondary">
              {expanded ? fr.social.seeLess : fr.social.seeMore}
            </ThemedText>
          </Pressable>
        ) : null}
        {comment.attachment?.kind === 'sticker' && comment.attachment.stickerRef ? (
          <View style={styles.stickerWrap}>
            <StickerMessage stickerRef={comment.attachment.stickerRef} size={96} />
          </View>
        ) : null}
        {comment.attachment?.kind === 'audio' && comment.attachment.url ? (
          <CommentAudio
            uri={comment.attachment.url}
            durationMs={comment.attachment.durationMs ?? 0}
            mine={isOwnComment}
          />
        ) : null}
        {/* Légende vocale d'une photo ou d'un sticker : bulle audio sous le média. */}
        {comment.attachment?.voice?.url ? (
          <CommentAudio
            uri={comment.attachment.voice.url}
            durationMs={comment.attachment.voice.durationMs ?? 0}
            mine={isOwnComment}
          />
        ) : null}
        <View style={styles.meta}>
          <ThemedText type="caption" themeColor="textSecondary">
            {formatCommentTimestamp(comment.createdAt)}
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
          {COMMENT_REACTION_KINDS.flatMap((kind) => {
            const reaction = comment.reactions.find((item) => item.kind === kind);
            const count = reaction?.count ?? 0;
            const mine = comment.viewerReaction === kind;
            if (count === 0 && !mine) {
              return [];
            }
            return [
              <Pressable
                key={kind}
                onPress={() => {
                  tapHaptic();
                  onReact?.(comment, mine ? null : kind);
                }}
                disabled={!onReact}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={fr.social.commentReactionNames[kind]}
                accessibilityState={{ selected: mine }}
                style={[
                  styles.reactionChip,
                  {
                    backgroundColor: mine
                      ? theme.accentSoft
                      : theme.backgroundSelected,
                  },
                ]}>
                <ThemedText style={styles.reactionEmoji}>
                  {COMMENT_REACTION_EMOJI[kind]}
                </ThemedText>
                {count > 0 ? (
                  <ThemedText
                    type="caption"
                    style={{ color: mine ? theme.accent : theme.textSecondary }}>
                    {count}
                  </ThemedText>
                ) : null}
              </Pressable>,
            ];
          })}
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
          {/* Compteur sous le cœur, comme Instagram et TikTok. */}
          {likeCount > 0 ? (
            <ThemedText type="caption" themeColor="textSecondary" style={styles.likeCount}>
              {likeCount}
            </ThemedText>
          ) : null}
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
      {viewerUri ? (
        <ImageViewer urls={[viewerUri]} initialIndex={0} onClose={() => setViewerUri(null)} />
      ) : null}
      <ActionSheet
        visible={menuOpen}
        title={fr.social.commentActionsTitle}
        header={
          onReact ? (
            <View style={styles.reactionBar}>
              {COMMENT_REACTION_KINDS.map((kind) => (
                <Pressable
                  key={kind}
                  onPress={() => {
                    tapHaptic();
                    setMenuOpen(false);
                    onReact(comment, comment.viewerReaction === kind ? null : kind);
                  }}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={fr.social.commentReactionNames[kind]}
                  style={styles.reactionBarItem}>
                  <ThemedText style={styles.reactionBarEmoji}>
                    {COMMENT_REACTION_EMOJI[kind]}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          ) : undefined
        }
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
  creatorBadge: {
    borderRadius: Radii.xs,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
  },
  creatorText: { fontSize: 10, fontWeight: '700' },
  likeCount: { fontSize: 11, marginTop: 1, textAlign: 'center' },
  commentImage: {
    width: 180,
    height: 180,
    borderRadius: Radii.md,
    marginTop: Spacing.one,
  },
  // Bulle média d'un commentaire photo : image + légende dans le même
  // conteneur arrondi, comme une carte média.
  mediaBubble: {
    borderRadius: Radii.md,
    overflow: 'hidden',
    alignSelf: 'flex-start',
    marginTop: Spacing.one,
  },
  captionWrap: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    gap: Spacing.half,
  },
  captionText: { fontSize: Type.body.fontSize },
  stickerWrap: { marginTop: Spacing.one, alignSelf: 'flex-start' },
  body: { flex: 1, gap: Spacing.one },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one, flexWrap: 'wrap' },
  // Nom sur sa propre ligne, commentaire en dessous : le gras et l'écart de
  // taille rendent la hiérarchie visible même avec la police Android.
  text: { ...Type.body, fontSize: 14, fontWeight: '400', flexWrap: 'wrap' },
  author: { ...Type.body, fontSize: 15.5, fontWeight: '700' },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  pinnedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginBottom: Spacing.half,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  reactionEmoji: { fontSize: 13 },
  reactionBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  reactionBarItem: { padding: Spacing.two },
  reactionBarEmoji: { fontSize: 26 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  action: { paddingVertical: Spacing.half, paddingLeft: Spacing.one, alignItems: 'center' },
});
