import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { FeedTextPost } from '@/constants/theme';
import { useThemePreference } from '@/lib/theme-preference';
import type { FeedPost } from '@/lib/types';

/**
 * Nombre de bandes du dégradé de fond. `expo-linear-gradient` n'est pas
 * embarqué dans l'APK de développement : comme pour le scrim du pager, on
 * empile des bandes fines — l'œil lit un dégradé continu.
 */
const BACKDROP_BANDS = 20;

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
function backdropColors(palette: readonly [string, string, string]): string[] {
  const [top, middle, bottom] = palette;
  return Array.from({ length: BACKDROP_BANDS }, (_, index) => {
    const progress = index / (BACKDROP_BANDS - 1);
    return progress < 0.5
      ? mixHex(top, middle, progress * 2)
      : mixHex(middle, bottom, (progress - 0.5) * 2);
  });
}

/** Ensemble de palettes (sombre + clair) d'un post texte, défaut = dark. */
export function textPostPaletteSet(backgroundKey: string | null | undefined) {
  return backgroundKey && backgroundKey in FeedTextPost.backgrounds
    ? FeedTextPost.backgrounds[
        backgroundKey as keyof typeof FeedTextPost.backgrounds
      ]
    : FeedTextPost.backdrop;
}

/**
 * Fond dégradé d'une page texte : les bandes sont en `absoluteFill`, à poser
 * dans un conteneur `position: relative` (overflow masqué conseillé).
 */
export function TextPostBackdrop({
  backgroundKey,
}: {
  backgroundKey?: string | null;
}) {
  const { scheme } = useThemePreference();
  const colors = useMemo(
    () =>
      backdropColors(
        textPostPaletteSet(backgroundKey)[scheme === 'light' ? 'light' : 'dark'],
      ),
    [backgroundKey, scheme],
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
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
    </View>
  );
}

/** Fond d'un post du fil : `post.textBackground` (ou `null` = défaut). */
export function FeedTextBackdrop({ post }: { post: FeedPost }) {
  return <TextPostBackdrop backgroundKey={post.textBackground} />;
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
