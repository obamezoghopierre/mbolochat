/**
 * Découpage d'un post texte en titre et contenu.
 *
 * Le modèle de données n'a pas de champ `title` dédié (`publications.caption`
 * seul) : on structure le texte saisi, sans inventer de donnée. La première
 * ligne sert de titre, les suivantes de contenu — c'est la convention la plus
 * naturelle pour un post rédigé comme un titre suivi d'un paragraphe.
 */
export interface TextPostContent {
  title: string;
  body: string | null;
}

export function splitCaption(caption: string | null | undefined): TextPostContent {
  const text = (caption ?? '').trim();
  if (text.length === 0) {
    return { title: '', body: null };
  }

  const newline = text.indexOf('\n');
  if (newline === -1) {
    return { title: text, body: null };
  }

  const title = text.slice(0, newline).trim();
  const body = text.slice(newline + 1).trim();
  if (title.length === 0) {
    return { title: body || text, body: null };
  }
  return { title, body: body.length > 0 ? body : null };
}

/** Titre au-delà duquel la carte propose « Voir plus » (tronqué à l'affichage). */
export const TEXT_POST_TITLE_MAX_CHARS = 160;
/** Corps au-delà duquel la carte est tronquée puis lue dans le lecteur. */
export const TEXT_POST_BODY_MAX_CHARS = 320;
/** Borne de saisie du titre, alignée sur `MAX_TEXT_TITLE_LENGTH` côté API. */
export const TEXT_TITLE_INPUT_MAX_CHARS = 200;

/**
 * « Post court » : une seule page, titre et corps sous les seuils — la carte
 * tient sans lecteur. Le fond coloré choisi à la publication n'est rendu que
 * pour ces posts (comportement Facebook : un texte long reprend le fond
 * normal). `title` = titre dédié saisi dans le compositeur ; `pages` = les
 * pages de corps non vides.
 */
export function isShortTextPost(title: string, pages: readonly string[]): boolean {
  const filled = pages.map((page) => page.trim()).filter((page) => page.length > 0);
  if (filled.length !== 1) {
    return false;
  }
  return (
    title.trim().length <= TEXT_POST_TITLE_MAX_CHARS &&
    filled[0].length <= TEXT_POST_BODY_MAX_CHARS
  );
}
