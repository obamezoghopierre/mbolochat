/**
 * Style d'un post texte : catalogue de polices et d'alignements.
 *
 * Les clés sont persistées en `publications.text_font` / `text_align` et
 * validées par le DTO API (`TEXT_FONTS`, `TEXT_ALIGNS`) : toute clé ajoutée
 * ici doit y figurer aussi — la parité des fonds est verrouillée par
 * `tests/textBackgrounds.test.mjs`.
 *
 * Pas de fonte embarquée : les « polices » sont des combinaisons de graisse,
 * d'approche et de famille système, comme le fait Instagram avec ses gammes.
 * Module pur (aucun import natif) pour rester testable sous Vitest.
 */

export type TextFontKey =
  | 'classic'
  | 'modern'
  | 'typewriter'
  | 'bold'
  | 'elegant'
  | 'light'
  | 'black'
  | 'script'
  | 'caps'
  | 'wide';
export type TextAlignKey = 'left' | 'center' | 'right' | 'justify';

export interface TextFontSpec {
  key: TextFontKey;
  /** Clé i18n du libellé affiché dans le sélecteur. */
  labelKey: string;
  /**
   * Famille système par plateforme ; absente = police par défaut.
   * Android connaît les familles génériques (`serif`, `monospace`) ; iOS
   * attend un nom de fonte (`Georgia`, `Courier`).
   */
  fontFamily?: { ios?: string; android?: string; web?: string };
  fontWeight?: '300' | '400' | '500' | '600' | '700' | '800' | '900';
  letterSpacing?: number;
  fontStyle?: 'italic';
  /** Ex. `caps` : le texte est affiché en majuscules (la saisie est conservée). */
  textTransform?: 'uppercase' | 'lowercase' | 'capitalize' | 'none';
  /**
   * Ratio largeur moyenne d'un caractère / taille de police, pour l'estimation
   * de l'auto-ajustement : une cursive ou une mono est plus large qu'une
   * sans-serif fine.
   */
  charRatio?: number;
}

export const TEXT_FONTS: readonly TextFontSpec[] = [
  { key: 'classic', labelKey: 'social.createFontClassic', charRatio: 0.52 },
  {
    key: 'modern',
    labelKey: 'social.createFontModern',
    fontWeight: '600',
    letterSpacing: 0.2,
    charRatio: 0.54,
  },
  {
    key: 'typewriter',
    labelKey: 'social.createFontTypewriter',
    fontFamily: { ios: 'Courier', android: 'monospace' },
    charRatio: 0.6,
  },
  {
    key: 'bold',
    labelKey: 'social.createFontBold',
    fontWeight: '800',
    letterSpacing: 0.3,
    charRatio: 0.56,
  },
  {
    key: 'elegant',
    labelKey: 'social.createFontElegant',
    fontFamily: { ios: 'Georgia', android: 'serif' },
    charRatio: 0.5,
  },
  {
    key: 'light',
    labelKey: 'social.createFontLight',
    fontWeight: '300',
    letterSpacing: 0.4,
    charRatio: 0.48,
  },
  {
    key: 'black',
    labelKey: 'social.createFontBlack',
    fontWeight: '900',
    letterSpacing: 0.2,
    charRatio: 0.58,
  },
  {
    key: 'script',
    labelKey: 'social.createFontScript',
    fontFamily: { ios: 'Snell Roundhand', android: 'serif' },
    fontStyle: 'italic',
    charRatio: 0.55,
  },
  {
    key: 'caps',
    labelKey: 'social.createFontCaps',
    fontWeight: '600',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    charRatio: 0.62,
  },
  {
    key: 'wide',
    labelKey: 'social.createFontWide',
    fontWeight: '500',
    letterSpacing: 1.1,
    charRatio: 0.6,
  },
];

export const TEXT_ALIGNS: readonly { key: TextAlignKey; labelKey: string }[] = [
  { key: 'left', labelKey: 'social.createAlignLeft' },
  { key: 'center', labelKey: 'social.createAlignCenter' },
  { key: 'right', labelKey: 'social.createAlignRight' },
  { key: 'justify', labelKey: 'social.createAlignJustify' },
];

export interface TextColorSpec {
  key: string;
  /** Clé i18n du libellé affiché dans le sélecteur. */
  labelKey: string;
  /** Teinte du texte such qu'affichée dans le fil (contraste = choix de l'auteur). */
  color: string;
}

/**
 * Couleurs de texte d'un post texte, persistées en `publications.text_color`
 * et validées par le DTO API (`TEXT_COLORS`). « Auto » n'est pas persisté :
 * l'absence de `textColor` rend la couleur du thème, comme avant.
 */
