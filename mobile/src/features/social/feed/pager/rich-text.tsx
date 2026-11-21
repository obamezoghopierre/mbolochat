import { router } from 'expo-router';
import { Linking } from 'react-native';
import type { ReactNode } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { fr } from '@/i18n/fr';

/** Mot-clé (`#`/`@`) ou URL : coloré dans un texte, comme sur Instagram. */
const TOKEN_PATTERN = /(#[\wÀ-ɏ]+|@[\wÀ-ɏ]+)|(https?:\/\/[^\s<>"'`]+)/g;

/** Ouvre la cible d'un token `#`/`@` : recherche du hashtag ou profil mentionné. */
export function openToken(token: string): void {
  const value = token.slice(1);
  if (value.length === 0) {
    return;
  }
  if (token.startsWith('#')) {
    router.push({ pathname: '/discover', params: { q: `#${value}` } });
  } else {
    router.push({ pathname: '/u/[username]', params: { username: value } });
  }
}

/**
 * Colorie les `#hashtags` et `@mentions` et rend les URLs cliquables dans un
 * texte, sans casser le reste. `tokenStyle` reçoit la teinte dédiée (la carte
 * texte utilise l'accent du feed, le bloc d'infos sur média garde son blanc
 * gras) ; `linkStyle` teinte les liens, qui ouvrent le navigateur.
 *
 * Avec `interactive`, chaque hashtag/mention est cliquable : un hashtag ouvre
 * la recherche Découvrir, une mention ouvre le profil. Un tap sur un token ne
 * déclenche pas le `onPress` de la carte parente (le Text natif capte le
 * geste), donc le lecteur ne s'ouvre pas par erreur.
 */
export function renderTokens(
  text: string,
  tokenStyle: StyleProp<TextStyle>,
  options: { interactive?: boolean; linkStyle?: StyleProp<TextStyle> } = {},
): ReactNode[] {
  return text.split(TOKEN_PATTERN).map((part, index) => {
    if (!part) {
      return null;
    }
    if (part.startsWith('#') || part.startsWith('@')) {
      return (
        <ThemedText
          key={`${part}-${index}`}
          style={tokenStyle}
          suppressHighlighting
          {...(options.interactive
            ? {
                onPress: () => openToken(part),
                accessibilityRole: 'link' as const,
                accessibilityLabel: part.startsWith('#')
                  ? fr.social.openHashtagA11y(part.slice(1))
                  : fr.social.openMentionA11y(part.slice(1)),
              }
            : null)}>
          {part}
        </ThemedText>
      );
    }
    if (/^https?:\/\//i.test(part)) {
      const clean = part.replace(/[),.;!?]+$/u, '');
      const tail = part.slice(clean.length);
      return (
        <ThemedText key={`${part}-${index}`}>
          <ThemedText
            style={options.linkStyle}
            onPress={() => void Linking.openURL(clean).catch(() => undefined)}
            accessibilityRole="link">
            {clean}
          </ThemedText>
          {tail}
        </ThemedText>
      );
    }
    return part;
  });
}
