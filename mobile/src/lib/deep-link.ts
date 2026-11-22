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

/**
 * Adresse web publique de l'API (`EXPO_PUBLIC_WEB_URL`), sans « / » final.
 * Quand elle est définie, les partages vers l'extérieur utilisent un lien
 * https lisible par tout le monde (aperçu, puis ouverture de l'app).
 */
const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? '').replace(/\/$/, '');

/**
 * Lien à partager hors de l'app (WhatsApp, X, SMS, feuille système…) :
 * `https://…/p/<id>` si l'adresse web est configurée, sinon le lien profond.
 * Les envois dans une discussion MboloChat gardent le lien profond, qui s'y
 * affiche en carte de publication.
 */
export function postShareLink(publicationId: string): string {
  return WEB_URL ? `${WEB_URL}/p/${publicationId}` : postDeepLink(publicationId);
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
