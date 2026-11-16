import { fr } from '@/i18n/fr';

/** `__DEV__` n'existe pas sous Vitest : on lit un booléen sûr dans les deux cas. */
const DEV = typeof __DEV__ === 'undefined' ? false : __DEV__;

/**
 * Motif lisible d'un échec d'envoi de média chiffré.
 *
 * `sendEncryptedMedia` signale ses refus locaux par des codes stables
 * (`media_too_large`, `media_unreadable`) ; tout le reste — réseau, socket,
 * chiffrement, serveur — garde le message générique. En développement, ce
 * message générique est complété du motif brut : c'est ce qui permet de
 * rapporter un échec constaté sur un appareil sans avoir à brancher un débogueur.
 */
export function mediaSendErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'media_too_large') return fr.e2eeChat.mediaTooLarge;
  if (code === 'media_unreadable') return fr.e2eeChat.mediaUnreadable;
  const base = fr.e2eeChat.mediaSendFailed;
  return DEV && code ? `${base}\n\n${code}` : base;
}
