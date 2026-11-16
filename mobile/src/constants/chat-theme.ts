import { useThemePreference } from '@/lib/theme-preference';
import { Colors, Spacing } from './theme';

export { CHAT_TIME_GAP_MS } from './chat-timing';

export interface ChatPalette {
  screen: string;
  primaryText: string;
  secondaryText: string;
  border: string;
  mineBubble: string;
  theirBubble: string;
  mineText: string;
  theirText: string;
  composer: string;
  input: string;
  inputPlaceholder: string;
  /** Icônes du compositeur (micro, emoji, +) : gris WeChat, pas du blanc pur. */
  composerIcon: string;
  send: string;
  sendText: string;
  headerText: string;
  headerSubtitle: string;
  dateText: string;
  systemText: string;
  unreadText: string;
  tick: string;
  /** Double coche bleue : message lu (même bleu sur les deux thèmes). */
  tickRead: string;
  error: string;
  voiceBarOff: string;
  voiceBarOn: string;
  /** Traits de la bulle vocale : lisibles sur le vert comme sur une bulle reçue. */
  voiceBubbleText: string;
  voiceBarInactive: string;
  /** Fond des pastilles de la bulle vocale (vitesse), lisible sur les deux thèmes. */
  voiceChipBackground: string;
  quoteBackground: string;
  quoteBackgroundMine: string;
  quoteBar: string;
  quoteBarMine: string;
  quoteText: string;
  quoteName: string;
}

export const ChatColors: { light: ChatPalette; dark: ChatPalette } = {
  light: {
    screen: '#EDEDED',
    primaryText: '#111111',
    secondaryText: '#6B6B6B',
    border: '#D6D6D6',
    mineBubble: '#95EC69',
    theirBubble: '#FFFFFF',
    mineText: '#111111',
    theirText: '#111111',
    composer: '#F7F7F7',
    input: '#FFFFFF',
    inputPlaceholder: '#6B6B6B',
    composerIcon: '#5A5A5A',
    send: Colors.light.accent,
    sendText: '#FFFFFF',
    headerText: '#111111',
    headerSubtitle: '#6B6B6B',
    dateText: '#6B6B6B',
    systemText: '#6B6B6B',
    unreadText: '#6B6B6B',
    tick: '#445B49',
    tickRead: '#53BDEB',
    error: Colors.light.error,
    voiceBarOff: 'rgba(0,0,0,0.22)',
    voiceBarOn: '#111111',
    voiceBubbleText: '#111111',
    voiceBarInactive: 'rgba(17,17,17,0.30)',
    voiceChipBackground: 'rgba(0,0,0,0.10)',
    quoteBackground: 'rgba(0,0,0,0.06)',
    quoteBackgroundMine: 'rgba(0,0,0,0.10)',
    quoteBar: '#07C160',
    quoteBarMine: '#111111',
    quoteText: '#5F6B61',
    quoteName: '#111111',
  },
  dark: {
    screen: Colors.dark.background,
    primaryText: Colors.dark.text,
    secondaryText: Colors.dark.textSecondary,
    border: Colors.dark.border,
    mineBubble: '#2F6B3B',
    theirBubble: Colors.dark.backgroundElevated,
    mineText: '#F5F5F5',
    theirText: Colors.dark.text,
    composer: Colors.dark.backgroundElement,
    input: '#2C2C2E',
    inputPlaceholder: Colors.dark.textSecondary,
    composerIcon: '#C9CCD1',
    send: Colors.dark.accent,
    sendText: '#FFFFFF',
    headerText: Colors.dark.text,
    headerSubtitle: Colors.dark.textSecondary,
    dateText: Colors.dark.textSecondary,
    systemText: Colors.dark.textSecondary,
    unreadText: Colors.dark.textSecondary,
    tick: '#C8D8CC',
    tickRead: '#53BDEB',
    error: Colors.dark.error,
    voiceBarOff: 'rgba(255,255,255,0.25)',
    voiceBarOn: '#F5F5F5',
    voiceBubbleText: '#F5F5F5',
    voiceBarInactive: 'rgba(245,245,245,0.32)',
    voiceChipBackground: 'rgba(255,255,255,0.16)',
    quoteBackground: 'rgba(255,255,255,0.08)',
    quoteBackgroundMine: 'rgba(255,255,255,0.12)',
    quoteBar: '#07C160',
    quoteBarMine: '#F5F5F5',
    quoteText: '#C7C7CC',
    quoteName: Colors.dark.text,
  },
};

/** Métriques partagées des bulles et rangées de conversation. */
export const ChatMetrics = {
  bubblePaddingH: Spacing.threeHalf,
  bubblePaddingV: Spacing.two,
  bubbleRadius: 12,
  bubbleTailSize: 8,
  bubbleTailOffset: -3,
  bubbleTailTop: 11,
  metaGap: 3,
  /** Largeur du fil vertical qui relie les bulles d’une même suite. */
  threadWidth: 2,
  /** Réserve à droite de l’heure pour la pastille de réactions sous une bulle reçue. */
  metaBesideReactions: 46,
  reactionGap: 3,
  reactionChipPaddingH: 6,
  reactionChipMinHeight: 28,
  reactionEmojiSize: 14,
  reactionBottomOffset: -12,
  reactionStackMargin: Spacing.four,
  pinBadgeSize: 18,
  pinBadgeTop: -10,
  stickerMaxWidth: 160,
  emojiMaxWidth: 180,
  mediaRadius: 12,
  /** Une seule ligne : lecture, onde, durée et vitesse, alignées au centre. */
  voiceControlHeight: 30,
  voiceControlWidth: 32,
  voiceControlGap: Spacing.two,
  /** La durée et la vitesse forment un bloc resserré à droite. */
  voiceChipGap: Spacing.one,
  voiceChipHeight: 22,
  voicePlaySize: 28,
  voicePlayIconSize: 18,
  voiceDurationMinWidth: 30,
  voiceBarWidth: 3,
  voiceBarGap: 3,
  voiceBarMinHeight: 3,
  voiceBarMaxHeight: 22,
  /** Bord profond de la journée : le vocal se détache de la bulle précédente. */
  voiceTopMargin: Spacing.threeHalf,
  /** Barre d'enregistrement : une ligne compacte, jamais compressée. */
  composerRecordingHeight: 44,
  composerRecordingWaveHeight: 26,
  composerRecordingDotSize: 8,
  composerBarPaddingH: 6,
  composerBarPaddingV: Spacing.two,
  composerFieldMinHeight: 40,
  composerInputMaxHeight: 120,
  composerButtonSize: 40,
  composerFieldButtonWidth: 32,
  jumpButtonSize: 40,
  listPadding: Spacing.two,
  quoteBarWidth: 4,
  quoteBarMinHeight: 34,
  touchTargetMin: 44,
} as const;

/**
 * Palette de la conversation. Suit la préférence d'apparence de l'app (et non
 * le seul thème système), sinon forcer « sombre » dans les réglages ne
 * changerait pas les couleurs du chat.
 */
export function useChatColors(): ChatPalette {
  const { scheme } = useThemePreference();
  return scheme === 'dark' ? ChatColors.dark : ChatColors.light;
}
