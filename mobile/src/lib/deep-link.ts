/**
 * Liens profonds de l'application.
 *
 * Le schéma vit dans `app.json` (`scheme`) : le dupliquer dans chaque écran
 * faisait diverger les liens partagés dès qu'il changeait. Un seul endroit.
 */
export const APP_SCHEME = 'mbolochat';

/** Lien profond vers une publication (`mbolochat://post/<id>`). */
export function postDeepLink(publicationId: string): string {
  return `${APP_SCHEME}://post/${publicationId}`;
}

const POST_LINK_PATTERN = new RegExp(`^${APP_SCHEME}://post/([^/\\s]+)$`);

/**
 * Identifiant de publication dans un message qui ne contient *que* le lien
 * profond de partage. `null` pour tout autre texte : le lien reste affiché
 * comme du texte brut dans ce cas.
 */
export function postDeepLinkId(text: string): string | null {
  const match = POST_LINK_PATTERN.exec(text.trim());
  return match?.[1] ?? null;
}
