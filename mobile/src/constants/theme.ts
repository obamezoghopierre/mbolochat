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
 * Échelle unique de rayons : des coins nets et sobres.
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
 * Feed plein écran : couleurs indépendantes du thème clair/sombre.
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
  /** Cœur rempli : le jaune de la marque, partout dans le fil. */
  like: '#FFFC00',
  follow: '#FFFC00',
  /** Enregistrement actif : même jaune que le cœur et « Suivre ». */
  save: '#FFFC00',
  /** Republication active : même jaune que le cœur, le suivi et l'enregistrement. */
  reposted: '#FFFC00',
  /** Dégradé bas du média : transparent → noir, pour la lisibilité du texte. */
  gradientBottom: ['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.82)'] as const,
  /** Dégradé haut du média, sous les onglets. */
  gradientTop: ['rgba(0,0,0,0.55)', 'transparent'] as const,
} as const;

/** Mesures du feed plein écran : rail d'actions, avatar, pastille. */
export const FeedMetrics = {
  /** Icônes du rail d'action : taille généreuse (assez grandes pour être tactiles). */
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

/** Mesures des rails de l'écran Découvrir. */
export const DiscoverMetrics = {
  publicationCardWidth: 232,
  publicationMediaHeight: 142,
  accountCardWidth: 188,
  accountAvatar: 48,
  searchHeight: 44,
} as const;

/**
 * Publication texte présentée comme une vidéo : fond dégradé animé façon
 * « text post ». Le feed reste sombre ; ces teintes donnent au post une présence
 * visuelle sans image distante.
 */
export const FeedTextPost = {
  /**
   * Dégradé de fond par défaut, par thème : `dark` = le rendu historique,
   * `light` = pastels doux pour le thème clair (text posts IG).
   */
  backdrop: {
    dark: ['#1B1B24', '#101018', '#07070B'],
    light: ['#E9EAF3', '#D8DAE8', '#C6C9DE'],
  } as const,
  /**
   * Fonds personnalisables du post texte, par clé persistée en
   * `publications.text_background` — mêmes clés que `TEXT_BACKGROUNDS`
   * côté API. Chaque fond a un rendu `dark` et un rendu `light`.
   */
  backgrounds: {
    dark: { dark: ['#1B1B24', '#101018', '#07070B'], light: ['#E9EAF3', '#D8DAE8', '#C6C9DE'] },
    violet: { dark: ['#241059', '#3B1B6E', '#101A3C'], light: ['#E2D4F7', '#CFAEF0', '#B98AE2'] },
    sunset: { dark: ['#3D1230', '#7A2E5C', '#2B1055'], light: ['#F6D3DF', '#F0AEC6', '#E48BAE'] },
    ocean: { dark: ['#0B2545', '#134074', '#081C33'], light: ['#C9DFF6', '#A2C6EC', '#7FA9DC'] },
    forest: { dark: ['#0E2B1F', '#1D5C40', '#0A1F2E'], light: ['#CBE5D4', '#A0D1B0', '#7CB98F'] },
    sand: { dark: ['#3A2A14', '#8A5A24', '#241A3D'], light: ['#F2DFB9', '#E2C58E', '#CBAF6C'] },
    rose: { dark: ['#33101F', '#6E1E3F', '#1E0B26'], light: ['#F7D3DE', '#F0AEC4', '#E08CA8'] },
    mint: { dark: ['#0B2B22', '#1E5C46', '#0A1F2E'], light: ['#C8ECD9', '#9BD9B8', '#74C39B'] },
    sky: { dark: ['#0A2240', '#155A8A', '#081A30'], light: ['#C4E2F8', '#93C8F0', '#63A8DE'] },
    lime: { dark: ['#1E2B0B', '#4C6B1E', '#141F0A'], light: ['#E4F0B9', '#D2E68C', '#B8D465'] },
    peach: { dark: ['#33180E', '#7A3B1E', '#241019'], light: ['#F9DCC3', '#F2BE97', '#E8A06E'] },
    orchid: { dark: ['#241040', '#4E2A78', '#140B26'], light: ['#E4D3F8', '#CBAEEC', '#AC84DC'] },
    coral: { dark: ['#33120E', '#8A3A24', '#241021'], light: ['#F8D9CE', '#F2B49B', '#E08E6E'] },
    aqua: { dark: ['#0A2E33', '#14606B', '#081F2E'], light: ['#C4ECEC', '#93DCDC', '#63C2C4'] },
    butter: { dark: ['#33270B', '#7A5E1E', '#241A0B'], light: ['#F7EDB9', '#F0DC85', '#E2C65E'] },
    lilac: { dark: ['#241040', '#5C3A86', '#160B2B'], light: ['#E7D9F9', '#D3B9F0', '#B795E0'] },
    wine: { dark: ['#2E0B1E', '#6B1E3E', '#1A0B24'], light: ['#F3D3DF', '#E5AEC4', '#CE84A4'] },
    slate: { dark: ['#101820', '#2A3A4C', '#0B1018'], light: ['#D4DEE9', '#B3C2D4', '#93A9C0'] },
    sage: { dark: ['#14251B', '#3D5C42', '#0F1B2E'], light: ['#D9E8D5', '#B9D6B4', '#95C08D'] },
    cocoa: { dark: ['#241610', '#5C3B24', '#170F14'], light: ['#E8D9C8', '#D4B894', '#B89468'] },
    yellow: { dark: ['#4A3408', '#8F6B12', '#2E2006'], light: ['#FFF3B0', '#FFE066', '#F5C518'] },
    gold: { dark: ['#3D2408', '#7A5216', '#241505'], light: ['#F7E7B8', '#EFCF7E', '#D9A94E'] },
    orange: { dark: ['#3D1E08', '#8A4216', '#241004'], light: ['#FFD9B8', '#FFB877', '#F08A3C'] },
    red: { dark: ['#3D0B0B', '#8A1E1E', '#260707'], light: ['#FFD0D0', '#FF9E9E', '#F07070'] },
    magenta: { dark: ['#33082E', '#7A1E6B', '#20071C'], light: ['#F5C8F0', '#EE9FE0', '#D96BC8'] },
    teal: { dark: ['#0B2B2B', '#14605A', '#081F1F'], light: ['#C2ECEA', '#8FD8D4', '#5CC2BE'] },
  } as const satisfies Record<
    string,
    { dark: readonly [string, string, string]; light: readonly [string, string, string] }
  >,
  /** Teinte pleine d'un fond (variante sombre), pour les pastilles du compositeur. */
  backgroundSwatch: (key: string) =>
    FeedTextPost.backgrounds[key as keyof typeof FeedTextPost.backgrounds]?.dark[1] ??
    FeedTextPost.backdrop.dark[1],
  /**
   * Teintes de la carte texte par thème : texte, carte translucide, accent,
   * actions. Le compositeur reste sombre — ces tons ne servent qu'au fil.
   */
  tones: {
    dark: {
      text: '#FFFFFF', textSoft: 'rgba(255,255,255,0.86)', textFaint: 'rgba(255,255,255,0.62)',
      card: 'rgba(10,10,14,0.45)', cardBorder: 'rgba(255,255,255,0.18)', badge: 'rgba(255,255,255,0.16)',
      accent: '#3C87F7', action: '#FFFC00', glass: 'rgba(255,255,255,0.16)', verified: '#5AA9FF',
      follow: '#FFFC00', onFollow: '#000000', surface: '#000000',
    },
    light: {
      text: '#0B0F14', textSoft: '#3D4756', textFaint: '#6B7684', card: 'rgba(255,255,255,0.6)',
      cardBorder: 'rgba(11,15,20,0.10)', badge: 'rgba(11,15,20,0.08)', accent: '#2F6FDB',
      action: '#EAB308', glass: 'rgba(11,15,20,0.07)', verified: '#2563EB', follow: '#FFFC00',
      onFollow: '#000000', surface: '#FFFFFF',
    },
  } as const,
  /** Carte de texte translucide sombre (utilisée par le compositeur, toujours sombre). */
  card: 'rgba(10, 10, 14, 0.45)',
  cardBorder: 'rgba(255, 255, 255, 0.18)',
  /** Vignette de la carte d'aperçu de lien dans le fil. */
  linkThumb: 72,
  /** Fond du bouton retour du lecteur plein écran. */
  badge: 'rgba(255, 255, 255, 0.16)',
} as const;

/** Surfaces sombres translucides de la caméra et de l’éditeur média. */
export const MediaSurface = {
  background: '#080A0D', onSurface: '#FFFFFF', onSurfaceSoft: 'rgba(255,255,255,0.76)',
  overlay: 'rgba(8,10,13,0.52)', glass: 'rgba(255,255,255,0.14)',
  glassStrong: 'rgba(255,255,255,0.22)', border: 'rgba(255,255,255,0.22)', recording: '#FF453A',
} as const;

/**
 * Écran d'appel (1:1 et groupe) : surface bleutée sombre, indépendante du thème
 * clair/sombre de l'application.
 */
export const CallSurface = {
  background: '#1E40AF', onSurface: '#FFFFFF', onSurfaceSoft: 'rgba(255,255,255,0.78)',
  onSurfaceFaint: 'rgba(255,255,255,0.9)', onSurfaceDisabled: 'rgba(255,255,255,0.35)',
  glass: 'rgba(255,255,255,0.16)', glassStrong: 'rgba(255,255,255,0.30)',
  card: 'rgba(0,0,0,0.32)', scrimTop: 'rgba(0,0,0,0.22)', scrimBottom: 'rgba(0,0,0,0.24)',
  toast: 'rgba(0,0,0,0.55)', ring: 'rgba(255,255,255,0.30)', hangup: '#FF3B30',
  accept: '#0BC167', warn: '#FFD166',
} as const;

/** Mesures propres à l'écran d'appel (boutons ronds, avatar, voiles). */
export const CallMetrics = {
  button: 76, buttonSmall: 64, buttonMedium: 68, hangup: 44, cardIcon: 36,
  avatar: 176, avatarSmall: 72, avatarCard: 40, cardHeight: 56,
  scrimTop: 140, scrimBottom: 170, pip: { width: 108, height: 144 }, tileGap: Spacing.three,
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
  opaque: '#121212', transparent: 'rgba(18,18,18,0)', inactive: 'rgba(255,255,255,0.6)',
  active: '#00E5FF', border: 'rgba(255,255,255,0.08)',
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
