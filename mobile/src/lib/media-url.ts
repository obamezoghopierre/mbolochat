import { API_URL } from './config';

/**
 * Rend absolue une URL de média renvoyée par l'API.
 *
 * L'API renvoie des chemins signés relatifs (`/media?f=…&s=…`) : c'est la même
 * origine que l'API, pas celle de l'application. `<Image>` et `<Video>` de React
 * Native exigent une URL absolue, donc un chemin relatif échoue silencieusement
 * (post affiché, média vide).
 *
 * Une URL déjà absolue (CDN, Giphy) est renvoyée telle quelle.
 */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  // `//` ou `scheme://` : distante, on ne la touche pas.
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url)) {
    return url;
  }
  if (url.startsWith('/')) {
    return `${API_URL}${url}`;
  }
  return `${API_URL}/${url}`;
}
