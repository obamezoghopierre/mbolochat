import {
  AlertTriangle,
  BellOff,
  Bomb,
  CalendarClock,
  Check,
  CheckCheck,
  Clock,
  Phone,
  Pin,
} from 'lucide-react-native';
import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ChatPalette } from '@/constants/chat-theme';
import { ChatMetrics } from '@/constants/chat-theme';
import { Radii, Spacing, Type } from '@/constants/theme';
import { decodeMediaMeta } from '@/features/e2ee/payload';
import { SecureMediaMessage } from '@/features/e2ee/SecureMediaMessage';
import { SingleEmojiMessage } from '@/features/emoji/AnimatedEmoji';
import { MessageText } from '@/features/emoji/EmojiText';
import { emojiOnlyCount, splitEmoji, type EmojiSegment } from '@/features/emoji/emojiUtils';
import { ChatBubble } from '@/features/chat/ui/chat-bubble';
import { ChatDateSeparator, ChatMessageRow as ChatRowLayout, ChatTimeSeparator } from '@/features/chat/ui/chat-rows';
import { QuoteBlock } from '@/components/quote-block';
import { SwipeableBubble, type BubbleAnchor } from '@/components/swipeable-bubble';
import { ThemedText } from '@/components/themed-text';
import { GifMessageBubble } from '@/features/media/GifMessageBubble';
import { LinkPreviewInText } from './link-preview-card';
import {
  DocumentMessageBubble,
  ImageMessageBubble,
  VideoMessageBubble,
} from '@/features/media/MediaMessage';
import { mediaUrl } from '@/features/media/mediaUrl';
import { StickerMessageBubble } from '@/features/stickers/StickerMessageBubble';
import { reactionPresentation } from '@/features/stickers/reactionPresentation';
import { StickerMessage } from '@/features/stickers/StickerView';
import { VoiceMessageBubble } from '@/features/voice-notes/VoiceMessageBubble';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { formatClock } from '@/lib/format';
import { useTextScale } from '@/lib/text-scale';
import type { MessageQuote } from '@/lib/types';
import type { ChatRow } from '../model/rows';
import { sameChatMessageRow } from '../model/row-equality';
import type { ChatCapabilities, ChatIdentity, ChatMessageView } from '../transport/types';

export interface MediaOpenRequest {
  uri: string;
  kind: 'image' | 'video' | 'file' | 'audio';
  encrypted: boolean;
  uploadId?: string;
  name?: string;
  mime?: string;
  size?: number;
}

export interface ChatMessageRowProps {
  row: ChatRow;
  currentUser: ChatIdentity;
  isGroup: boolean;
  capabilities: ChatCapabilities;
  chat: ChatPalette;
  bubbleStyle: { maxWidth: number };
  windowWidth: number;
  token: string;
  resolveQuote: (id: string | null) => MessageQuote | null;
  /** Nombre de lecteurs d'un message (groupes), calculé par l'écran. */
  seenByCountFor?: (message: ChatMessageView) => number;
  onOpenAlbum?: (messages: ChatMessageView[], index: number) => void;
  onReply: (message: ChatMessageView) => void;
  onLongPress: (message: ChatMessageView, anchor?: BubbleAnchor) => void;
  onRetry: (message: ChatMessageView) => void;
  onDiscard: (message: ChatMessageView) => void;
  onOpenMedia: (request: MediaOpenRequest) => void;
  onOpenViewOnce: (message: ChatMessageView) => void;
  onToggleReaction: (message: ChatMessageView, reaction: string) => void;
  onPressAvatar?: (userId: string) => void;
  onSeenBy?: (message: ChatMessageView) => void;
  /** Messages épinglés dans cette conversation, pour marquer leur bulle. */
  pinnedMessageIds?: ReadonlySet<string>;
}

const TICK_ICON = {
  pending: Clock,
  failed: AlertTriangle,
  sent: Check,
  delivered: CheckCheck,
  read: CheckCheck,
} as const;

const TICK_LABEL = {
  pending: fr.chat.unified.tickPending,
  failed: fr.chat.unified.tickFailed,
  sent: fr.chat.unified.tickSent,
  delivered: fr.chat.unified.tickDelivered,
  read: fr.chat.unified.tickRead,
} as const;

