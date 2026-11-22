import { Link2, QrCode, Send, UserPlus } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { conversationTitle } from '@/lib/format';
import { fr } from '@/i18n/fr';
import type { ConversationSummary } from '@/lib/types';

/** Discussions proposées dans la feuille de partage, les plus récentes d'abord. */
const MAX_TARGETS = 12;

/** Action complémentaire de la rangée (modération : signalements, etc.). */
export interface ShareSheetAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  /** Teinte danger pour les actions destructrices (supprimer, signaler). */
  danger?: boolean;
}

/**
 * Rangée « Envoyer à » de la feuille de partage : les conversations récentes
 * en avatars, comme la rangée de destinataires d'Instagram. Le choix envoie
 * le lien profond de la publication dans la discussion.
 */
export function ShareTargetsRow({
  token,
  currentUserId,
  onPick,
  onCopyLink,
  onShare,
  onShareTo,
  onShowQr,
  extraActions,
  moreActions,
}: {
  token: string;
  currentUserId: string | null;
  onPick: (conversation: ConversationSummary) => void;
  /** « Copier le lien » : affiché en fin de rangée quand fourni. */
  onCopyLink?: () => void;
  /** « Partager… » (feuille système) : affiché en fin de rangée. */
  onShare?: () => void;
  /** « Partager à » : ouvre le sélecteur d'amis pour un envoi en MP. */
  onShareTo?: () => void;
  /** « QR code » : affiche le QR du lien profond de la publication. */
  onShowQr?: () => void;
  /** Actions ajoutées en fin de rangée de partage (Republier, Citer). */
  extraActions?: ShareSheetAction[];
  /**
   * Options de la publication (pas intéressé, masquer, modifier, supprimer,
   * signaler), en liste sous les partages — séparées comme sur Instagram.
   */
  moreActions?: ShareSheetAction[];
}) {
  const theme = useTheme();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);

  useEffect(() => {
    let active = true;
    api
      .listConversations(token)
      .then((list) => {
        if (active) setConversations(list.slice(0, MAX_TARGETS));
      })
      .catch(() => {
        if (active) setConversations([]);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const hasActions =
    !!onCopyLink ||
    !!onShare ||
    !!onShareTo ||
    !!onShowQr ||
    !!extraActions?.length ||
    !!moreActions?.length;
  if ((!conversations || conversations.length === 0) && !hasActions) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      {conversations && conversations.length > 0 ? (
        <>
          <ThemedText type="caption" themeColor="textSecondary">
            {fr.social.sendToLabel}
          </ThemedText>
          {/* Rangée scrollable horizontalement, comme les destinataires IG :
              les discussions dépassent la largeur au lieu d'être tronquées. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
            keyboardShouldPersistTaps="handled">
            {conversations.map((conversation) => (
              <ShareTarget
                key={conversation.id}
                conversation={conversation}
                currentUserId={currentUserId}
                onPress={() => onPick(conversation)}
              />
            ))}
          </ScrollView>
        </>
      ) : null}
      {hasActions ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          keyboardShouldPersistTaps="handled">
          {extraActions?.map((action) => (
            <ShareActionTarget
              key={action.key}
              icon={action.icon}
              label={action.label}
              onPress={action.onPress}
              danger={action.danger}
            />
          ))}
          {onCopyLink ? (
            <ShareActionTarget
              icon={Link2}
              label={fr.social.copyLink}
              onPress={onCopyLink}
            />
          ) : null}
          {onShowQr ? (
            <ShareActionTarget
              icon={QrCode}
              label={fr.social.qrCodeLabel}
              onPress={onShowQr}
            />
          ) : null}
          {onShare ? (
            <ShareActionTarget icon={Send} label={fr.social.shareLabel} onPress={onShare} />
          ) : null}
          {onShareTo ? (
            <ShareActionTarget
              icon={UserPlus}
              label={fr.social.shareToLabel}
              onPress={onShareTo}
            />
          ) : null}
        </ScrollView>
      ) : null}
      {moreActions && moreActions.length > 0 ? (
        <View style={[styles.more, { borderTopColor: theme.border }]}>
          {moreActions.map((action) => {
            const tint = action.danger ? theme.danger : theme.text;
            return (
              <Pressable
                key={action.key}
                onPress={action.onPress}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                style={({ pressed }) => [
                  styles.moreRow,
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}>
                <Icon icon={action.icon} size={20} color={tint} />
                <ThemedText style={{ color: tint }}>{action.label}</ThemedText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function ShareTarget({
  conversation,
  currentUserId,
  onPress,
}: {
  conversation: ConversationSummary;
  currentUserId: string | null;
  onPress: () => void;
}) {
  const isGroup = conversation.type === 'GROUP';
  const other = conversation.members.find((member) => member.id !== currentUserId);
  const title = conversationTitle(conversation, currentUserId ?? '');
  const avatarUri = isGroup ? conversation.avatarUrl : (other?.avatarUrl ?? null);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${fr.social.sendToLabel} ${title}`}
      style={({ pressed }) => [styles.target, pressed && { opacity: 0.7 }]}>
      <Avatar
        name={title}
        uri={avatarUri}
        size={52}
        gender={isGroup ? null : (other?.gender ?? null)}
        variant={isGroup ? 'group' : 'user'}
        shape="rounded"
        emoji={isGroup ? conversation.emoji : null}
        color={isGroup ? conversation.color : null}
      />
      <ThemedText type="micro" numberOfLines={1} style={styles.name}>
        {title}
      </ThemedText>
    </Pressable>
  );
}

/** Action terminale de la rangée (« Copier le lien », « Partager… »). */
function ShareActionTarget({
  icon,
  label,
  onPress,
  danger = false,
}: {
  icon: typeof Link2;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const theme = useTheme();
  const tint = danger ? theme.danger : theme.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.target, pressed && { opacity: 0.7 }]}>
      <View
        style={[
          styles.actionCircle,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        <Icon icon={icon} size={22} color={tint} />
      </View>
      <ThemedText type="micro" numberOfLines={1} style={[styles.name, { color: tint }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingRight: Spacing.three,
  },
  target: {
    alignItems: 'center',
    gap: Spacing.one,
    width: 64,
  },
  actionCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    textAlign: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginTop: Spacing.two,
  },
  more: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.two,
    marginHorizontal: -Spacing.three,
    paddingTop: Spacing.one,
  },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
  },
});
