import { Linking, Platform } from 'react-native';

import type { SocialNetwork } from '@/features/social/feed/pager/share-targets';

/**
 * Ouvre un réseau externe avec le texte de partage pré-rempli. L'app native
 * est tentée d'abord ; à défaut, la page web de partage du réseau (qui
 * renvoie elle-même vers l'app si elle est installée). SMS et e-mail
 * utilisent les apps système. Renvoie `false` si rien n'a pu s'ouvrir.
 */
export async function shareToNetwork(network: SocialNetwork, text: string): Promise<boolean> {
  const t = encodeURIComponent(text);
  const candidates: Record<SocialNetwork, string[]> = {
    whatsapp: [`whatsapp://send?text=${t}`, `https://wa.me/?text=${t}`],
    telegram: [`tg://msg?text=${t}`, `https://t.me/share/url?url=${t}`],
    messenger: [`fb-messenger://share?link=${t}`],
    x: [`twitter://post?message=${t}`, `https://x.com/intent/post?text=${t}`],
    threads: [`barcelona://create?text=${t}`, `https://www.threads.net/intent/post?text=${t}`],
    // iOS attend `&body=`, Android `?body=`.
    sms: [Platform.OS === 'ios' ? `sms:&body=${t}` : `sms:?body=${t}`],
    email: [`mailto:?body=${t}`],
  };
  for (const url of candidates[network]) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // App absente : on essaie la solution suivante.
    }
  }
  return false;
}
