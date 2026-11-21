/**
 * Géométrie du compositeur de publication texte.
 *
 * La carte est un portrait 4:5 comme dans le fil : la police descend d'un cran
 * tant que le texte estimé dépasse la surface utile. C'est le comportement
 * Instagram — le texte s'adapte à la carte, jamais l'inverse — et cela évite
 * une carte qui grandit sans fin quand on écrit beaucoup.
 *
 * Fonctions pures, testées dans `text-card.test.ts` : aucun import natif.
 */

/** Ratio largeur / hauteur de la carte (portrait Instagram). */
export const TEXT_CARD_ASPECT = 4 / 5;

/** Marge intérieure de la carte, en points. */
export const TEXT_CARD_PADDING = 20;

/** Bornes de la police auto-ajustée. */
export const TEXT_CARD_FONT = { min: 16, max: 30 } as const;

/** Bornes de la taille manuelle choisie par l'auteur (points). */
export const TEXT_MANUAL_FONT = { min: 16, max: 64, step: 2 } as const;

/** Interligne, relatif à la taille de police. */
export const TEXT_CARD_LINE_RATIO = 1.32;

/** Largeur moyenne d'un caractère, relative à la taille de police. */
export const CHAR_RATIO = 0.52;

export interface TextCardTypography {
  fontSize: number;
  lineHeight: number;
}

/**
 * Lignes estimées pour un texte donné : chaque paragraphe compte au moins une
 * ligne, et les retours à la ligne explicites sont conservés. Le comptage se
 * fait au caractère (remplissage parfait) plutôt qu'au mot : c'est
 * volontairement optimiste — le retour à la ligne réel gaspille de la place
 * en fin de ligne, et surestimer les lignes ferait descendre la police trop
 * vite. Le surplus éventuel défile dans la carte.
 */
export function estimateLines(
  text: string,
  fontSize: number,
  innerWidth: number,
  charRatio = CHAR_RATIO,
): number {
  const perLine = Math.max(1, Math.floor(innerWidth / (fontSize * charRatio)));
  return text
    .split('\n')
    .reduce((total, paragraph) => total + Math.max(1, Math.ceil(paragraph.length / perLine)), 0);
}

/**
 * Taille de police qui fait tenir `text` dans une carte de `cardWidth` de large.
 * Un texte vide ou très court reçoit la taille maximale ; un texte long
 * descend jusqu'au plancher, et déborde alors en défilement dans la carte.
 */
export function autoFitTextSize(
  text: string,
  cardWidth: number,
  charRatio = CHAR_RATIO,
): TextCardTypography {
  const width = Math.max(1, cardWidth);
  const innerWidth = Math.max(1, width - TEXT_CARD_PADDING * 2);
  const innerHeight = Math.max(1, width / TEXT_CARD_ASPECT - TEXT_CARD_PADDING * 2);
  const body = text.trim() || ' ';

  for (let size = TEXT_CARD_FONT.max; size > TEXT_CARD_FONT.min; size -= 1) {
    const lineHeight = size * TEXT_CARD_LINE_RATIO;
    if (estimateLines(body, size, innerWidth, charRatio) * lineHeight <= innerHeight) {
      return { fontSize: size, lineHeight: Math.round(lineHeight) };
    }
  }
  return {
    fontSize: TEXT_CARD_FONT.min,
    lineHeight: Math.round(TEXT_CARD_FONT.min * TEXT_CARD_LINE_RATIO),
  };
}

/**
 * Typographie d'une taille manuelle : la valeur est bornée au catalogue
 * puis déclinée en interligne comme l'auto-ajustement. `null` côté appelant
 * signifie « auto » et ne passe jamais ici.
 */
export function manualTypography(size: number): TextCardTypography {
  const fontSize = Math.min(
    TEXT_MANUAL_FONT.max,
    Math.max(TEXT_MANUAL_FONT.min, Math.round(size)),
  );
  return { fontSize, lineHeight: Math.round(fontSize * TEXT_CARD_LINE_RATIO) };
}

/**
 * Pages réellement publiées : on retire les vides et les espaces de bord, pour
 * qu'une page ajoutée puis abandonnée ne crée pas une carte blanche.
 */
export function cleanPages(pages: readonly string[]): string[] {
  return pages.map((page) => page.trim()).filter((page) => page.length > 0);
}

/** Bornes de la police auto-ajustée dans le fil (posts sans taille manuelle). */
export const FEED_TEXT_FONT = { min: 16, max: 44 } as const;

