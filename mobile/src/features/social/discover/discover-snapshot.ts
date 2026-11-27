import type { DiscoverSectionPage } from './discover-api';

/**
 * Première page de la grille Découvrir gardée sur l'appareil (par compte),
 * comme le fil (`feed-snapshot.ts`) : à l'ouverture de l'onglet, les vignettes
 * déjà vues s'affichent tout de suite, puis le réseau les remplace derrière.
 *
 * La grille est plus volatile que le fil (classement par `hot_score`, retours
 * négatifs) : l'instantané expire plus vite.
 *
 * Lecture synchrone après `hydrateDiscoverSnapshot` (appelé pendant la
 * restauration de session). Module natif AsyncStorage optionnel, chargé comme
 * dans `feed-snapshot.ts` : sans lui, la grille repart du réseau.
 */

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface Snapshot {
  page: DiscoverSectionPage;
  savedAt: number;
}

/** Au-delà, la page est trop vieille pour être montrée telle quelle. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PREFIX = 'mbolo:discover:v2:';

let storage: Storage | null | undefined;
let memory: Snapshot | null = null;
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

function keyFor(userId: string): string {
  return `${PREFIX}${userId}`;
}

function parseValue(raw: string | null): Snapshot | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Snapshot;
    if (
      !Number.isFinite(value?.savedAt) ||
      !Array.isArray(value?.page?.items)
    ) {
      return null;
    }
    const nextCursor =
      typeof value.page.nextCursor === 'string' ? value.page.nextCursor : null;
    return Date.now() - value.savedAt < MAX_AGE_MS
      ? { page: { items: value.page.items, nextCursor }, savedAt: value.savedAt }
      : null;
  } catch {
    return null;
  }
}

/** Charge en mémoire la grille enregistrée du compte (appelée au démarrage). */
export async function hydrateDiscoverSnapshot(userId: string): Promise<void> {
  ownerId = userId;
  memory = null;
  const store = getStorage();
  if (!store) {
    return;
  }
  try {
    const snapshot = parseValue(await store.getItem(keyFor(userId)));
    if (snapshot) {
      memory = snapshot;
    }
  } catch {
    // Lecture impossible : la grille repart du réseau.
  }
}

/** Grille enregistrée pour le compte courant, ou `null`. */
export function readDiscoverSnapshot(
  userId: string | null,
): DiscoverSectionPage | null {
  if (!userId || userId !== ownerId) {
    return null;
  }
  return memory?.page ?? null;
}

/** Enregistre la première page fraîchement chargée. */
export function saveDiscoverSnapshot(
  userId: string | null,
  page: DiscoverSectionPage,
): void {
  if (!userId) {
    return;
  }
  if (page.items.length === 0) {
    if (userId === ownerId) {
      memory = null;
    }
    const store = getStorage();
    if (store) {
      void store.removeItem(keyFor(userId)).catch(() => undefined);
    }
    return;
  }
  const snapshot: Snapshot = { page, savedAt: Date.now() };
  if (userId === ownerId) {
    memory = snapshot;
  }
  const store = getStorage();
  if (store) {
    void store.setItem(keyFor(userId), JSON.stringify(snapshot)).catch(() => undefined);
  }
}

/** Efface la grille enregistrée d'un compte (déconnexion). */
export async function clearDiscoverSnapshot(userId: string): Promise<void> {
  if (userId === ownerId) {
    memory = null;
    ownerId = null;
  }
  const store = getStorage();
  if (!store) {
    return;
  }
  await store.removeItem(keyFor(userId)).catch(() => undefined);
}
