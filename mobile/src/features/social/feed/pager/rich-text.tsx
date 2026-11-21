import { router } from 'expo-router';
import type { ReactNode } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { fr } from '@/i18n/fr';

/** Mot-clé (`#`) ou mention (`@`) : coloré dans un texte, comme sur Instagram. */
const TOKEN_PATTERN = /(#[\w\u00C0-\u024F]+|@[\w\u00C0-\u024F]+)/g;

/** Ouvre la cible d'un token : recherche du hashtag ou profil mentionné. */
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
 * Colorie les `#hashtags` et `@mentions` dans un texte, sans casser le reste.
 * `tokenStyle` reçoit la teinte dédiée (la carte texte utilise l'accent du feed,
 * le bloc d'infos sur média garde son blanc gras).
 *
 * Avec `interactive`, chaque token est cliquable : un hashtag ouvre la
 * recherche Découvrir, une mention ouvre le profil. Un tap sur un token ne
 * déclenche pas le `onPress` de la carte parente (le Text natif capte le
 * geste), donc le lecteur ne s'ouvre pas par erreur.
 */
export function renderTokens(
  text: string,
  tokenStyle: StyleProp<TextStyle>,
  options: { interactive?: boolean } = {},
): ReactNode[] {
  return text.split(TOKEN_PATTERN).map((part, index) =>
    part.startsWith('#') || part.startsWith('@') ? (
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
    ) : (
      part
    ),
  );
}
