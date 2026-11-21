/**
 * Brouillons du compositeur de publication texte.
 *
 * Instagram conserve plusieurs textes en cours : ici chaque session de
 * composition est un brouillon identifié, le plus récent fait foi à la
 * réouverture. Tout est gardé en mémoire (lecture immédiate) et sur disque
 * via AsyncStorage, chargé à la demande — un build sans le module natif
 * perd simplement les brouillons au redémarrage, il ne casse rien.
 *
 * Le stockage est cloisonné par compte (`setTextDraftOwner`) : un brouillon
 * saisi par un utilisateur ne réapparaît jamais pour un autre sur un
 * appareil partagé, et `purgeTextDrafts` l'efface à la déconnexion.
 */
import { newClientId } from './client-id';

/** Visibilités acceptées par `POST /publications`. */
export type TextDraftVisibility = 'public' | 'followers' | 'private';

export interface TextDraft {
  /** Identifiant stable : c'est lui que les écritures suivant ciblent. */
  id: string;
  /** Pages saisies, vides comprises : le brouillon doit rendre l'écran tel quel. */
  pages: string[];
  /** Style par page (fond/couleur), aligné sur `pages`. */
  pageStyles?: ({ background?: string; color?: string; font?: string; align?: string; size?: number } | null)[];
  /** Titre facultatif saisi dans le champ dédié. */
  title?: string;
  /** Clé de `FeedTextPost.backgrounds`. */
  background: string;
  /** Clé de `TEXT_FONTS` (`features/social/text-style.ts`). */
  font?: string;
  /** Clé d'alignement : `left`, `center`, `right` ou `justify`. */
  align?: string;
  /** Clé de `TEXT_COLORS` ; absent = couleur du thème. */
  color?: string;
  /** Taille manuelle en points ; absent = auto-ajustement. */
  textSize?: number;
  /** Lieu facultatif du post (nom saisi ou géocodé). */
  location?: string;
  /** Visibilité choisie au moment de la saisie. */
  visibility?: TextDraftVisibility;
  /** Clé d'idempotence conservée : un rejeu après échec ne duplique rien. */
  clientId?: string;
  /** Horodatage de la dernière écriture, pour jeter les brouillons trop vieux. */
  updatedAt: number;
}

/** Contenu modifiable d'un brouillon, hors identité et date. */
export type TextDraftContent = Omit<TextDraft, 'id' | 'updatedAt'>;

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const KEY_PREFIX = 'mbolo:text-drafts:v1';
/** Ancienne clé de la liste globale (avant cloisonnement par compte). */
const LEGACY_LIST_KEY = 'mbolo:text-drafts:v1';
/** Clé de l'ancien brouillon unique : migrée en brouillon de la liste. */
const LEGACY_KEY = 'mbolo:text-draft:v1';
/** Format du brouillon unique de la première itération (une page de styles). */
const REMOTE_KEY_PREFIX = 'mbolochat:text-draft:';
/** Au-delà, un brouillon est considéré abandonné. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Liste bornée : les plus anciens sautent en premier. */
const MAX_DRAFTS = 10;
/** Regroupe les frappes : une écriture disque après une courte pause. */
const WRITE_DELAY_MS = 500;

const VISIBILITIES: readonly TextDraftVisibility[] = ['public', 'followers', 'private'];

let storage: Storage | null | undefined;
/** Compte propriétaire des brouillons chargés ; `null` = clé générique. */
let ownerId: string | null = null;
/** Liste complète en mémoire ; `null` = pas encore chargée depuis le disque. */
let drafts: TextDraft[] | null = null;
/** Brouillon que le compositeur ouvert est en train d'éditer. */
let activeId: string | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

/** Clé de stockage du compte courant (ou générique hors session). */
function storageKey(): string {
  return ownerId ? `${KEY_PREFIX}:${ownerId}` : LEGACY_LIST_KEY;
}

