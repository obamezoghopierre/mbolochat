import { memo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ChatMetrics, useChatColors } from '@/constants/chat-theme';
import { Radii } from '@/constants/theme';

export const ChatBubble = memo(function ChatBubble({
  mine,
  children,
  style,
  tail = true,
}: {
  mine: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Dernière bulle d'une suite (ou isolée) : elle seule porte la queue. */
  tail?: boolean;
}) {
  const chat = useChatColors();
  return (
    <View
      style={[
        styles.bubble,
        mine ? { backgroundColor: chat.mineBubble } : { backgroundColor: chat.theirBubble },
        mine ? styles.bubbleMineEdge : styles.bubbleTheirsEdge,
        style,
      ]}>
      {tail ? (
        <View
          pointerEvents="none"
          style={[
            styles.tail,
            mine ? styles.tailRight : styles.tailLeft,
            mine ? { backgroundColor: chat.mineBubble } : { backgroundColor: chat.theirBubble },
          ]}
        />
      ) : null}
      {children}
    </View>
  );
});

export const chatBubbleStyles = StyleSheet.create({
  bubble: {
    borderRadius: ChatMetrics.bubbleRadius,
    paddingHorizontal: ChatMetrics.bubblePaddingH,
    paddingVertical: ChatMetrics.bubblePaddingV,
    gap: 2,
  },
  bubbleMineEdge: { borderTopRightRadius: Radii.xs },
  bubbleTheirsEdge: { borderTopLeftRadius: Radii.xs },
  tail: {
    position: 'absolute',
    width: ChatMetrics.bubbleTailSize,
    height: ChatMetrics.bubbleTailSize,
    borderRadius: 2,
    top: ChatMetrics.bubbleTailTop,
    transform: [{ rotate: '45deg' }],
  },
  tailLeft: { left: ChatMetrics.bubbleTailOffset },
  tailRight: { right: ChatMetrics.bubbleTailOffset },
});

const styles = chatBubbleStyles;
