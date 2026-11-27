/**
 * Historique des recherches récentes de la page Découvrir, comme
 * Instagram : il apparaît quand le champ est focus et vide, et les
 * suggestions filtrent cet historique pendant la saisie.
 *
 * Stocké par compte (AsyncStorage), avec les mêmes gardes que
 * l'instantané de la grille : module natif optionnel, mémoire en
 * cache, clés par compte.
 */

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Maximum d'entrées conservées (les plus récentes). */
export const MAX_HISTORY = 10;

const PREFIX = 'mbolo:discover:search:v1:';

function keyFor(userId: string): string {
  return `${PREFIX}${userId}`;
}

/**
 * Met une entrée au début de la liste, sans doublon, et borne la taille.
 *
 * L'ordre « le plus récent d'abord » est celui d'Instagram : une recherche
 * répétée remonte en tête au lieu de s'ajouter.
 */
export function dedupeRecent(entries: string[], query: string): string[] {
  const normalized = query.trim();
  if (normalized === '') {
    return entries;
  }
  const filtered = entries.filter(
    (entry) => entry.trim().toLowerCase() !== normalized.toLowerCase(),
  );
  return [normalized, ...filtered].slice(0, MAX_HISTORY);
}

/**
 * Suggestions pendant la saisie : les recherches récentes qui contiennent
 * la requête courante, les plus récentes d'abord.
 */
export function filterSuggestions(entries: string[], query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') {
    return [];
  }
  return entries.filter((entry) => entry.toLowerCase().includes(normalized));
}

let storage: Storage | null | undefined;
let memory: string[] | null = null;
let ownerId: string | null = null;

function getStorage(): Storage | null {
  if (storage === undefined) {
    try {
      const loader = (globalThis as { require?: (id: string) => unknown }).require;
      const mod = (loader
        ? loader('@react-native-async-storage/async-storage')
        : null) as { default?: Storage } | Storage | null;
      storage = mod
        ? ((mod as { default?: Storage }).default ?? (mod as Storage))
        : null;
    } catch {
      storage = null;
    }
  }
  return storage;
}

function parseEntries(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim() !== '',
    );
  } catch {
    return [];
  }
}

/** Charge l'historique du compte en mémoire (appelé au démarrage). */
export async function hydrateSearchHistory(userId: string): Promise<void> {
  ownerId = userId;
  memory = null;
  const store = getStorage();
  if (!store) {
    return;
  }
  try {
    memory = parseEntries(await store.getItem(keyFor(userId)));
  } catch {
    // Lecture impossible : l'historique repart de zéro.
  }
}

/** Historique du compte courant, ou une liste vide. */
export function readSearchHistory(userId: string | null): string[] {
  if (!userId || userId !== ownerId) {
    return [];
  }
  return memory ?? [];
}

/** Ajoute une recherche à l'historique (sans doublon, taille bornée). */
export function saveSearchHistory(
  userId: string | null,
  query: string,
): string[] {
  const normalized = query.trim();
  if (!userId || normalized === '') {
    return readSearchHistory(userId);
  }
  const next = dedupeRecent(readSearchHistory(userId), normalized);
  if (userId === ownerId) {
    memory = next;
  }
  const store = getStorage();
  if (store) {
    void store.setItem(keyFor(userId), JSON.stringify(next)).catch(() => undefined);
  }
  return next;
}

/** Retire une entrée de l'historique. */
export function removeSearchHistory(
  userId: string | null,
  query: string,
): string[] {
  if (!userId) {
    return [];
  }
  const next = readSearchHistory(userId).filter(
    (entry) => entry !== query,
  );
  if (userId === ownerId) {
    memory = next;
  }
  const store = getStorage();
  if (store) {
    void store.setItem(keyFor(userId), JSON.stringify(next)).catch(() => undefined);
  }
  return next;
}

/** Efface l'historique entier (déconnexion, « effacer tout »). */
export function clearSearchHistory(userId: string | null): string[] {
  if (userId === ownerId) {
    memory = [];
  }
  const store = getStorage();
  if (userId && store) {
    void store.removeItem(keyFor(userId)).catch(() => undefined);
  }
  return [];
}

/** Efface l'historique du compte (déconnexion). */
export async function clearSearchHistoryFor(userId: string): Promise<void> {
  if (userId === ownerId) {
    memory = [];
    ownerId = null;
  }
  const store = getStorage();
  if (!store) {
    return;
  }
  await store.removeItem(keyFor(userId)).catch(() => undefined);
}
