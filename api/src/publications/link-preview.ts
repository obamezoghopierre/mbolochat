import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Aperçu de lien pour les publications texte : le serveur extrait la
 * première URL du texte, récupère les métadonnées Open Graph et les
 * stocke avec la publication — les lecteurs ne contactent jamais
 * directement les sites liés.
 *
 * Garde-fous SSRF : http/https uniquement, hôtes privés/localhost
 * refusés après résolution DNS, corps de page borné, délai court.
 */

export interface LinkPreviewMeta {
  url: string;
  host: string;
  title: string;
  description: string;
  imageUrl: string | null;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/i;
const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 512 * 1024;
const TITLE_MAX = 90;
const DESCRIPTION_MAX = 180;
/** Cache en mémoire : une retouche ou un rejeu ne refetch pas. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: LinkPreviewMeta | null }>();

function cleanTrailingPunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/u, '');
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Première URL http/https d'un texte, ponctuation finale exclue. */
export function firstHttpUrl(text: string): string | null {
  const match = URL_PATTERN.exec(text);
  if (!match) {
    return null;
  }
  const candidate = cleanTrailingPunctuation(match[0]);
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' || !parsed.hostname) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escaped}["']`, 'i'),
      new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escaped}["']`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(html);
      if (match?.[1]) {
        return decodeEntities(match[1]).trim();
      }
    }
  }
  return null;
}

function titleFromHtml(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match?.[1]) {
    return null;
  }
  const clean = decodeEntities(match[1]).replace(/\s+/g, ' ').trim();
  return clean.length > 0 ? clean : null;
}

/** Parse les métadonnées OG d'une page HTML déjà récupérée. */
export function parseLinkPreview(html: string, rawUrl: string): LinkPreviewMeta | null {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./i, '');
    const title =
      truncate(metaContent(html, ['og:title', 'twitter:title']) ?? '', TITLE_MAX) ||
      truncate(titleFromHtml(html) ?? '', TITLE_MAX) ||
      host;
    const description = truncate(
      metaContent(html, [
        'og:description',
        'twitter:description',
        'description',
      ]) ?? '',
      DESCRIPTION_MAX,
    );
    const rawImage = metaContent(html, [
      'og:image',
      'og:image:url',
      'og:image:secure_url',
      'twitter:image',
      'twitter:image:src',
    ]);
    let imageUrl: string | null = null;
    if (rawImage) {
      try {
        imageUrl = new URL(rawImage, url.origin).toString();
      } catch {
        imageUrl = null;
      }
    }
    return {
      url: url.toString(),
      host,
      title,
      description,
      imageUrl: imageUrl && imageUrl.startsWith('https:') ? imageUrl : null,
    };
  } catch {
    return null;
  }
}

/** Vrai si l'adresse IP est une cible privée/locale à ne jamais joindre. */
function isPrivateAddress(address: string): boolean {
  if (address === '::1' || address === '::') {
    return true;
  }
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }
  const lower = address.toLowerCase();
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

/**
 * Résout l'hôte et refuse les cibles internes : empêche un post de faire
 * servir de relais vers le réseau local ou les métadonnées cloud.
 */
async function assertPublicHost(hostname: string): Promise<boolean> {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare)) {
    return !isPrivateAddress(bare);
  }
  if (
    bare === 'localhost' ||
    bare.endsWith('.localhost') ||
    bare.endsWith('.local') ||
    bare.endsWith('.internal')
  ) {
    return false;
  }
  try {
    const addresses = await lookup(bare, { all: true });
    return addresses.length > 0 && addresses.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}

/**
 * Récupère une page en suivant les redirections manuellement : chaque saut
 * est revalidé (protocole + hôte public) pour qu'une redirection vers le
 * réseau interne ne contourne pas le garde SSRF.
 */
async function fetchPublic(url: URL): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop < 3; hop += 1) {
    if (
      (current.protocol !== 'http:' && current.protocol !== 'https:') ||
      !current.hostname ||
      !(await assertPublicHost(current.hostname))
    ) {
      return null;
    }
    const response = await fetch(current.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'user-agent': 'MboloChat/1.0 (+link-preview)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return null;
      }
      try {
        current = new URL(location, current);
      } catch {
        return null;
      }
      continue;
    }
    return response;
  }
  return null;
}

/**
 * Récupère et parse l'aperçu d'une URL. Renvoie `null` sur tout échec :
 * une page inaccessible ne doit jamais bloquer la publication.
 */
export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreviewMeta | null> {
  const cached = cache.get(rawUrl);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }
  let value: LinkPreviewMeta | null = null;
  try {
    const url = new URL(rawUrl);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
      cache.set(rawUrl, { at: Date.now(), value });
      return value;
    }
    const response = await fetchPublic(url);
    if (!response?.ok || !response.body) {
      cache.set(rawUrl, { at: Date.now(), value });
      return value;
    }
    // Corps borné : on lit au plus MAX_HTML_BYTES puis on stoppe.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) {
        break;
      }
      received += chunk.byteLength;
      chunks.push(chunk);
      if (received >= MAX_HTML_BYTES) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    const html = new TextDecoder().decode(
      chunks.length === 1 ? chunks[0] : concatChunks(chunks),
    );
    value = parseLinkPreview(html, response.url || url.toString());
  } catch {
    value = null;
  }
  cache.set(rawUrl, { at: Date.now(), value });
  return value;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Aperçu pour un texte de publication : première URL trouvée dans les
 * pages puis la légende. `null` si aucune URL ou si la page est muette.
 */
export async function previewForText(parts: (string | null | undefined)[]): Promise<LinkPreviewMeta | null> {
  for (const part of parts) {
    if (!part) {
      continue;
    }
    const url = firstHttpUrl(part);
    if (url) {
      return fetchLinkPreview(url);
    }
  }
  return null;
}
