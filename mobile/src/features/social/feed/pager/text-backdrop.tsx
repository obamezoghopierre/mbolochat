import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { FeedTextPost } from '@/constants/theme';
import { useThemePreference } from '@/lib/theme-preference';
import type { FeedPost } from '@/lib/types';

/** Ensemble de palettes (sombre + clair) d'un post texte, défaut = dark. */
export function textPostPaletteSet(backgroundKey: string | null | undefined) {
  return backgroundKey && backgroundKey in FeedTextPost.backgrounds
    ? FeedTextPost.backgrounds[
        backgroundKey as keyof typeof FeedTextPost.backgrounds
      ]
    : FeedTextPost.backdrop;
}

/**
 * Fond dégradé d'une page texte, en SVG (`react-native-svg`, déjà embarqué) :
 * dégradé continu en trois arrêts, une seule vue native au lieu de 20 bandes,
 * sans dépendance ni rebuild natif. À poser dans un conteneur positionné
 * (overflow masqué conseillé).
 */
export function TextPostBackdrop({
  backgroundKey,
}: {
  backgroundKey?: string | null;
}) {
  const { scheme } = useThemePreference();
  const [top, middle, bottom] =
    textPostPaletteSet(backgroundKey)[scheme === 'light' ? 'light' : 'dark'];
  // Identifiant unique par instance : plusieurs cartes du pager sont montées
  // en même temps et un `id` partagé mélangerait leurs dégradés.
  const gradientId = `text-backdrop-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <Svg
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      width="100%"
      height="100%"
      preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={top} />
          <Stop offset="0.5" stopColor={middle} />
          <Stop offset="1" stopColor={bottom} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

/** Fond d'un post du fil : `post.textBackground` (ou `null` = défaut). */
export function FeedTextBackdrop({ post }: { post: FeedPost }) {
  return <TextPostBackdrop backgroundKey={post.textBackground} />;
}
