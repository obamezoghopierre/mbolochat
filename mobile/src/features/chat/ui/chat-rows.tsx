import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ChatMetrics, useChatColors } from '@/constants/chat-theme';
import { Radii, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Gender } from '@/lib/types';
import { messageRowLayout, ROW_AVATAR_SIZE } from '@/features/chat/row-layout';
import type { ChatGroup } from '../model/rows';

/**
 * Lignes communes aux deux conversations : séparateurs de date et d'heure,
 * rangée de message (avatar + colonne de bulle). Les mêmes valeurs que l'écran
 * classique, pour que la conversation chiffrée ne « saute » pas d'un pixel.
 */

export function ChatDateSeparator({ label }: { label: string }) {
  const chat = useChatColors();
  const theme = useTheme();
  return (
    <View style={styles.dateRow}>
      <ThemedView
        style={[
          styles.datePill,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        <ThemedText type="micro" style={[styles.dateText, { color: chat.dateText }]}>
          {label}
        </ThemedText>
      </ThemedView>
    </View>
  );
}

export function ChatTimeSeparator({ label }: { label: string }) {
  const chat = useChatColors();
  return (
    <View style={styles.timeRow}>
      <ThemedText style={[styles.timeText, { color: chat.secondaryText }]}>{label}</ThemedText>
    </View>
  );
}

export function ChatMessageRow({
  mine,
  continuation,
  group = 'single',
  avatarName,
  avatarUri,
  gender,
  onAvatarPress,
  children,
}: {
  mine: boolean;
  /** Message consécutif du même expéditeur : l'avatar n'est pas répété. */
  continuation?: boolean;
  /** Position dans la suite : le fil court sur le bord de la bulle. */
  group?: ChatGroup;
  avatarName: string;
  avatarUri?: string | null;
  gender?: Gender | null;
  /** Ouvre le profil de l'expéditeur (messages envoyés : le sien). */
  onAvatarPress?: () => void;
  children: ReactNode;
}) {
  // Disposition WeChat : chaque message porte l'avatar de son expéditeur —
  // à gauche pour les messages reçus, à droite pour les messages envoyés — et
  // la bulle est alignée du même côté. La logique de placement est pure et
  // testée à part (features/chat/row-layout.ts).
  const chat = useChatColors();
  const layout = messageRowLayout(mine, Boolean(continuation));
  const avatar =
    layout.avatar === 'none' ? (
      layout.spacer === 'left' ? (
        <View style={styles.avatarSpacer} />
      ) : null
    ) : (
      <Pressable
        disabled={!onAvatarPress}
        onPress={onAvatarPress}
        hitSlop={4}
        accessibilityRole={onAvatarPress ? 'button' : undefined}
        accessibilityLabel={onAvatarPress ? avatarName : undefined}>
        <Avatar
          name={avatarName}
          uri={avatarUri ?? undefined}
          size={ROW_AVATAR_SIZE}
          gender={gender}
          shape="rounded"
        />
      </Pressable>
    );
  const column = (
    <View style={[styles.bubbleColumn, { alignItems: layout.align }]}>{children}</View>
  );
  const connect = group === 'middle' || group === 'last';
  return (
    <View style={continuation ? styles.groupContinuation : styles.groupNew}>
      {connect ? (
        // Enfant flex de l'espacement : sa hauteur suit exactement l'écart
        // entre les deux bulles, sans position absolue ni débordement.
        <View style={styles.connectorSlot} pointerEvents="none">
          <View
            style={[
              styles.connectorLine,
              { backgroundColor: chat.border },
              mine ? styles.connectorRight : styles.connectorLeft,
            ]}
          />
        </View>
      ) : null}
      <View style={styles.messageRow}>
        {layout.bubbleFirst ? column : avatar}
        {layout.bubbleFirst ? avatar : column}
      </View>
    </View>
  );
}

export const chatRowStyles = StyleSheet.create({
  dateRow: { alignItems: 'center', paddingVertical: Spacing.two },
  datePill: {
    paddingHorizontal: Spacing.threeHalf,
    paddingVertical: Spacing.one,
    borderRadius: Radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dateText: { ...Type.micro },
  timeRow: { alignItems: 'center', paddingVertical: Spacing.one },
  timeText: { ...Type.micro },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  /**
   * Conteneur flexbox d'une suite : chaque bulle est précédée, sauf la
   * première, d'un emplacement d'écart uniforme qui porte le connecteur.
   */
  groupNew: { marginTop: Spacing.threeHalf, flexDirection: 'column' },
  groupContinuation: { flexDirection: 'column' },
  connectorSlot: {
    height: Spacing.one,
    alignSelf: 'stretch',
    flexDirection: 'row',
  },
  connectorLine: {
    width: ChatMetrics.threadWidth,
    height: '100%',
    borderRadius: ChatMetrics.threadWidth / 2,
  },
  /** Bord gauche de la bulle reçue (après l'avatar). */
  connectorLeft: { marginLeft: ROW_AVATAR_SIZE + Spacing.two },
  /** Bord droit de la bulle envoyée. */
  connectorRight: { marginLeft: 'auto' },
  bubbleColumn: { flex: 1, minWidth: 0 },
  /** Réserve la place de l'avatar carré des messages reçus consécutifs. */
  avatarSpacer: { width: ROW_AVATAR_SIZE },
});

const styles = chatRowStyles;
