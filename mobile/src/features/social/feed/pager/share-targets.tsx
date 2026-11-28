import { AtSign, Check, Link2, Lock, Mail, MessageCircle as WhatsAppIcon, MessageSquare, QrCode, Send, UserPlus, X as XIcon } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { conversationTitle } from '@/lib/format';
import { fr } from '@/i18n/fr';
import type { ConversationSummary } from '@/lib/types';

export type SocialNetwork = 'whatsapp' | 'telegram' | 'messenger' | 'x' | 'threads' | 'sms' | 'email';

/**
 * Réseaux proposés dans la rangée de partage. Instagram, TikTok, Snapchat et
 * Facebook n'acceptent pas de lien pré-rempli depuis une autre app : ils
 * restent accessibles via « Partager… » (feuille système).
 */
const SOCIAL_NETWORKS: { key: SocialNetwork; label: string; icon: typeof Link2 }[] = [
  { key: 'whatsapp', label: 'WhatsApp', icon: WhatsAppIcon },
  { key: 'telegram', label: 'Telegram', icon: Send },
  { key: 'messenger', label: 'Messenger', icon: WhatsAppIcon },
  { key: 'x', label: 'X', icon: XIcon },
  { key: 'threads', label: 'Threads', icon: AtSign },
  { key: 'sms', label: 'SMS', icon: MessageSquare },
  { key: 'email', label: 'E-mail', icon: Mail },
];

/**
 * Discussions affichées sans recherche, les plus récentes d'abord. Au-delà,
 * la recherche filtre sur toutes les conversations chargées plutôt que de
 * couper silencieusement la liste.
 */