function getStorage(): Storage | null {
  if (storage === undefined) {
    try {
      // Même chargement défensif que `cache.ts` : module natif optionnel.
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

function isFresh(draft: TextDraft): boolean {
  return Date.now() - draft.updatedAt < MAX_AGE_MS;
}

function isVisibility(value: unknown): value is TextDraftVisibility {
  return typeof value === 'string' && (VISIBILITIES as readonly string[]).includes(value);
}

function parseDraft(raw: unknown): TextDraft | null {
  const parsed = raw as Partial<TextDraft>;
  if (!parsed || !Array.isArray(parsed.pages) || typeof parsed.background !== 'string') {
    return null;
  }
  return {
    id: typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : newClientId(),
    pages: parsed.pages.filter((page): page is string => typeof page === 'string'),
    ...(Array.isArray(parsed.pageStyles)
      ? {
          pageStyles: parsed.pageStyles.map((style) => {
            if (!style || typeof style !== 'object') {
              return null;
            }
            const record = style as {
              background?: unknown;
              color?: unknown;
              font?: unknown;
              align?: unknown;
              size?: unknown;
            };
            const clean: {
              background?: string;
              color?: string;
              font?: string;
              align?: string;
              size?: number;
            } = {};
            if (typeof record.background === 'string' && record.background) {
              clean.background = record.background;
            }
            if (typeof record.color === 'string' && record.color) {
              clean.color = record.color;
            }
            if (typeof record.font === 'string' && record.font) {
              clean.font = record.font;
            }
            if (typeof record.align === 'string' && record.align) {
              clean.align = record.align;
            }
            if (typeof record.size === 'number' && Number.isFinite(record.size)) {
              clean.size = record.size;
            }
            return Object.keys(clean).length > 0 ? clean : null;
          }),
        }
      : {}),
    ...(typeof parsed.title === 'string' ? { title: parsed.title } : {}),
    background: parsed.background,
    ...(typeof parsed.font === 'string' ? { font: parsed.font } : {}),
    ...(typeof parsed.align === 'string' ? { align: parsed.align } : {}),
    ...(typeof parsed.color === 'string' ? { color: parsed.color } : {}),
    ...(typeof parsed.textSize === 'number' ? { textSize: parsed.textSize } : {}),
    ...(typeof parsed.location === 'string' ? { location: parsed.location } : {}),
    ...(isVisibility(parsed.visibility) ? { visibility: parsed.visibility } : {}),
    ...(typeof parsed.clientId === 'string' && parsed.clientId.length > 0
      ? { clientId: parsed.clientId }
      : {}),
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
  };
}

/**
 * Convertit le brouillon unique de la première itération (`version: 1`,
 * une seule page de styles, pas de liste) en brouillon de la liste.
 */
function parseLegacySingle(raw: unknown): TextDraft | null {
  const parsed = raw as {
    version?: unknown;
    pages?: unknown;
    background?: unknown;
    visibility?: unknown;
    clientId?: unknown;
    updatedAt?: unknown;
  } | null;
  if (
    !parsed ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.pages) ||
    typeof parsed.background !== 'string'
  ) {
    return null;
  }
  return {
    id: newClientId(),
    pages: parsed.pages.filter((page): page is string => typeof page === 'string'),
    background: parsed.background,
    ...(isVisibility(parsed.visibility) ? { visibility: parsed.visibility } : {}),
    ...(typeof parsed.clientId === 'string' && parsed.clientId.length > 0
      ? { clientId: parsed.clientId }
      : {}),
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
  };
}

/** Liste triée du plus récent au plus ancien, sans les brouillons expirés. */
function sorted(list: TextDraft[]): TextDraft[] {
  return list
    .filter(isFresh)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_DRAFTS);
}

/** Lit une clé brute et la transforme en liste de brouillons. */
async function readList(store: Storage, key: string): Promise<TextDraft[]> {
  try {
    const raw = await store.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed) ? parsed : [];
    return sorted(list.map(parseDraft).filter((d): d is TextDraft => d !== null));
  } catch {
    return [];
  }
}

/**
 * Charge la liste du compte depuis le disque une fois, en migrant les
 * formats antérieurs : brouillon unique (`mbolo:text-draft:v1`), liste
 * globale d'avant le cloisonnement, et brouillon unique par compte de la
 * première itération (`mbolochat:text-draft:<userId>`).
 */
async function ensureLoaded(): Promise<TextDraft[]> {
  if (drafts !== null) {
    return drafts;
  }
  const store = getStorage();
  if (!store) {
    drafts = [];
    return drafts;
  }
  const own = await readList(store, storageKey());
  if (own.length > 0 || (await store.getItem(storageKey())) !== null) {
    drafts = own;
    return drafts;
  }
  const migrated: TextDraft[] = [];
  try {
    // Brouillon unique de la première itération, propre au compte.
    if (ownerId) {
      const remoteRaw = await store.getItem(`${REMOTE_KEY_PREFIX}${ownerId}`);
      if (remoteRaw) {
        const single = parseLegacySingle(JSON.parse(remoteRaw));
        if (single && single.pages.some((page) => page.trim().length > 0)) {
          migrated.push(single);
        }
        await store.removeItem(`${REMOTE_KEY_PREFIX}${ownerId}`).catch(() => undefined);
      }
    }
    // Ancien brouillon unique, puis ancienne liste globale.
    const legacyRaw = await store.getItem(LEGACY_KEY);
    if (legacyRaw) {
      const single = parseDraft(JSON.parse(legacyRaw));
      if (single && single.pages.length > 0) {
        migrated.push(single);
      }
      await store.removeItem(LEGACY_KEY).catch(() => undefined);
    }
    if (ownerId) {
      const globalRaw = await store.getItem(LEGACY_LIST_KEY);
      if (globalRaw) {
        const parsed = JSON.parse(globalRaw) as unknown;
        if (Array.isArray(parsed)) {
          migrated.push(
            ...parsed
              .map(parseDraft)
              .filter((d): d is TextDraft => d !== null && d.pages.length > 0),
          );
        }
        await store.removeItem(LEGACY_LIST_KEY).catch(() => undefined);
      }
    }
  } catch {
    // Migration best-effort : au pire les brouillons restent où ils étaient.
  }
  drafts = sorted(migrated);
  if (drafts.length > 0) {
    void store.setItem(storageKey(), JSON.stringify(drafts)).catch(() => undefined);
  }
  return drafts;
}

