/**
 * Brouillons du compositeur de publication texte.
 *
 * Instagram conserve plusieurs textes en cours : ici chaque session de
 * composition est un brouillon identifié, le plus récent fait foi à la
 * réouverture. Tout est gardé en mémoire (lecture immédiate) et sur disque
 * via AsyncStorage, chargé à la demande — un build sans le module natif
 * perd simplement les brouillons au redémarrage, il ne casse rien.
 */
import { newClientId } from './client-id';

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
  /** Clé d'alignement : `left`, `center` ou `right`. */
  align?: string;
  /** Clé de `TEXT_COLORS` ; absent = couleur du thème. */
  color?: string;
  /** Taille manuelle en points ; absent = auto-ajustement. */
  textSize?: number;
  /** Lieu facultatif du post (nom saisi ou géocodé). */
  location?: string;
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

const KEY = 'mbolo:text-drafts:v1';
/** Clé de l'ancien brouillon unique : migrée en brouillon de la liste. */
const LEGACY_KEY = 'mbolo:text-draft:v1';
/** Au-delà, un brouillon est considéré abandonné. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Liste bornée : les plus anciens sautent en premier. */
const MAX_DRAFTS = 10;
/** Regroupe les frappes : une écriture disque après une courte pause. */
const WRITE_DELAY_MS = 500;

let storage: Storage | null | undefined;
/** Liste complète en mémoire ; `null` = pas encore chargée depuis le disque. */
let drafts: TextDraft[] | null = null;
/** Brouillon que le compositeur ouvert est en train d'éditer. */
let activeId: string | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

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

/** Charge la liste depuis le disque une fois, en migrant l'ancien format. */
async function ensureLoaded(): Promise<TextDraft[]> {
  if (drafts !== null) {
    return drafts;
  }
  const store = getStorage();
  if (!store) {
    drafts = [];
    return drafts;
  }
  try {
    const raw = await store.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      const list = Array.isArray(parsed) ? parsed : [];
      drafts = sorted(list.map(parseDraft).filter((d): d is TextDraft => d !== null));
    } else {
      // Migration : l'ancien brouillon unique devient un brouillon de la liste.
      const legacy = await store.getItem(LEGACY_KEY);
      const migrated = legacy ? parseDraft(JSON.parse(legacy)) : null;
      drafts = migrated && migrated.pages.length > 0 ? [migrated] : [];
      if (migrated) {
        await store.setItem(KEY, JSON.stringify(drafts)).catch(() => undefined);
        await store.removeItem(LEGACY_KEY).catch(() => undefined);
      }
    }
  } catch {
    drafts = [];
  }
  return drafts;
}

function scheduleWrite(): void {
  if (writeTimer) {
    return;
  }
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const store = getStorage();
    if (!store || drafts === null) {
      return;
    }
    void store.setItem(KEY, JSON.stringify(sorted(drafts))).catch(() => undefined);
  }, WRITE_DELAY_MS);
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
  const store = getStorage();
  if (store) {
    void store.setItem(KEY, JSON.stringify(sorted(drafts ?? []))).catch(() => undefined);
  }
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
    const store = getStorage();
    if (store) {
      void store.setItem(KEY, JSON.stringify(sorted(drafts ?? []))).catch(() => undefined);
    }
  });
}
