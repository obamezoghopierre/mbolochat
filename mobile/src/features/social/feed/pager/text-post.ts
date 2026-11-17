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
