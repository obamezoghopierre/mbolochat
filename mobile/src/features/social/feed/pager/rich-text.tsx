import type { ReactNode } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';

/** Mot-clé (`#`) ou mention (`@`) : coloré dans un texte, comme sur Instagram. */
const TOKEN_PATTERN = /(#[\w\u00C0-\u024F]+|@[\w\u00C0-\u024F]+)/g;

/**
 * Colorie les `#hashtags` et `@mentions` dans un texte, sans casser le reste.
 * `tokenStyle` reçoit la teinte dédiée (la carte texte utilise l'accent du feed,
 * le bloc d'infos sur média garde son blanc gras).
 */
export function renderTokens(text: string, tokenStyle: StyleProp<TextStyle>): ReactNode[] {
  return text.split(TOKEN_PATTERN).map((part, index) =>
    part.startsWith('#') || part.startsWith('@') ? (
      <ThemedText key={`${part}-${index}`} style={tokenStyle}>
        {part}
      </ThemedText>
    ) : (
      part
    ),
  );
}
