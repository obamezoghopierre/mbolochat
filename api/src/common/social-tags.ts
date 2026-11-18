/**
 * Extraction des tags sociaux dans un texte publié (légende ou commentaire).
 *
 * Les pseudos sont en minuscules et ne contiennent que lettres, chiffres, `.`
 * et `_` (cf. `AuthService.generateUsername`). Les hashtags acceptent aussi les
 * lettres accentuées. Les doublons sont retirés : une mention ne notifie qu'une
 * fois par publication/commentaire, un hashtag ne compte qu'une occurrence.
 */

const MENTION = /(?<![\p{L}\p{N}_.])@([a-z0-9][a-z0-9._]{1,29})(?![a-z0-9._@])/giu;
const HASHTAG = /(?<![\p{L}\p{N}_])#([\p{L}\p{N}_]{1,30})/gu;

function normalize(value: string): string {
  return value.replace(/\.+$/, '').toLowerCase();
}

export function extractMentions(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(MENTION)]
        .map((match) => normalize(match[1]))
        .filter((username) => username.length > 0),
    ),
  ];
}

export function extractHashtags(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(HASHTAG)].map((match) =>
        match[1]
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase(),
      ),
    ),
  ];
}
