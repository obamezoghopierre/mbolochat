import { StyleSheet, View } from 'react-native';

/**
 * Dégradé de lisibilité en bas de la vidéo.
 *
 * Construit en bandes empilées plutôt qu'avec `expo-linear-gradient` : ce module
 * est natif, et l'APK de développement installé ne l'embarque pas
 * (`Can't find ViewManager 'ViewManagerAdapter_ExpoLinearGradient'`). Des bandes
 * fines produisent un dégradé continu à l'œil, sans dépendance native.
 *
 * L'opacité suit une progression quadratique : quasi nulle en haut, elle
 * n'atteint ~55 % qu'au tout dernier pixel, donc la vidéo reste claire.
 *
 * Il vit dans la page vidéo, SOUS la barre de progression : posé par-dessus, il
 * assombrissait le trait, son curseur et son minuteur.
 */
const SCRIM_BANDS = 24;
/** Hauteur du dégradé au-dessus de la ligne de progression. */
const SCRIM_HEIGHT = 220;
const SCRIM_MAX_OPACITY = 0.55;

const SCRIM_COLORS = Array.from(
  { length: SCRIM_BANDS },
  (_, index) => `rgba(0,0,0,${(((index + 1) / SCRIM_BANDS) ** 2 * SCRIM_MAX_OPACITY).toFixed(4)})`,
);

export function OverlayScrim({ inset = 0 }: { inset?: number }) {
  return (
    <View pointerEvents="none" style={[styles.container, { height: SCRIM_HEIGHT + inset }]}>
      {SCRIM_COLORS.map((color) => (
        <View key={color} style={[styles.band, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  band: {
    flex: 1,
  },
});