export const TEXT_COLORS: readonly TextColorSpec[] = [
  { key: 'white', labelKey: 'social.createColorWhite', color: '#FFFFFF' },
  { key: 'cream', labelKey: 'social.createColorCream', color: '#FFF1C9' },
  { key: 'yellow', labelKey: 'social.createColorYellow', color: '#FFD84D' },
  { key: 'coral', labelKey: 'social.createColorCoral', color: '#FF7A59' },
  { key: 'pink', labelKey: 'social.createColorPink', color: '#FF5CA8' },
  { key: 'blue', labelKey: 'social.createColorBlue', color: '#4DA3FF' },
  { key: 'mint', labelKey: 'social.createColorMint', color: '#4FE0A8' },
  { key: 'violet', labelKey: 'social.createColorViolet', color: '#B18CFF' },
  { key: 'orange', labelKey: 'social.createColorOrange', color: '#FF9E3D' },
  { key: 'red', labelKey: 'social.createColorRed', color: '#FF5A5A' },
  { key: 'green', labelKey: 'social.createColorGreen', color: '#66D17A' },
  { key: 'teal', labelKey: 'social.createColorTeal', color: '#2FD4C4' },
  { key: 'magenta', labelKey: 'social.createColorMagenta', color: '#F95CDB' },
  { key: 'gold', labelKey: 'social.createColorGold', color: '#F0B24A' },
  { key: 'gray', labelKey: 'social.createColorGray', color: '#B8C0CC' },
  { key: 'black', labelKey: 'social.createColorBlack', color: '#0B0F14' },
];

const FONTS_BY_KEY = new Map(TEXT_FONTS.map((font) => [font.key, font]));
const COLORS_BY_KEY = new Map(TEXT_COLORS.map((color) => [color.key, color]));

/** Police par défaut : `classic`, le rendu historique. */
export const DEFAULT_TEXT_FONT: TextFontKey = 'classic';
export const DEFAULT_TEXT_ALIGN: TextAlignKey = 'center';

/** Clé de police reconnue, `null` pour une valeur inconnue ou absente. */
export function textFontByKey(key: string | null | undefined): TextFontSpec | null {
  return key && FONTS_BY_KEY.has(key as TextFontKey)
    ? (FONTS_BY_KEY.get(key as TextFontKey) ?? null)
    : null;
}

/**
 * `fontFamily` résolu pour la plateforme (`Platform.OS`). `web` retombe sur la
 * valeur `web` puis sur rien : le navigateur utilise ses propres polices.
 */
export function textFontFamily(spec: TextFontSpec, os: string): string | undefined {
  if (os === 'ios') {
    return spec.fontFamily?.ios;
  }
  if (os === 'android') {
    return spec.fontFamily?.android;
  }
  return spec.fontFamily?.web;
}

export interface TextFontStyle {
  fontFamily?: string;
  fontWeight?: '300' | '400' | '500' | '600' | '700' | '800' | '900';
  letterSpacing?: number;
  fontStyle?: 'italic';
  textTransform?: 'uppercase' | 'lowercase' | 'capitalize' | 'none';
}

/**
 * Propriétés de texte applicables à un `style` RN pour une police donnée.
 * `os` = `Platform.OS` : la famille système diffère entre iOS et Android.
 */
export function textFontStyle(spec: TextFontSpec | null, os: string): TextFontStyle {
  if (!spec) {
    return {};
  }
  const fontFamily = textFontFamily(spec, os);
  return {
    ...(fontFamily ? { fontFamily } : {}),
    ...(spec.fontWeight ? { fontWeight: spec.fontWeight } : {}),
    ...(spec.letterSpacing !== undefined ? { letterSpacing: spec.letterSpacing } : {}),
    ...(spec.fontStyle ? { fontStyle: spec.fontStyle } : {}),
    ...(spec.textTransform ? { textTransform: spec.textTransform } : {}),
  };
}

/** Clé de couleur reconnue, `null` pour une valeur inconnue ou absente. */
export function textColorByKey(key: string | null | undefined): TextColorSpec | null {
  return key ? (COLORS_BY_KEY.get(key) ?? null) : null;
}

/** `textAlign` RN pour une clé d'alignement (`null`/inconnu = centré). */
export function textAlignValue(key: string | null | undefined): TextAlignKey {
  return key === 'left' || key === 'right' || key === 'justify' ? key : DEFAULT_TEXT_ALIGN;
}
