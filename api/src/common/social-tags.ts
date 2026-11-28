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


/**
 * Mots vides français et anglais fréquents : ils ne désignent aucun sujet. Liste
 * volontairement courte et en minuscules sans accent (même normalisation que les
 * hashtags) : on veut éviter les mots les plus banals, pas faire du traitement
 * de langue.
 */
const STOP_WORDS: ReadonlySet<string> = new Set(
  (
    'a ai aie ainsi alors au aucun aussi autre aux avec avoir bon car ce cela ces ceux chaque ci comme comment ' +
    'dans de des du donc dont elle elles en encore es est et etre eu fait faire fois il ils je la le les leur ' +
    'lui ma mais me meme mes moi mon ne ni non nos notre nous on ou par pas pour pourquoi qu que quel quelle ' +
    'qui sa sans se ses si son sont sur ta te tes toi ton tous tout tres tu un une vos votre vous y ' +
    'the and for are but not you all any can had her was one our out has have this that with from they ' +
    'will your what when who how why its it is in on of to a an at be by do he me my no or so up us we'
  ).split(' '),
);

/** Un sujet est un mot d'au moins 4 lettres : en dessous, trop ambigu. */
const MIN_TOPIC_LENGTH = 4;
/** Au plus ce nombre de sujets par publication, pour borner l'écriture. */
export const MAX_TOPICS_PER_PUBLICATION = 8;

const WORD = /[\p{L}][\p{L}\p{N}]*/gu;

function normalizeWord(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Sujets implicites d'un texte : mots porteurs de sens, sans doublon, du plus
 * fréquent au moins fréquent (à égalité : ordre d'apparition).
 *
 * Les hashtags (`#mbolo`), les mentions (`@kim`) et les liens sont ignorés : ils
 * ont leur propre traitement, et un pseudo n'est pas un sujet. Les nombres purs
 * sont ignorés aussi.
 */
export function extractTopics(
  text: string,
  limit: number = MAX_TOPICS_PER_PUBLICATION,
): string[] {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/(?<![\p{L}\p{N}_])[#@][\p{L}\p{N}_.]+/gu, ' ');
  const counts = new Map<string, { count: number; first: number }>();
  let position = 0;
  for (const match of cleaned.matchAll(WORD)) {
    const word = normalizeWord(match[0]);
    position += 1;
    if (word.length < MIN_TOPIC_LENGTH || STOP_WORDS.has(word)) {
      continue;
    }
    const known = counts.get(word);
    if (known) {
      known.count += 1;
    } else {
      counts.set(word, { count: 1, first: position });
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first)
    .slice(0, Math.max(0, limit))
    .map(([word]) => word);
}
