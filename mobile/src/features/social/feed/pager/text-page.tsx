import { ChevronDown } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import {
  FeedMetrics,
  FeedSurface,
  FeedTextPost,
  Radii,
  Spacing,
  Type,
} from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { OnMediaShadow } from './feed-tokens';
import { splitCaption } from './text-post';
import { TextPostReader } from './text-post-reader';
import type { FeedPageChrome } from './video-page';
import type { FeedPost } from '@/lib/types';

/**
 * Nombre de bandes du dégradé de fond. `expo-linear-gradient` n'est pas
 * embarqué dans l'APK de développement : comme pour le scrim du pager, on
 * empile des bandes fines — l'œil lit un dégradé continu.
 */
const BACKDROP_BANDS = 20;

/**
 * Au-delà de cette longueur, la carte s'arrête de grandir et propose
 * « Voir plus » : le texte complet s'ouvre alors dans le lecteur plein écran.
 */
const PREVIEW_MAX_CHARS = 320;

/** Espace réservé en haut (barre d'onglets) et en bas (auteur, son, nav). */
const CARD_TOP_RESERVED = 112;
const CARD_BOTTOM_RESERVED = 128;

/** Mélange deux couleurs hexadécimales : sert à construire le dégradé du fond. */
function mixHex(from: string, to: string, ratio: number): string {
  const parse = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const a = parse(from);
  const b = parse(to);
  const channel = (index: number) =>
    Math.round(a[index] + (b[index] - a[index]) * ratio)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** Dégradé en trois arrêts, découpé en bandes régulières. */
function backdropColors(): string[] {
  const [top, middle, bottom] = FeedTextPost.backdrop;
  return Array.from({ length: BACKDROP_BANDS }, (_, index) => {
    const progress = index / (BACKDROP_BANDS - 1);
    return progress < 0.5
      ? mixHex(top, middle, progress * 2)
      : mixHex(middle, bottom, (progress - 0.5) * 2);
  });
}

/**
 * Page d'une publication sans média.
 *
 * Un post texte n'est plus un écran noir avec une ligne centrée : il prend la
 * même présence qu'une vidéo TikTok — fond coloré statique et carte de texte.
 * Le rythme visuel reste identique aux pages vidéo/photo pour que le pager
 * garde sa cohérence.
 */
export function TextPage({ post, chrome }: { post: FeedPost; chrome: FeedPageChrome }) {
  const colors = useMemo(() => backdropColors(), []);
  const [readerOpen, setReaderOpen] = useState(false);

  const { title, body } = splitCaption(post.caption);
  const hasLongBody = body !== null && body.length > PREVIEW_MAX_CHARS;
  const preview = hasLongBody ? `${body.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…` : body;
  const openReader = () => setReaderOpen(true);
  const closeReader = () => setReaderOpen(false);

  return (
    <View style={[styles.page, { height: chrome.height }]}>
      {colors.map((color, index) => (
        <View
          key={`${color}-${index}`}
          style={[
            styles.band,
            {
              backgroundColor: color,
              top: `${(index * 100) / BACKDROP_BANDS}%`,
              height: `${100 / BACKDROP_BANDS + 0.6}%`,
            },
          ]}
        />
      ))}

      <View
        style={[
          styles.card,
          {
            maxHeight: Math.max(160, chrome.height - CARD_TOP_RESERVED - CARD_BOTTOM_RESERVED),
          },
        ]}>
        <ThemedText style={styles.title}>{title}</ThemedText>

        {preview ? (
          <>
            <View style={styles.divider} />
            <ThemedText style={styles.body} numberOfLines={hasLongBody ? 8 : undefined}>
              {preview}
            </ThemedText>
          </>
        ) : null}

        {hasLongBody ? (
          <Pressable
            onPress={openReader}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={fr.social.seeFullPost}
            style={({ pressed }) => [styles.more, pressed && styles.morePressed]}>
            <ThemedText style={styles.moreText}>{fr.social.seeFullPost}</ThemedText>
            <Icon icon={ChevronDown} size={14} color={FeedSurface.accent} />
          </Pressable>
        ) : null}
      </View>

      <TextPostReader
        visible={readerOpen}
        title={title}
        body={body ?? ''}
        onClose={closeReader}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    // Marges minimales : la carte occupe le plus de largeur possible.
    paddingHorizontal: Spacing.one,
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  card: {
    // La carte occupe toute la largeur disponible à GAUCHE du rail d'actions :
    // `alignSelf: stretch` + la marge réservée évitent tout chevauchement,
    // tout en gardant la carte aussi large que possible.
    alignSelf: 'stretch',
    marginRight: FeedMetrics.railWidth - Spacing.two,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: FeedTextPost.cardBorder,
    backgroundColor: FeedTextPost.card,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.two,
  },
  title: {
    ...Type.sectionTitle,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    color: FeedSurface.onMedia,
    textAlign: 'left',
    ...OnMediaShadow,
  },
  divider: {
    height: 1,
    backgroundColor: FeedSurface.onMediaFaint,
    opacity: 0.35,
  },
  body: {
    ...Type.body,
    lineHeight: 22,
    color: FeedSurface.onMediaSoft,
    textAlign: 'left',
  },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.half,
    paddingVertical: Spacing.half,
  },
  morePressed: {
    opacity: 0.7,
  },
  moreText: {
    ...Type.caption,
    fontWeight: '700',
    color: FeedSurface.accent,
  },
});
