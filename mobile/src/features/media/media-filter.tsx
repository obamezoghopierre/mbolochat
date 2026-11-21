import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Catalogue des filtres de publications média. Les clés sont persistées en
 * `publications.media_filter` et validées par le DTO API (`MEDIA_FILTERS`) :
 * toute clé ajoutée ici doit y figurer aussi.
 *
 * Chaque filtre est une suite de calques colorés rendus par-dessus le média
 * (`mixBlendMode`), ce qui donne un rendu « grade » cohérent entre l'aperçu
 * caméra, l'écran de publication et le fil — sans traitement natif.
 */
export type MediaFilterBlend =
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'color'
  | 'saturation'
  | 'luminosity'
  | 'darken'
  | 'lighten';

export interface MediaFilterLayer {
  color: string;
  /** Force du calque, 0–1. */
  opacity: number;
  blend: MediaFilterBlend;
  /**
   * Rendu de repli quand la fusion n'existe pas (Android < 10) : un simple
   * voile de couleur, sans l'effet de mélange.
   */
  fallback?: { color: string; opacity: number };
}

export interface MediaFilter {
  key: string;
  /** Clé i18n du libellé affiché dans le sélecteur. */
  labelKey: string;
  layers: MediaFilterLayer[];
}

/**
 * « Normal » n'est pas persisté : l'absence de `mediaFilter` vaut filtre brut.
 * Il ouvre le sélecteur pour revenir au rendu d'origine.
 */
export const MEDIA_FILTERS: readonly MediaFilter[] = [
  {
    key: 'vivid',
    labelKey: 'social.filterVivid',
    layers: [
      { color: '#FF5A1F', opacity: 0.14, blend: 'overlay' },
      { color: '#1FA8FF', opacity: 0.1, blend: 'screen' },
    ],
  },
  {
    key: 'warm',
    labelKey: 'social.filterWarm',
    layers: [{ color: '#FF9A3C', opacity: 0.22, blend: 'soft-light' }],
  },
  {
    key: 'cool',
    labelKey: 'social.filterCool',
    layers: [{ color: '#3C7BFF', opacity: 0.22, blend: 'soft-light' }],
  },
  {
    key: 'noir',
    labelKey: 'social.filterNoir',
    layers: [
      { color: '#8A8A8A', opacity: 0.55, blend: 'saturation', fallback: { color: '#1E1E24', opacity: 0.26 } },
      { color: '#000000', opacity: 0.12, blend: 'multiply' },
    ],
  },
  {
    key: 'retro',
    labelKey: 'social.filterRetro',
    layers: [
      { color: '#FFB36B', opacity: 0.2, blend: 'overlay' },
      { color: '#FFFFFF', opacity: 0.08, blend: 'screen' },
    ],
  },
  {
    key: 'fade',
    labelKey: 'social.filterFade',
    layers: [
      { color: '#FFFFFF', opacity: 0.24, blend: 'screen' },
      { color: '#B9C4D6', opacity: 0.1, blend: 'overlay' },
    ],
  },
  {
    key: 'chrome',
    labelKey: 'social.filterChrome',
    layers: [
      {
        color: '#9A9A9A',
        opacity: 0.7,
        blend: 'color',
        fallback: { color: '#C7D0DA', opacity: 0.2 },
      },
      { color: '#FFFFFF', opacity: 0.1, blend: 'screen' },
    ],
  },
];

const BY_KEY = new Map(MEDIA_FILTERS.map((filter) => [filter.key, filter]));

/**
 * `mixBlendMode` n'existe que sur la New Architecture et **Android 10+**.
 * En dessous, les calques se réduisent à des voiles colorés (voir `fallback`),
 * sinon un `chrome` à 70 % de gris écraserait la photo.
 */
const androidApiLevel =
  Platform.OS === 'android'
    ? typeof Platform.Version === 'number'
      ? Platform.Version
      : Number.parseInt(String(Platform.Version), 10)
    : null;
const BLEND_SUPPORTED = androidApiLevel === null || androidApiLevel >= 29;

export function mediaFilterByKey(key: string | null | undefined): MediaFilter | null {
  return key ? (BY_KEY.get(key) ?? null) : null;
}

/**
 * Calques d'un filtre par-dessus un média ou un aperçu. `pointerEvents="none"`
 * pour ne jamais capter les gestes ; à poser en `absoluteFill` au-dessus du
 * média, sous les éventuels scrims.
 */
export function MediaFilterOverlay({
  filterKey,
  style,
}: {
  filterKey: string | null | undefined;
  style?: StyleProp<ViewStyle>;
}) {
  const filter = mediaFilterByKey(filterKey);
  if (!filter) {
    return null;
  }
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, style]}>
      {filter.layers.map((layer, index) => (
        <View
          key={index}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: BLEND_SUPPORTED ? layer.color : (layer.fallback?.color ?? layer.color),
            opacity: BLEND_SUPPORTED ? layer.opacity : (layer.fallback?.opacity ?? layer.opacity * 0.6),
            mixBlendMode: BLEND_SUPPORTED ? layer.blend : 'normal',
          }}
        />
      ))}
    </View>
  );
}
