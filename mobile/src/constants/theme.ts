/**
 * Tokens de design MboloChat.
 *
 * Un seul endroit pour les couleurs, l'échelle typographique, les rayons et les
 * durées d'animation. Les écrans ne doivent plus écrire de valeur en dur.
 */

import '@/global.css';

import { Platform, type TextStyle } from 'react-native';

const ACCENT = '#3C87F7';

export const Colors = {
  light: {
    text: '#0B0F14',
    textSecondary: '#5B6672',
    background: '#F5F7FA',
    backgroundElement: '#FFFFFF',
    backgroundElevated: '#FFFFFF',
    backgroundSelected: '#E9EEF5',
    border: '#DFE5EC',
    accent: '#2F6FDB',
    accentSoft: '#E3EDFF',
    onAccent: '#FFFFFF',
    danger: '#D92D20',
    error: '#D92D20',
    buttonGlass: 'rgba(255,255,255,0.38)',
    buttonGlassBorder: 'rgba(11,15,20,0.14)',
    buttonGlassHighlight: 'rgba(255,255,255,0.90)',
  },
  dark: {
    text: '#F2F5F8',
    textSecondary: '#8A97A8',
    background: '#0B0F14',
    backgroundElement: '#121820',
    backgroundElevated: '#1A222D',
    backgroundSelected: '#1F2936',
    border: '#1E2833',
    accent: ACCENT,
    accentSoft: '#13243D',
    onAccent: '#FFFFFF',
    danger: '#FF5A5F',
    error: '#FF5A5F',
    buttonGlass: 'rgba(255,255,255,0.10)',
    buttonGlassBorder: 'rgba(255,255,255,0.20)',
    buttonGlassHighlight: 'rgba(255,255,255,0.26)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Palette élargie : mêmes clés pour les deux thèmes, valeurs libres. */
export type ThemePalette = { readonly [K in ThemeColor]: string };

export type ThemeScheme = keyof typeof Colors;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/** Grille de 4 px. */
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  threeHalf: 12,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Marges latérales d'écran. */
export const Gutter = Spacing.three;

/**
 * Échelle unique de rayons : des coins nets et sobres, façon WhatsApp/Messenger.
 * `button` est le plus sobre (CTA) ; `full` est réservé aux cercles (avatars,
 * pastilles, boutons d'appel).
 */
export const Radii = {
  xs: 4,
  sm: 8,
  button: 8,
  md: 12,
  lg: 16,
  sheet: 16,
  full: 999,
} as const;

/** Échelle typographique unique. */
export const Type = {
  screenTitle: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  sectionTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  message: { fontSize: 16, lineHeight: 21 },
  body: { fontSize: 15, lineHeight: 21 },
  caption: { fontSize: 13, lineHeight: 18 },
  sender: { fontSize: 12, lineHeight: 16 },
  micro: { fontSize: 11, lineHeight: 15 },
  meta: { fontSize: 10, lineHeight: 12 },
} satisfies Record<string, TextStyle>;

/** Durées courtes : jamais d'animation linéaire. */
export const Motion = {
  fast: 150,
  base: 200,
  screen: 300,
  spring: { damping: 22, stiffness: 220, mass: 0.9 },
  /** Seuil de glissement qui ferme une feuille. */
  sheetDismissDistance: 120,
} as const;

/** Voile sombre derrière les feuilles et modales. */
export const Scrim = 'rgba(0, 0, 0, 0.45)';

/** Fond blanc fixe des QR codes : indispensable à la lecture par une caméra. */
export const QrSurface = '#FFFFFF';

/** Bouton : réduction d'échelle à l'appui. */
export const PressScale = 0.97;

/**
 * Surface « verre » (Liquid Glass iOS 26 / Material 3 Expressive Android).
 *
 * `tint` est la teinte de flou système ; `fallback` est la couleur opaque
 * utilisée quand le flou n'est pas disponible (Android sans cible de flou,
 * appareil ancien). Un voile translucide sans flou superposerait le contenu du
 * dessous au texte : on ne le fait jamais.
 */
export const GlassColors = {
  light: {
    tint: 'light',
    fallback: Colors.light.background,
    border: 'rgba(11,15,20,0.08)',
  },
  dark: {
    tint: 'dark',
    fallback: Colors.dark.background,
    border: 'rgba(255,255,255,0.14)',
  },
} as const;

/** Intensité de flou Android, sur l'échelle `expo-blur` (1 à 100). */
export const BlurIntensity = 72;

/**
 * Feed plein écran (façon TikTok) : couleurs indépendantes du thème clair/sombre.
 *
 * Le média occupe tout l'écran ; le texte est toujours blanc, la lisibilité
 * venant du dégradé et des ombres, jamais d'un fond opaque qui masquerait la
 * vidéo. Les rouges d'interaction sont distincts du rouge d'erreur.
 */
export const FeedSurface = {
  background: '#000000',
  /** Liseré des éléments d'identité posés sur le média (avatar de l'auteur). */
  accent: ACCENT,
  onMedia: '#FFFFFF',
  onMediaSoft: 'rgba(255,255,255,0.86)',
  onMediaFaint: 'rgba(255,255,255,0.62)',
  scrimTop: 'rgba(0,0,0,0.38)',
  glass: 'rgba(255,255,255,0.16)',
  glassStrong: 'rgba(255,255,255,0.26)',
  glassPressed: 'rgba(255,255,255,0.32)',
  /** Réaction et abonnement : jaune clair, cohérent sur le média sombre. */
  like: '#FFFC00',
  follow: '#FFFC00',
  /** Enregistrement : même jaune que la réaction et le bouton « Suivre ». */
  save: '#FFFC00',
  /** Republication : même jaune que la réaction, le suivi et l'enregistrement. */
  reposted: '#FFFC00',
  /** Dégradé bas du média : transparent → noir, pour la lisibilité du texte. */
  gradientBottom: ['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.82)'] as const,
  /** Dégradé haut du média, sous les onglets. */
  gradientTop: ['rgba(0,0,0,0.55)', 'transparent'] as const,
} as const;

/** Mesures du feed plein écran : rail d'actions, avatar, pastille. */
export const FeedMetrics = {
  /** Icônes du rail d'action : taille TikTok (assez grandes pour être tactile). */
  actionIcon: 30,
  actionGap: Spacing.threeHalf,
  /** Largeur réservée à droite pour ne pas passer sous le rail. */
  railWidth: 64,
  /** Photo de profil de l'auteur, en carré arrondi. */
  avatar: 42,
  gradientHeight: 280,
  topGradientHeight: 150,
  /** Hauteur de la barre de progression de la vidéo, au repos. */
  progressHeight: 2,
  /** Zone tactile de la barre de progression (plus haute que le trait visible). */
  progressTrackHeight: 24,
  /** Cœur du double-tap. */
  heart: 110,
  /** Pastille du compteur carrousel / son. */
  pill: 26,
} as const;

/**
 * Publication texte présentée comme une vidéo : fond dégradé animé façon
 * « text post » TikTok. Le feed reste sombre quel que soit le thème ; ces
 * teintes vivantes donnent au post une présence visuelle sans image distante.
 */
export const FeedTextPost = {
  /** Dégradé de fond STATIQUE, du haut vers le bas (aucune animation). */
  backdrop: ['#241059', '#3B1B6E', '#101A3C'] as const,
  /** Carte de texte translucide : le fond coloré reste visible par transparence. */
  card: 'rgba(16, 12, 38, 0.42)',
  cardBorder: 'rgba(255, 255, 255, 0.18)',
  /** Fond du bouton retour du lecteur plein écran. */
  badge: 'rgba(255, 255, 255, 0.16)',
} as const;

/** Surfaces sombres translucides de la caméra et de l’éditeur média. */
export const MediaSurface = {
  background: '#080A0D',
  onSurface: '#FFFFFF',
  onSurfaceSoft: 'rgba(255,255,255,0.76)',
  overlay: 'rgba(8,10,13,0.52)',
  glass: 'rgba(255,255,255,0.14)',
  glassStrong: 'rgba(255,255,255,0.22)',
  border: 'rgba(255,255,255,0.22)',
  recording: '#FF453A',
} as const;

/**
 * Écran d'appel (1:1 et groupe) : surface bleutée sombre, indépendante du thème
 * clair/sombre de l'application. Les valeurs n'existent qu'ici.
 */
export const CallSurface = {
  background: '#1E40AF',
  onSurface: '#FFFFFF',
  onSurfaceSoft: 'rgba(255,255,255,0.78)',
  onSurfaceFaint: 'rgba(255,255,255,0.9)',
  onSurfaceDisabled: 'rgba(255,255,255,0.35)',
  glass: 'rgba(255,255,255,0.16)',
  glassStrong: 'rgba(255,255,255,0.30)',
  card: 'rgba(0,0,0,0.32)',
  scrimTop: 'rgba(0,0,0,0.22)',
  scrimBottom: 'rgba(0,0,0,0.24)',
  toast: 'rgba(0,0,0,0.55)',
  ring: 'rgba(255,255,255,0.30)',
  hangup: '#FF3B30',
  accept: '#0BC167',
  warn: '#FFD166',
} as const;

/** Mesures propres à l'écran d'appel (boutons ronds, avatar, voiles). */
export const CallMetrics = {
  button: 76,
  buttonSmall: 64,
  buttonMedium: 68,
  hangup: 44,
  cardIcon: 36,
  avatar: 176,
  avatarSmall: 72,
  avatarCard: 40,
  cardHeight: 56,
  scrimTop: 140,
  scrimBottom: 170,
  pip: { width: 108, height: 144 },
  tileGap: Spacing.three,
} as const;

/** Hauteur utile de la barre d'onglets, hors inset système. */
export const TabBarHeight = 58;

/**
 * Surface de la barre d'onglets.
 *
 * La barre est sombre même en thème clair : elle flotte sur le média du feed et
 * doit rester lisible dans les deux thèmes, avec un contraste constant.
 */
export const TabBarSurface = {
  /** Fond opaque hors du fil. */
  opaque: '#121212',
  /** Fond transparent sur le fil : la vidéo reste visible dessous. */
  transparent: 'rgba(18,18,18,0)',
  /** Onglet inactif : blanc à 60 % sur le fond sombre. */
  inactive: 'rgba(255,255,255,0.6)',
  /** Onglet actif : cyan de la marque. */
  active: '#00E5FF',
  /** Filet supérieur, visible seulement quand la barre est opaque. */
  border: 'rgba(255,255,255,0.08)',
} as const;

/**
 * Ancre basse des contenus plein écran (feed, visionneuses) posés au-dessus de
 * la barre d'onglets.
 *
 * La barre est déjà rendue par le navigateur avec sa propre hauteur : un écran
 * d'onglet ne doit donc réserver que cette hauteur, sans rajouter l'inset
 * système une seconde fois (sinon le contenu flotte au-dessus de la barre).
 */
export const TabBarInset = TabBarHeight;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