function ReceiptBadge({
  message,
  capabilities,
  chat,
}: {
  message: ChatMessageView;
  capabilities: ChatCapabilities;
  chat: ChatPalette;
}) {
  if (!message.mine || message.state === 'none') return null;
  const state = message.state;
  const Icon = TICK_ICON[state];
  const color =
    state === 'read' ? chat.tickRead : state === 'failed' ? chat.error : chat.tick;
  const label =
    capabilities.receipts === 'delivered-opened' && state === 'delivered'
      ? fr.e2eeChat.receiptDelivered
      : capabilities.receipts === 'delivered-opened' && state === 'read'
        ? fr.e2eeChat.receiptRead
        : TICK_LABEL[state];
  return (
    <View accessible accessibilityLabel={label}>
      <Icon size={state === 'failed' ? 13 : 14} strokeWidth={2.6} color={color} />
    </View>
  );
}

function MessageMeta({
  message,
  capabilities,
  chat,
  alongsideReactions = false,
}: {
  message: ChatMessageView;
  capabilities: ChatCapabilities;
  chat: ChatPalette;
  /** Quand des réactions occupent la droite, on laisse la place au pastille. */
  alongsideReactions?: boolean;
}) {
  const scheduled =
    message.state === 'pending' && message.scheduledAt ? message.scheduledAt : null;
  return (
    <View
      style={[
        styles.metaRow,
        message.mine ? styles.metaRowMine : styles.metaRowTheirs,
        alongsideReactions ? styles.metaRowBesideReactions : null,
      ]}>
      {scheduled ? (
        <View accessible accessibilityLabel={fr.chat.sendOptions.schedule}>
          <CalendarClock size={12} strokeWidth={2.4} color={chat.secondaryText} />
        </View>
      ) : null}
      <ThemedText
        type="micro"
        style={[styles.metaTime, { color: message.mine ? chat.mineText : chat.theirText }]}>
        {formatClock(scheduled ?? message.createdAt)}
      </ThemedText>
      {message.edited ? (
        <ThemedText
          type="micro"
          style={[styles.metaTime, { color: message.mine ? chat.mineText : chat.theirText }]}>
          {fr.chat.unified.edited}
        </ThemedText>
      ) : null}
      {message.silent ? (
        <View accessible accessibilityLabel={fr.chat.sendOptions.silent}>
          <BellOff size={12} strokeWidth={2.4} color={chat.secondaryText} />
        </View>
      ) : null}
      {scheduled ? null : (
        <ReceiptBadge message={message} capabilities={capabilities} chat={chat} />
      )}
    </View>
  );
}

