import { Linking } from 'react-native';
import type { ReactNode } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';

/** Mot-clé (`#`) ou mention (`@`) : coloré dans un texte, comme sur Instagram. */
const TOKEN_PATTERN = /(#[\wÀ-ɏ]+|@[\wÀ-ɏ]+)|(https?:\/\/[^\s<>"'`]+)/g;

/**
 * Colorie les `#hashtags` et `@mentions` et rend les URLs cliquables dans un
 * texte, sans casser le reste. `tokenStyle` reçoit la teinte dédiée (la carte
 * texte utilise l'accent du feed, le bloc d'infos sur média garde son blanc
 * gras) ; `linkStyle` teinte les liens, qui ouvrent le navigateur.
 */
export function renderTokens(
  text: string,
  tokenStyle: StyleProp<TextStyle>,
  linkStyle?: StyleProp<TextStyle>,
): ReactNode[] {
  return text.split(TOKEN_PATTERN).map((part, index) => {
    if (!part) {
      return null;
    }
    if (part.startsWith('#') || part.startsWith('@')) {
      return (
        <ThemedText key={`${part}-${index}`} style={tokenStyle}>
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
            style={linkStyle}
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
