/** Découpe un texte social en segments actifs : URLs, mentions et hashtags. */

export type RichSegment =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; username: string; value: string }
  | { kind: 'hashtag'; tag: string; value: string }
  | { kind: 'link'; url: string; value: string };

const TOKEN =
  /(?<![\p{L}\p{N}_.])@([a-z0-9][a-z0-9._]{1,29})(?![a-z0-9._@])|(?<![\p{L}\p{N}_])#([\p{L}\p{N}_]{1,30})/giu;

function normalize(value: string): string {
  return value
    .replace(/\.+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Seules les URLs http(s) sont actives : jamais de schéma arbitraire. */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION = /[.,;:!?，。！？]+$/u;
const MAX_LINK_LABEL = 42;

/** Libellé court d'un lien ; l'URL complète reste dans `url` pour l'ouverture. */
export function displayUrl(url: string): string {
  return url.length > MAX_LINK_LABEL ? `${url.slice(0, MAX_LINK_LABEL - 1)}…` : url;
}

function parseTagsOnly(text: string): RichSegment[] {
  const segments: RichSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, start) });
    }
    if (match[1]) {
      const username = normalize(match[1]);
      segments.push({ kind: 'mention', username, value: `@${match[1]}` });
    } else if (match[2]) {
      const tag = normalize(match[2]);
      segments.push({ kind: 'hashtag', tag, value: `#${match[2]}` });
    }
    cursor = start + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', value: text.slice(cursor) });
  }
  return segments;
}

export function parseSocialText(text: string): RichSegment[] {
  const segments: RichSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push(...parseTagsOnly(text.slice(cursor, start)));
    }
    const url = match[0].replace(TRAILING_PUNCTUATION, '');
    segments.push({ kind: 'link', url, value: displayUrl(url) });
    cursor = start + url.length;
  }
  if (cursor < text.length) {
    segments.push(...parseTagsOnly(text.slice(cursor)));
  }
  return segments;
}