const VISIBLE_TARGETS = 12;

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
  onSendMany,
  onSocial,
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
  /**
   * Envoi groupé, comme Instagram : plusieurs discussions cochées et un
   * message facultatif. Seules les discussions non chiffrées y participent ;
   * une discussion chiffrée s'ouvre (le chiffrement se fait dans le chat).
   */
  onSendMany?: (conversations: ConversationSummary[], message: string) => Promise<void>;
  /** Réseaux externes (WhatsApp, Telegram, X…) : ouvre l'app avec le lien. */
  onSocial?: (network: SocialNetwork) => void;
}) {
  const theme = useTheme();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  // `null` : chargement en cours. Une liste vide après erreur est distinguée
  // de « aucune conversation » pour proposer de réessayer plutôt que de
  // laisser croire qu'il n'y a personne à qui envoyer.
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const toggle = (conversation: ConversationSummary) => {
    // Discussion chiffrée ou envoi groupé indisponible : ouverture directe.
    if (!onSendMany || conversation.e2eeSince) {
      onPick(conversation);
      return;
    }
    setSelected((current) =>
      current.includes(conversation.id)
        ? current.filter((id) => id !== conversation.id)
        : [...current, conversation.id],
    );
  };

  const sendSelected = async () => {
    if (!onSendMany || selected.length === 0 || sending || !conversations) {
      return;
    }
    setSending(true);
    try {
      await onSendMany(
        conversations.filter((conversation) => selected.includes(conversation.id)),
        message.trim(),
      );
      setSelected([]);
      setMessage('');
    } finally {
      setSending(false);
    }
  };

  const loadConversations = useCallback(() => {
    setLoadError(false);
    let active = true;
    api
      .listConversations(token)
      .then((list) => {
        if (active) setConversations(list);
      })
      .catch(() => {
        if (!active) return;
        setConversations([]);
        setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => loadConversations(), [loadConversations]);

  const filtered = useMemo(() => {
    if (!conversations) {
      return null;
    }
    const trimmed = query.trim().toLowerCase();
    const matching = trimmed
      ? conversations.filter((conversation) =>
          conversationTitle(conversation, currentUserId ?? '')
            .toLowerCase()
            .includes(trimmed),
        )
      : conversations;
    // Au-delà de la limite d'affichage, la recherche reste le seul moyen
    // d'atteindre les conversations plus anciennes : elle filtre la liste
    // complète chargée, jamais seulement les 12 déjà visibles.
    return trimmed ? matching : matching.slice(0, VISIBLE_TARGETS);
  }, [conversations, currentUserId, query]);

  const hasActions =
    !!onCopyLink ||
    !!onShare ||
    !!onShareTo ||
    !!onShowQr ||
    !!extraActions?.length ||
    !!moreActions?.length;
  // `conversations === null` : chargement en cours, on ne masque rien encore
  // pour ne pas disparaître puis réapparaître. Une fois chargé, un vrai vide
  // (ni conversation ni erreur) peut masquer la rangée sans autre action.
  if (conversations && conversations.length === 0 && !loadError && !hasActions) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      {loadError ? (
        <View style={styles.loadError}>
          <ThemedText type="caption" themeColor="textSecondary">
            {fr.social.conversationsLoadError}
          </ThemedText>
          <Pressable onPress={loadConversations} accessibilityRole="button" hitSlop={8}>
            <ThemedText type="caption" style={{ color: theme.accent, fontWeight: '600' }}>
              {fr.common.retry}
            </ThemedText>
          </Pressable>
        </View>
      ) : conversations && conversations.length > 0 ? (
        <>
          <View style={styles.sendToHeader}>
            <ThemedText type="caption" themeColor="textSecondary">
              {fr.social.sendToLabel}
            </ThemedText>
            {conversations.length > VISIBLE_TARGETS ? (
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={fr.social.shareFilterPlaceholder}
                placeholderTextColor={theme.textSecondary}
                style={[styles.filterInput, { color: theme.text, backgroundColor: theme.backgroundSelected }]}
                accessibilityLabel={fr.social.shareFilterPlaceholder}
              />
            ) : null}
          </View>
          {/* Rangée scrollable horizontalement, comme les destinataires IG :
              les discussions dépassent la largeur au lieu d'être tronquées. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
            keyboardShouldPersistTaps="handled">
            {(filtered ?? []).length === 0 ? (
              <ThemedText type="caption" themeColor="textSecondary" style={styles.noMatch}>
                {fr.social.shareFilterEmpty}
              </ThemedText>
            ) : (
              (filtered ?? []).map((conversation) => (
                <ShareTarget
                  key={conversation.id}
                  conversation={conversation}
                  currentUserId={currentUserId}
                  selected={selected.includes(conversation.id)}
                  encrypted={Boolean(conversation.e2eeSince)}
                  onPress={() => toggle(conversation)}
                />
              ))
            )}
          </ScrollView>
          {selected.length > 0 ? (
            <View style={styles.sendRow}>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder={fr.social.shareMessagePlaceholder}
                placeholderTextColor={theme.textSecondary}
                maxLength={500}
                style={[
                  styles.messageInput,
                  { color: theme.text, backgroundColor: theme.backgroundSelected },
                ]}
              />
              <Pressable
                onPress={() => void sendSelected()}
                disabled={sending}
                accessibilityRole="button"
                style={[styles.sendButton, { backgroundColor: theme.accent }]}>
                {sending ? (
                  <ActivityIndicator color={theme.onAccent} size="small" />
                ) : (
                  <ThemedText type="small" style={{ color: theme.onAccent, fontWeight: '700' }}>
                    {fr.social.shareSendCount(selected.length)}
                  </ThemedText>
                )}
              </Pressable>
            </View>
          ) : null}
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
          {onSocial
            ? SOCIAL_NETWORKS.map((network) => (
                <ShareActionTarget
                  key={network.key}
                  icon={network.icon}
                  label={network.label}
                  onPress={() => onSocial(network.key)}
                />
              ))
            : null}
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
  selected = false,
  encrypted = false,
  onPress,
}: {
  conversation: ConversationSummary;
  currentUserId: string | null;
  /** Cochée pour l'envoi groupé. */
  selected?: boolean;
  /** Discussion chiffrée : ouverte directement, jamais cochée. */
  encrypted?: boolean;
  onPress: () => void;
}) {
  const isGroup = conversation.type === 'GROUP';
  const other = conversation.members.find((member) => member.id !== currentUserId);
  const title = conversationTitle(conversation, currentUserId ?? '');
  const avatarUri = isGroup ? conversation.avatarUrl : (other?.avatarUrl ?? null);

  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${fr.social.sendToLabel} ${title}`}
      style={({ pressed }) => [styles.target, pressed && { opacity: 0.7 }]}>
      <View>
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
        {selected ? (
          <View style={[styles.checkBadge, { backgroundColor: theme.accent, borderColor: theme.backgroundElement }]}>
            <Icon icon={Check} size={12} color={theme.onAccent} strokeWidth={3} />
          </View>
        ) : encrypted ? (
          <View style={[styles.checkBadge, { backgroundColor: theme.backgroundSelected, borderColor: theme.backgroundElement }]}>
            <Icon icon={Lock} size={10} color={theme.text} />
          </View>
        ) : null}
      </View>
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
  checkBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendToHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  filterInput: {
    flex: 1,
    maxWidth: 160,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    fontSize: 13,
  },
  noMatch: {
    paddingVertical: Spacing.three,
  },
  loadError: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.one,
  },
  sendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  messageInput: {
    flex: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  sendButton: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minWidth: 96,
    alignItems: 'center',
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
