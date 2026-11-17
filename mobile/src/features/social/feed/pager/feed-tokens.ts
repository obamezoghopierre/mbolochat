import { FeedMetrics, FeedSurface, Type } from '@/constants/theme';

/**
 * Dérivés de tokens propres au feed plein écran.
 *
 * Uniquement des compositions de `FeedSurface` / `FeedMetrics` : aucune valeur
 * nouvelle, pour que la palette du feed tienne en un seul endroit
 * (`mobile/src/constants/theme.ts`).
 */

/** Ombre portée du texte posé sur un média : garantit le contraste sur fond clair. */
export const OnMediaShadow = {
  textShadowColor: 'rgba(0,0,0,0.65)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
} as const;

export const feedText = {
  authorName: { ...Type.body, fontWeight: '700' as const, color: FeedSurface.onMedia },
  caption: { ...Type.body, color: FeedSurface.onMedia },
  captionToggle: {
    ...Type.body,
    fontWeight: '700' as const,
    color: FeedSurface.onMediaFaint,
  },
  sound: { ...Type.caption, color: FeedSurface.onMedia },
  actionLabel: {
    ...Type.sender,
    fontWeight: '600' as const,
    color: FeedSurface.onMedia,
  },
  pill: { ...Type.sender, fontWeight: '600' as const, color: FeedSurface.onMedia },
};

export const feedCircle = {
  size: FeedMetrics.avatar,
} as const;
