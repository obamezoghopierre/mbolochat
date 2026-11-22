import type { FeedPost, FeedTab } from '@/lib/types';

/**
 * Fil de la dernière visite, gardé sur l'appareil (par compte et par onglet),
 * comme Instagram et TikTok : au démarrage, l'accueil affiche tout de suite
 * les premiers posts déjà vus, puis le réseau les remplace en arrière-plan.
 *
 * Lecture synchrone après `hydrateFeedSnapshots` (appelé pendant la
 * restauration de session, avant le premier rendu du fil). Module natif
 * AsyncStorage optionnel, chargé comme dans `cache.ts` : sans lui, le fil
 * repart du réseau comme avant.
 */

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface Snapshot {
  items: FeedPost[];
  cursor: string | null;
  savedAt: number;
}

/** Posts gardés par onglet : de quoi remplir l'écran et précharger la suite. */
const SNAPSHOT_SIZE = 8;
/** Au-delà, l'instantané est trop vieux pour être montré (posts supprimés…). */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const PREFIX = 'mbolo:feed:v1:';
const TABS: readonly FeedTab[] = ['for-you', 'following', 'local'];

let storage: Storage | null | undefined;
const memory = new Map<string, Snapshot>();
let ownerId: string | null = null;

function getStorage(): Storage | null {
  if (storage === undefined) {
    try {
      const loader = (globalThis as { require?: (id: string) => unknown }).require;
      const mod = (loader
        ? loader('@react-native-async-storage/async-storage')
        : // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('@react-native-async-storage/async-storage')) as { default?: Storage } & Storage;
      storage = mod.default ?? mod;
    } catch {
      storage = null;
    }
  }
  return storage;
}

function keyFor(userId: string, tab: FeedTab): string {
  return `${PREFIX}${userId}:${tab}`;
}

function parse(raw: string | null): Snapshot | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Snapshot;
    if (!Array.isArray(value?.items) || typeof value.savedAt !== 'number') {
      return null;
    }
    return Date.now() - value.savedAt < MAX_AGE_MS ? value : null;
  } catch {
    return null;
  }
}

/** Charge en mémoire les fils enregistrés du compte (à appeler au démarrage). */
export async function hydrateFeedSnapshots(userId: string): Promise<void> {
  ownerId = userId;
  memory.clear();
  const store = getStorage();
  if (!store) {
    return;
  }
  await Promise.all(
    TABS.map(async (tab) => {
      try {
        const snapshot = parse(await store.getItem(keyFor(userId, tab)));
        if (snapshot && snapshot.items.length > 0) {
          memory.set(tab, snapshot);
        }
      } catch {
        // Lecture impossible : le fil repart du réseau.
      }
    }),
  );
}

/** Fil enregistré de l'onglet pour le compte courant, ou `null`. */
export function readFeedSnapshot(userId: string | null, tab: FeedTab): Snapshot | null {
  if (!userId || userId !== ownerId) {
    return null;
  }
  return memory.get(tab) ?? null;
}

/** Enregistre les premiers posts d'un fil fraîchement chargé. */
export function saveFeedSnapshot(
  userId: string | null,
  tab: FeedTab,
  items: FeedPost[],
  cursor: string | null,
): void {
  if (!userId || items.length === 0) {
    return;
  }
  const snapshot: Snapshot = {
    items: items.slice(0, SNAPSHOT_SIZE),
    // Le curseur ne vaut que pour la page complète : avec un extrait, la
    // pagination repart du réseau après le premier rechargement.
    cursor: items.length <= SNAPSHOT_SIZE ? cursor : null,
    savedAt: Date.now(),
  };
  if (userId === ownerId) {
    memory.set(tab, snapshot);
  }
  const store = getStorage();
  if (store) {
    void store.setItem(keyFor(userId, tab), JSON.stringify(snapshot)).catch(() => undefined);
  }
}

/** Efface les fils enregistrés d'un compte (déconnexion). */
export async function clearFeedSnapshots(userId: string): Promise<void> {
  if (userId === ownerId) {
    memory.clear();
    ownerId = null;
  }
  const store = getStorage();
  if (!store) {
    return;
  }
  await Promise.all(
    TABS.map((tab) => store.removeItem(keyFor(userId, tab)).catch(() => undefined)),
  );
}