function RetryActions({
  message,
  chat,
  onRetry,
  onDiscard,
}: {
  message: ChatMessageView;
  chat: ChatPalette;
  onRetry: (message: ChatMessageView) => void;
  onDiscard: (message: ChatMessageView) => void;
}) {
  return (
    <View style={styles.failedBlock}>
      <ThemedText style={[styles.failedText, { color: chat.error }]} numberOfLines={2}>
        {message.error ?? fr.chat.unified.failedToSend}
      </ThemedText>
      <View style={styles.failedActions}>
        <Pressable
          onPress={() => onRetry(message)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={fr.chat.retrySend}>
          <ThemedText type="micro" style={{ color: chat.error }}>
            {fr.chat.retry}
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => onDiscard(message)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={fr.chat.removeMessage}>
          <ThemedText type="micro" themeColor="textSecondary">
            {fr.chat.menu.delete}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function ReactionChips({
  message,
  onToggle,
  align = 'start',
}: {
  message: ChatMessageView;
  onToggle: (message: ChatMessageView, reaction: string) => void;
  align?: 'start' | 'end';
}) {
  const theme = useTheme();
  if (message.reactions.length === 0) return null;
  return (
    <View
      style={[
        styles.reactions,
        align === 'end' ? styles.reactionsEnd : styles.reactionsStart,
      ]}>
      {message.reactions.map((reaction) => {
        const presentation = reactionPresentation(reaction.reaction);
        if (!presentation) return null;
        return (
          <Pressable
            key={reaction.reaction}
            onPress={() => onToggle(message, reaction.reaction)}
            accessibilityRole="button"
            accessibilityLabel={`${presentation.label}, ${reaction.count}`}
            style={[
              styles.reactionChip,
              {
                backgroundColor: reaction.mine ? theme.accentSoft : theme.backgroundElement,
                borderColor: reaction.mine ? theme.accent : theme.border,
              },
            ]}>
            <ThemedText style={styles.reactionEmoji}>{presentation.emoji}</ThemedText>
            {reaction.count > 1 ? (
              <ThemedText type="micro" themeColor="textSecondary">
                {reaction.count}
              </ThemedText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function MessageBody({
  message,
  quote,
  capabilities,
  chat,
  bubbleStyle,
  onReply,
  onLongPress,
  onRetry,
  onDiscard,
  onOpenMedia,
  onOpenViewOnce,
  token,
  reactionsInline = false,
  tail = true,
}: {
  message: ChatMessageView;
  quote: MessageQuote | null;
  capabilities: ChatCapabilities;
  chat: ChatPalette;
  bubbleStyle: { maxWidth: number };
  onReply: (message: ChatMessageView) => void;
  onLongPress: (message: ChatMessageView, anchor?: BubbleAnchor) => void;
  onRetry: (message: ChatMessageView) => void;
  onDiscard: (message: ChatMessageView) => void;
  onOpenMedia: (request: MediaOpenRequest) => void;
  onOpenViewOnce: (message: ChatMessageView) => void;
  token: string;
  /** La pastille de réactions occupe la ligne sous la bulle, à droite. */
  reactionsInline?: boolean;
  /** Queue de bulle : masquée dans une suite pour laisser le fil continu. */
  tail?: boolean;
}) {
  const textScale = useTextScale();
  const waiting = message.state === 'pending';
  const failed = message.state === 'failed';
  const attachment = message.attachment;
  const accessibleLabel = failed
    ? fr.chat.retrySend
    : fr.chat.unified.messageOptions;
  const meta = (
    <MessageMeta
      message={message}
      capabilities={capabilities}
      chat={chat}
      alongsideReactions={reactionsInline}
    />
  );

  const swipe = (content: ReactNode) => (
    <SwipeableBubble
      mine={message.mine}
      onReply={() => onReply(message)}
      onLongPress={(anchor) => onLongPress(message, anchor)}
      swipeEnabled={!message.viewOnce}
      style={bubbleStyle}
      accessibilityLabel={accessibleLabel}>
      {content}
    </SwipeableBubble>
  );

  if (message.viewOnce) {
    const viewOnceLabel =
      attachment?.type === 'VIDEO'
        ? fr.chat.viewOnce.video
        : attachment?.type === 'AUDIO'
          ? fr.chat.viewOnce.voice
          : fr.chat.viewOnce.photo;
    return swipe(
      <View style={[styles.viewOnceBlock, message.mine ? styles.alignEnd : null]}>
        <Pressable
          onPress={() => onOpenViewOnce(message)}
          accessibilityRole="button"
          accessibilityLabel={fr.chat.viewOnce.opening}
          style={({ pressed }) => [
            styles.viewOnceButton,
            { borderColor: chat.border, backgroundColor: chat.theirBubble },
            pressed && { opacity: 0.72 },
          ]}>
          <Bomb size={20} strokeWidth={2.1} color={chat.primaryText} />
          <ThemedText type="smallBold" style={{ color: chat.primaryText }}>
            {viewOnceLabel}
          </ThemedText>
        </Pressable>
        {meta}
      </View>,
    );
  }

  if (message.stickerRef) {
    return swipe(
      <View style={[styles.stickerBlock, message.mine ? styles.alignEnd : null]}>
        {quote ? (
          <View style={styles.quoteBlock}>
            <QuoteBlock quote={quote} mine={message.mine} />
          </View>
        ) : null}
        <StickerMessage stickerRef={message.stickerRef} size={140} />
        {meta}
      </View>,
    );
  }

  if (attachment?.encrypted) {
    const media = decodeMediaMeta(attachment.mediaMeta);
    if (media) {
      return swipe(
        <View style={[styles.mediaBlock, message.mine ? styles.alignEnd : null]}>
          {quote ? (
            <View style={styles.quoteBlock}>
              <QuoteBlock quote={quote} mine={message.mine} />
            </View>
          ) : null}
          <SecureMediaMessage
            token={token}
            media={media}
            mine={message.mine}
            caption={message.body || undefined}
            footer={media.type === 'AUDIO' ? meta : undefined}
            tail={tail}
            onLongPress={() => onLongPress(message)}
            onOpen={(uri, opened) =>
              onOpenMedia({
                uri,
                kind:
                  opened.type === 'VIDEO'
                    ? 'video'
                    : opened.type === 'AUDIO'
                      ? 'audio'
                      : opened.type === 'FILE'
                        ? 'file'
                        : 'image',
                encrypted: true,
                uploadId: opened.blob.uploadId,
                name: opened.name,
                mime: opened.mime,
                size: opened.blob.size,
              })
            }
          />
          {media.type === 'AUDIO' ? null : meta}
        </View>,
      );
    }
  }

  if (attachment?.type === 'AUDIO' && attachment.url) {
    const uri = mediaUrl(attachment.url);
    return swipe(
      <View style={[styles.mediaBlock, message.mine ? styles.alignEnd : null]}>
        {/* L'heure et l'accusé vivent dans la bulle, comme sur une bulle de texte. */}
        <VoiceMessageBubble
          id={message.id}
          uri={uri}
          durationMs={attachment.durationMs ?? 0}
          isMine={message.mine}
          speedControl
          footer={meta}
        />
        {failed ? (
          <RetryActions message={message} chat={chat} onRetry={onRetry} onDiscard={onDiscard} />
        ) : null}
      </View>,
    );
  }

  if (attachment?.type === 'STICKER' && attachment.url) {
    return swipe(
      <View style={[styles.mediaBlock, message.mine ? styles.alignEnd : null]}>
        <StickerMessageBubble
          uri={mediaUrl(attachment.url)}
          name={attachment.stickerName ?? undefined}
          width={attachment.width ?? undefined}
          height={attachment.height ?? undefined}
          sending={waiting}
          failed={failed}
          onLongPress={() => onLongPress(message)}
          onRetry={() => onRetry(message)}
          onPress={() =>
            onOpenMedia({
              uri: mediaUrl(attachment.url as string),
              kind: 'image',
              encrypted: false,
            })
          }
        />
        {failed ? (
          <RetryActions message={message} chat={chat} onRetry={onRetry} onDiscard={onDiscard} />
        ) : null}
        {meta}
      </View>,
    );
  }

  if (attachment && attachment.url) {
    const uri = mediaUrl(attachment.url);
    const width = attachment.width ?? Math.round(bubbleStyle.maxWidth * 0.8);
    const height = attachment.height ?? Math.round(width * 0.75);
    return swipe(
      <View style={[styles.mediaBlock, message.mine ? styles.alignEnd : null]}>
        {quote ? (
          <View style={styles.quoteBlock}>
            <QuoteBlock quote={quote} mine={message.mine} />
          </View>
        ) : null}
        {attachment.type === 'IMAGE' ? (
          <ImageMessageBubble
            uri={uri}
            width={width}
            height={height}
            sending={waiting}
            progress={message.progress}
            failed={failed}
            onRetry={() => onRetry(message)}
            onPress={() => onOpenMedia({ uri, kind: 'image', encrypted: false })}
            onLongPress={() => onLongPress(message)}
          />
        ) : attachment.type === 'VIDEO' ? (
          <VideoMessageBubble
            uri={uri}
            width={width}
            height={height}
            durationMs={attachment.durationMs ?? undefined}
            sending={waiting}
            progress={message.progress}
            failed={failed}
            onRetry={() => onRetry(message)}
            onPress={() => onOpenMedia({ uri, kind: 'video', encrypted: false })}
            onLongPress={() => onLongPress(message)}
          />
        ) : attachment.type === 'GIF' ? (
          <GifMessageBubble
            uri={uri}
            stillUri={attachment.giphy?.stillUrl ?? undefined}
            sticker={attachment.giphy?.sticker ?? false}
            width={width}
            height={height}
            sending={waiting}
            failed={failed}
            onRetry={() => onRetry(message)}
            onPress={() => onOpenMedia({ uri, kind: 'image', encrypted: false })}
            onLongPress={() => onLongPress(message)}
          />
        ) : (
          <DocumentMessageBubble
            name={attachment.name ?? 'fichier'}
            mime={attachment.mime ?? 'application/octet-stream'}
            size={attachment.size}
            width={Math.round(bubbleStyle.maxWidth * 0.9)}
            mine={message.mine}
            sending={waiting}
            progress={message.progress}
            uploadedBytes={null}
            totalBytes={null}
            failed={failed}
            onRetry={() => onRetry(message)}
            onOpen={() =>
              onOpenMedia({
                uri,
                kind: 'file',
                encrypted: false,
                name: attachment.name ?? undefined,
                mime: attachment.mime ?? undefined,
                size: attachment.size ?? undefined,
              })
            }
            onLongPress={() => onLongPress(message)}
          />
        )}
        {message.body ? (
          <>
            {!capabilities.encrypted || message.preview ? (
              <LinkPreviewInText text={message.body} preview={message.preview} />
            ) : null}
            <MessageText text={message.body} style={[styles.caption, { color: chat.primaryText }]} />
          </>
        ) : null}
        {failed ? (
          <RetryActions message={message} chat={chat} onRetry={onRetry} onDiscard={onDiscard} />
        ) : null}
        {meta}
      </View>,
    );
  }

  const trimmed = message.body.trim();
  const emojiCount = message.unreadable ? 0 : emojiOnlyCount(trimmed);
  if (emojiCount >= 1 && emojiCount <= 3) {
    const segment =
      emojiCount === 1
        ? splitEmoji(trimmed).find((entry): entry is EmojiSegment => entry.type === 'emoji')
        : undefined;
    return swipe(
      <View style={[styles.emojiBlock, message.mine ? styles.alignEnd : null]}>
        {quote ? (
          <View style={styles.quoteBlock}>
            <QuoteBlock quote={quote} mine={message.mine} />
          </View>
        ) : null}
        {emojiCount === 1 && segment ? (
          <SingleEmojiMessage
            emoji={segment.value}
            messageId={message.clientId ?? message.id}
            fresh={false}
          />
        ) : (
          <MessageText text={trimmed} style={[styles.emojiText, { color: chat.primaryText }]} />
        )}
        {failed ? (
          <RetryActions message={message} chat={chat} onRetry={onRetry} onDiscard={onDiscard} />
        ) : null}
        {meta}
      </View>,
    );
  }

  return swipe(
    <ChatBubble mine={message.mine} tail={tail}>
      {quote ? <QuoteBlock quote={quote} mine={message.mine} /> : null}
      {!capabilities.encrypted || message.preview ? (
        <LinkPreviewInText text={message.body} preview={message.preview} />
      ) : null}
      {message.unreadable ? (
        <ThemedText type="small" style={[styles.unreadable, { color: chat.secondaryText }]}>
          {fr.chat.unified.unreadableMessage}
        </ThemedText>
      ) : (
        <MessageText
          text={message.body}
          style={[
            styles.text,
            { color: chat.primaryText },
            textScale.factor !== 1
              ? {
                  fontSize: 16 * textScale.factor,
                  lineHeight: 21 * textScale.factor,
                }
              : null,
          ]}
        />
      )}
      {failed ? (
        <RetryActions message={message} chat={chat} onRetry={onRetry} onDiscard={onDiscard} />
      ) : null}
      {meta}
    </ChatBubble>,
  );
}

function ChatMessageRowComponent(props: ChatMessageRowProps) {
  const { row, currentUser, isGroup, capabilities, chat, token } = props;
  const theme = useTheme();

  if (row.type === 'date') {
    return <ChatDateSeparator label={row.label} />;
  }
  if (row.type === 'time') {
    return <ChatTimeSeparator label={row.label} />;
  }
  if (row.type === 'unread') {
    return (
      <View style={styles.unreadRow}>
        <View style={[styles.unreadLine, { backgroundColor: chat.border }]} />
        <ThemedText type="micro" themeColor="textSecondary">
          {fr.chat.unified.unreadCount(row.count)}
        </ThemedText>
        <View style={[styles.unreadLine, { backgroundColor: chat.border }]} />
      </View>
    );
  }

  if (row.type === 'album') {
    const first = row.messages[0];
    if (!first) return null;
    const mine = first.mine;
    const tileWidth = Math.max(
      80,
      Math.round(Math.min(props.bubbleStyle.maxWidth, 320) / 2 - 2),
    );
    return (
      <ChatRowLayout
        mine={mine}
        continuation={row.continuation}
        group={row.group}
        avatarName={mine ? currentUser.displayName : first.sender.displayName}
        avatarUri={mine ? currentUser.avatarUrl : first.sender.avatarUrl}
        gender={mine ? currentUser.gender : first.sender.gender}
        onAvatarPress={
          !mine && props.onPressAvatar ? () => props.onPressAvatar?.(first.sender.id) : undefined
        }>
        <View style={[styles.albumGrid, { maxWidth: tileWidth * 2 + 4 }]}>
          {row.messages.map((message, index) => {
            const attachment = message.attachment;
            if (!attachment?.url) return null;
            const uri = mediaUrl(attachment.url);
            return (
              <ImageMessageBubble
                key={message.id}
                uri={uri}
                width={tileWidth}
                height={tileWidth}
                sending={message.state === 'pending'}
                failed={message.state === 'failed'}
                onRetry={() => props.onRetry(message)}
                onPress={() =>
                  props.onOpenAlbum
                    ? props.onOpenAlbum(row.messages, index)
                    : props.onOpenMedia({ uri, kind: 'image', encrypted: false })
                }
                onLongPress={() => props.onLongPress(message)}
              />
            );
          })}
        </View>
      </ChatRowLayout>
    );
  }

  const message = row.message;
  if (message.type === 'system' || message.type === 'call') {
    return (
      <View style={styles.systemRow}>
        {message.type === 'call' ? (
          <Phone size={13} strokeWidth={2.4} color={chat.systemText} />
        ) : null}
        <ThemedText type="caption" style={{ color: chat.systemText }}>
          {message.body}
        </ThemedText>
      </View>
    );
  }
  if (message.deleted) {
    return (
      <ChatRowLayout
        mine={message.mine}
        continuation={row.continuation}
        group={row.group}
        avatarName={message.mine ? currentUser.displayName : message.sender.displayName}
        avatarUri={message.mine ? currentUser.avatarUrl : message.sender.avatarUrl}
        gender={message.mine ? currentUser.gender : message.sender.gender}>
        <View
          style={[
            styles.deletedBubble,
            { backgroundColor: chat.theirBubble, borderColor: chat.border },
          ]}>
          <ThemedText type="small" style={[styles.deletedText, { color: chat.secondaryText }]}>
            {fr.chat.unified.deletedForEveryone}
          </ThemedText>
        </View>
      </ChatRowLayout>
    );
  }

  const quote = message.quote ?? props.resolveQuote(message.quoteId);
  const pinned = props.pinnedMessageIds?.has(message.id) ?? false;
  return (
    <ChatRowLayout
      mine={message.mine}
      continuation={row.continuation}
      group={row.group}
      avatarName={message.mine ? currentUser.displayName : message.sender.displayName}
      avatarUri={message.mine ? currentUser.avatarUrl : message.sender.avatarUrl}
      gender={message.mine ? currentUser.gender : message.sender.gender}
      onAvatarPress={
        !message.mine && props.onPressAvatar
          ? () => props.onPressAvatar?.(message.sender.id)
          : undefined
      }>
      <View>
        {!message.mine && isGroup && !row.continuation ? (
          <ThemedText
            type="smallBold"
            style={[styles.senderName, { color: chat.secondaryText }]}>
            {message.sender.displayName}
          </ThemedText>
        ) : null}
        <View
          style={[
            styles.messageStack,
            message.reactions.length > 0 ? styles.messageStackWithReactions : null,
            !message.mine && message.reactions.length > 0 ? styles.messageStackReceived : null,
          ]}>
          {pinned ? (
            <View
              accessible
              accessibilityLabel={fr.chat.unified.pinnedMessage}
              pointerEvents="none"
              style={[
                styles.pinBadge,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
              ]}>
              <Pin size={10} strokeWidth={2.6} color={theme.accent} />
            </View>
          ) : null}
          <MessageBody
            message={message}
            quote={quote}
            capabilities={capabilities}
            chat={chat}
            bubbleStyle={props.bubbleStyle}
            onReply={props.onReply}
            onLongPress={props.onLongPress}
            onRetry={props.onRetry}
            onDiscard={props.onDiscard}
            onOpenMedia={props.onOpenMedia}
            onOpenViewOnce={props.onOpenViewOnce}
            token={token}
            reactionsInline={!message.mine}
            tail={row.group === 'single' || row.group === 'last'}
          />
          {capabilities.reactions && !message.viewOnce ? (
            <ReactionChips
              message={message}
              onToggle={props.onToggleReaction}
              align={message.mine ? 'start' : 'end'}
            />
          ) : null}
        </View>
        {message.mine && isGroup && (props.seenByCountFor?.(message) ?? 0) > 0 ? (
          <Pressable
            onPress={() => props.onSeenBy?.(message)}
            accessibilityRole="button"
            accessibilityLabel={fr.chat.unified.seenBy(props.seenByCountFor?.(message) ?? 0)}
            style={styles.seenBy}>
            <ThemedText type="micro" themeColor="textSecondary">
              {fr.chat.unified.seenBy(props.seenByCountFor?.(message) ?? 0)}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </ChatRowLayout>
  );
}

/**
 * Ligne mémoïsée : la comparaison pure est dans `row-equality.ts` et porte sur
 * les références de messages, jamais sur l'objet de rangée recréé.
 */
export const ChatMessageRow = memo(ChatMessageRowComponent, sameChatMessageRow);

const styles = StyleSheet.create({
  stickerBlock: { gap: Spacing.one, maxWidth: ChatMetrics.stickerMaxWidth },
  alignEnd: { alignItems: 'flex-end' },
  quoteBlock: { width: '100%', borderRadius: Radii.sm, padding: Spacing.one },
  mediaBlock: { gap: Spacing.one, maxWidth: '100%' },
  caption: { ...Type.body },
  emojiBlock: { maxWidth: ChatMetrics.emojiMaxWidth, gap: Spacing.one },
  emojiText: { textAlign: 'center' },
  viewOnceBlock: { gap: Spacing.one, maxWidth: '100%' },
  viewOnceButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  text: { ...Type.message },
  unreadable: { fontStyle: 'italic', opacity: 0.8 },
  failedBlock: { gap: Spacing.half, maxWidth: '100%' },
  failedText: { ...Type.micro },
  failedActions: { flexDirection: 'row', gap: Spacing.three },
  messageStack: { position: 'relative', maxWidth: '100%' },
  pinBadge: {
    position: 'absolute',
    left: Spacing.one,
    top: ChatMetrics.pinBadgeTop,
    width: ChatMetrics.pinBadgeSize,
    height: ChatMetrics.pinBadgeSize,
    borderRadius: Radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  messageStackWithReactions: { marginBottom: ChatMetrics.reactionStackMargin },
  /** Bulle reçue : la pastille de réactions se cale à droite de l’heure. */
  messageStackReceived: { alignSelf: 'flex-start' },
  reactions: {
    position: 'absolute',
    bottom: ChatMetrics.reactionBottomOffset,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    zIndex: 2,
    maxWidth: '100%',
  },
  reactionsStart: { left: 6 },
  reactionsEnd: { right: 6 },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ChatMetrics.reactionGap,
    minHeight: ChatMetrics.reactionChipMinHeight,
    paddingHorizontal: ChatMetrics.reactionChipPaddingH,
    paddingVertical: 2,
    borderRadius: Radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reactionEmoji: { fontSize: ChatMetrics.reactionEmojiSize, lineHeight: 18 },
  deletedBubble: {
    maxWidth: '100%',
    paddingHorizontal: ChatMetrics.bubblePaddingH,
    paddingVertical: ChatMetrics.bubblePaddingV,
    borderRadius: ChatMetrics.bubbleRadius,
    borderWidth: StyleSheet.hairlineWidth,
  },
  deletedText: { fontStyle: 'italic' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ChatMetrics.metaGap,
    marginTop: Spacing.half,
  },
  /** Bulle reçue : l’heure se range à gauche. */
  metaRowTheirs: { alignSelf: 'flex-start' },
  /** Bulle envoyée : comportement historique, l’heure reste à droite. */
  metaRowMine: { alignSelf: 'flex-end' },
  metaRowBesideReactions: {
    marginRight: ChatMetrics.metaBesideReactions,
    alignSelf: 'flex-start',
  },
  metaTime: { ...Type.meta, opacity: 0.78 },
  seenBy: { alignSelf: 'flex-end' },
  senderName: { ...Type.sender },
  systemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: Spacing.one,
    marginVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  unreadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  unreadLine: { flex: 1, height: StyleSheet.hairlineWidth },
  albumGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
});
