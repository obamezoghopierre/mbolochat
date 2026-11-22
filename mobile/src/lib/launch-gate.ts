import * as SplashScreen from 'expo-splash-screen';

/**
 * Écran de lancement natif, gardé jusqu'au premier contenu utile — comme
 * Instagram et TikTok : pas d'écran intermédiaire (logo, « Chargement… »)
 * entre le lancement et le premier post.
 *
 * - `preventAutoHideAsync` est appelé à l'import, avant le premier rendu ;
 * - `markLaunchReady` le cache en fondu dès que l'écran visible est prêt
 *   (premier post affiché, connexion, ou état vide/erreur du fil) ;
 * - un plafond garantit qu'il ne reste jamais bloqué.
 */
const LAUNCH_MAX_MS = 4000;

let hidden = false;

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
try {
  SplashScreen.setOptions({ duration: 220, fade: true });
} catch {
  // Version native sans `setOptions` : le masquage reste instantané.
}

const safety = setTimeout(() => markLaunchReady(), LAUNCH_MAX_MS);

/** L'écran visible est prêt : on retire l'écran de lancement (une seule fois). */
export function markLaunchReady(): void {
  if (hidden) {
    return;
  }
  hidden = true;
  clearTimeout(safety);
  void SplashScreen.hideAsync().catch(() => undefined);
}
