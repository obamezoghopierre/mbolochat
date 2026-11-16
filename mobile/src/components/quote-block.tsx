import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChatMetrics, useChatColors } from '@/constants/chat-theme';
import { Radii, Spacing, Type } from '@/constants/theme';
import { EmojiText } from '@/features/emoji/EmojiText';
import { fr } from '@/i18n/fr';
import type { MessageQuote } from '@/lib/types';

/** Aperçu d'un message cité : texte, ou libellé de la pièce jointe. */
export function quoteText(quote: MessageQuote): string {
  if (quote.deleted) {
    return fr.chat.quote.deleted;
  }
  if (quote.type === 'sticker') {
    return fr.chat.quote.sticker;
  }
  if (quote.content) {
    return quote.content;
  }
  switch (quote.attachmentType) {
    case 'AUDIO':
      return fr.chat.quote.voice;
    case 'VIDEO':
      return fr.chat.quote.video;
    case 'IMAGE':
      return fr.chat.quote.photo;
    case 'GIF':
      return fr.chat.quote.gif;
    case 'STICKER':
      return fr.chat.quote.sticker;
    case 'FILE':
      return fr.chat.quote.document;
    default:
      return fr.chat.quote.attachment;
  }
}

/** Bandeau du message cité, posé au-dessus du texte de la réponse. */
export function QuoteBlock({
  quote,
  mine,
  onPress,
}: {
  quote: MessageQuote;
  mine: boolean;
  onPress?: () => void;
}) {
  const chat = useChatColors();
  const tone = useMemo(
    () => ({
      quote: { backgroundColor: mine ? chat.quoteBackgroundMine : chat.quoteBackground },
      bar: { backgroundColor: mine ? chat.quoteBarMine : chat.quoteBar },
      name: { color: chat.quoteName },
      text: { color: chat.quoteText },
    }),
    [chat, mine],
  );
  const body = (
    <View style={[styles.quote, tone.quote]}>
      <View style={[styles.quoteBar, tone.bar]} />
      <View style={styles.quoteBody}>
        <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail" style={tone.name}>
          {quote.senderName}
        </ThemedText>
        <EmojiText
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.quotePreviewText, tone.text]}>
          {quoteText(quote)}
        </EmojiText>
      </View>
    </View>
  );
  if (!onPress) {
    return body;
  }
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={fr.chat.quote.goToMessage}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quote: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    maxWidth: '100%',
    gap: Spacing.two,
    borderRadius: Radii.xs,
    paddingVertical: Spacing.one,
    paddingRight: Spacing.one,
    overflow: 'hidden',
  },
  quoteBar: {
    width: ChatMetrics.quoteBarWidth,
    minHeight: ChatMetrics.quoteBarMinHeight,
    borderRadius: Radii.full,
  },
  quotePreviewText: {
    ...Type.caption,
    fontWeight: '500',
  },
  quoteBody: {
    flex: 1,
    minWidth: 0,
    gap: 1,
    paddingRight: Spacing.one,
  },
});