function persistNow(): void {
  const store = getStorage();
  if (!store || drafts === null) {
    return;
  }
  void store.setItem(storageKey(), JSON.stringify(sorted(drafts))).catch(() => undefined);
}

function scheduleWrite(): void {
  if (writeTimer) {
    return;
  }
  writeTimer = setTimeout(() => {
    writeTimer = null;
    persistNow();
  }, WRITE_DELAY_MS);
}

/**
 * Désigne le compte propriétaire des brouillons (appelé quand la session
 * change). Change de compte = état mémoire réinitialisé ; une écriture
 * différée en cours est d'abord vidée sous l'ancienne clé pour ne rien
 * perdre ni mélanger.
 */
export function setTextDraftOwner(userId: string | null): void {
  if (userId === ownerId) {
    return;
  }
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
    persistNow();
  }
  ownerId = userId;
  drafts = null;
  activeId = null;
}

/** Brouillon actif en mémoire sans attendre le disque (premier rendu). */
export function currentTextDraft(): TextDraft | null {
  if (drafts === null) {
    return null;
  }
  const active = activeId ? drafts.find((draft) => draft.id === activeId) : null;
  const latest = drafts.length > 0 ? drafts.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b)) : null;
  const current = active ?? latest;
  return current && isFresh(current) ? current : null;
}

/** Relit le brouillon actif ; appelé au montage, une seule fois. */
export async function readTextDraft(): Promise<TextDraft | null> {
  const list = await ensureLoaded();
  const current = currentTextDraft();
  if (current) {
    // Sans brouillon actif explicite, le plus récent devient actif.
    if (activeId === null && list.length > 0) {
      activeId = list[0].id;
    }
    return current;
  }
  return null;
}

/** Tous les brouillons, du plus récent au plus ancien (pour la feuille). */
export async function listTextDrafts(): Promise<TextDraft[]> {
  const list = await ensureLoaded();
  return sorted(list);
}

/**
 * Enregistre le contenu du brouillon actif : mise à jour si un brouillon est
 * en cours d'édition, création sinon. La liste est bornée à `MAX_DRAFTS`.
 */
export function writeTextDraft(content: TextDraftContent): void {
  void ensureLoaded().then((list) => {
    const now = Date.now();
    const existing = activeId ? list.find((draft) => draft.id === activeId) : null;
    const draft: TextDraft = existing
      ? { ...existing, ...content, updatedAt: now }
      : { ...content, id: newClientId(), updatedAt: now };
    if (!existing) {
      activeId = draft.id;
    }
    const next = sorted([draft, ...list.filter((item) => item.id !== draft.id)]);
    drafts = next;
    scheduleWrite();
  });
}

/**
 * Désigne un brouillon existant comme celui que le compositeur édite :
 * les écritures suivantes le mettent à jour au lieu d'en créer un nouveau.
 */
export function activateTextDraft(id: string): void {
  void ensureLoaded().then((list) => {
    if (!list.some((draft) => draft.id === id)) {
      return;
    }
    activeId = id;
    // L'horodatage suit : le brouillon rouvert redevient « le plus récent ».
    drafts = list.map((draft) =>
      draft.id === id ? { ...draft, updatedAt: Date.now() } : draft,
    );
    scheduleWrite();
  });
}

/**
 * « Nouveau brouillon » : le contenu courant reste enregistré sous son
 * identifiant et la prochaine saisie crée un brouillon vierge.
 */
export function startNewTextDraft(): void {
  activeId = null;
}

/** Supprime un brouillon précis (corbeille de la feuille des brouillons). */
export async function deleteTextDraft(id: string): Promise<void> {
  const list = await ensureLoaded();
  drafts = sorted(list.filter((draft) => draft.id !== id));
  if (activeId === id) {
    activeId = drafts.length > 0 ? drafts[0].id : null;
  }
  persistNow();
}

/** Efface le brouillon actif (après publication). */
export function clearTextDraft(): void {
  void ensureLoaded().then((list) => {
    const current = currentTextDraft();
    const remaining = current ? list.filter((draft) => draft.id !== current.id) : list;
    drafts = sorted(remaining);
    activeId = drafts.length > 0 ? drafts[0].id : null;
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    persistNow();
  });
}

/**
 * Efface tous les brouillons stockés d'un compte (déconnexion). La clé est
 * supprimée même si le compte n'est plus le propriétaire courant.
 */
export async function purgeTextDrafts(userId: string): Promise<void> {
  const store = getStorage();
  if (store) {
    await store
      .removeItem(`${KEY_PREFIX}:${userId}`)
      .catch(() => undefined);
    await store.removeItem(`${REMOTE_KEY_PREFIX}${userId}`).catch(() => undefined);
  }
  if (ownerId === userId) {
    drafts = [];
    activeId = null;
  }
}