/** Le titre du fil est ~4/3 du corps, comme le rendu historique (24 / 18). */
const FEED_TITLE_RATIO = 4 / 3;
const FEED_TITLE_LINE_RATIO = 1.3;
const FEED_BODY_LINE_RATIO = 1.5;
/** Plafond du titre : au-delà, le corps garderait une taille illisible. */
const FEED_TITLE_MAX = 56;

export interface FeedPageText {
  title: string;
  body: string | null;
}

export interface FeedTypography {
  titleSize: number;
  titleLineHeight: number;
  bodySize: number;
  bodyLineHeight: number;
}

/**
 * Lignes estimées comme React Native les rend : retour à la ligne aux
 * mots, un mot trop long pour la ligne occupe une ligne à lui seul.
 * Plus fidèle que `estimateLines` (qui remplit au caractère) : sans elle la
 * police du fil est surestimée et le texte « saute » plus de lignes que
 * nécessaire au lieu d'occuper la largeur de la carte.
 */
function estimateWrappedLines(
  text: string,
  fontSize: number,
  innerWidth: number,
  charRatio = CHAR_RATIO,
): number {
  const width = Math.max(1, innerWidth);
  const charWidth = Math.max(1, fontSize * charRatio);
  const spaceWidth = charWidth * 0.35;
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim().length === 0) {
      lines += 1;
      continue;
    }
    lines += 1;
    let lineWidth = 0;
    for (const word of paragraph.split(/\s+/u)) {
      const wordWidth = word.length * charWidth;
      const needed = lineWidth === 0 ? wordWidth : lineWidth + spaceWidth + wordWidth;
      if (lineWidth > 0 && needed > width) {
        lines += 1;
        lineWidth = wordWidth;
      } else {
        lineWidth = needed;
      }
    }
  }
  return lines;
}

/**
 * Taille de police d'un post texte dans le fil, façon Instagram : le texte
 * remplit la carte — court = grand, long = plus petit, plancher 16 pt.
 * `pages` décrit chaque page affichée (titre + corps) ; la taille retenue
 * fait tenir la plus longue. `null` si la surface est inconnue.
 */
export function fitFeedTypography(
  pages: readonly FeedPageText[],
  innerWidth: number,
  innerHeight: number,
  charRatio = CHAR_RATIO,
  maxSize: number = FEED_TEXT_FONT.max,
): FeedTypography | null {
  const width = Math.max(1, innerWidth);
  const height = Math.max(1, innerHeight);
  // Le plafond est la taille manuelle de l'auteur quand elle existe :
  // le corps peut descendre sous elle pour tenir dans la carte, jamais
  // la dépasser. Sans taille manuelle, le plafond est celui de l'auto-fit.
  const top = Math.max(FEED_TEXT_FONT.min, Math.round(maxSize));
  const filled = pages
    .map((page) => ({
      title: page.title.trim() || ' ',
      body: page.body?.trim() || '',
    }))
    .filter((page) => page.title !== ' ' || page.body.length > 0);
  if (filled.length === 0) {
    return null;
  }
  for (let size = top; size >= FEED_TEXT_FONT.min; size -= 1) {
    const titleSize = Math.min(FEED_TITLE_MAX, Math.round(size * FEED_TITLE_RATIO));
    const titleLineHeight = Math.round(titleSize * FEED_TITLE_LINE_RATIO);
    const bodyLineHeight = Math.round(size * FEED_BODY_LINE_RATIO);
    const fits = filled.every((page) => {
      let pixels = 0;
      if (page.title !== ' ') {
        pixels += estimateWrappedLines(page.title, titleSize, width, charRatio) * titleLineHeight;
      }
      if (page.body.length > 0) {
        pixels += estimateWrappedLines(page.body, size, width, charRatio) * bodyLineHeight;
      }
      return pixels <= height;
    });
    if (fits) {
      return {
        titleSize,
        titleLineHeight,
        bodySize: size,
        bodyLineHeight,
      };
    }
  }
  return {
    titleSize: Math.min(FEED_TITLE_MAX, Math.round(FEED_TEXT_FONT.min * FEED_TITLE_RATIO)),
    titleLineHeight: Math.round(
      Math.min(FEED_TITLE_MAX, Math.round(FEED_TEXT_FONT.min * FEED_TITLE_RATIO)) *
        FEED_TITLE_LINE_RATIO,
    ),
    bodySize: FEED_TEXT_FONT.min,
    bodyLineHeight: Math.round(FEED_TEXT_FONT.min * FEED_BODY_LINE_RATIO),
  };
}
