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
