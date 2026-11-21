import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Brouillon du compositeur de publication texte, sauvegardé localement par
 * compte. Il n'y a que du contenu destiné à être publié (pas de message
 * chiffré) : AsyncStorage suffit, mais le brouillon est supprimé à la
 * déconnexion du compte via `clearTextDraft`.
 */
export interface TextDraft {
  version: 1;
  pages: string[];
  background: string;
  visibility: 'public' | 'followers' | 'private';
  /** Clé d'idempotence conservée : un rejeu après échec ne duplique rien. */
  clientId: string;
  updatedAt: number;
}

/** Au-delà, un brouillon oublié est ignoré puis effacé. */
const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const keyFor = (userId: string) => `mbolochat:text-draft:${userId}`;

export async function loadTextDraft(userId: string): Promise<TextDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) {
      return null;
    }
    const draft = JSON.parse(raw) as TextDraft;
    if (
      draft?.version !== 1 ||
      !Array.isArray(draft.pages) ||
      Date.now() - draft.updatedAt > DRAFT_MAX_AGE_MS
    ) {
      await AsyncStorage.removeItem(keyFor(userId));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export async function saveTextDraft(
  userId: string,
  draft: Omit<TextDraft, 'version' | 'updatedAt'>,
): Promise<void> {
  // Un brouillon vide n'a rien à protéger : on l'efface plutôt que de le garder.
  if (draft.pages.every((page) => page.trim().length === 0)) {
    await clearTextDraft(userId);
    return;
  }
  try {
    await AsyncStorage.setItem(
      keyFor(userId),
      JSON.stringify({ ...draft, version: 1, updatedAt: Date.now() } satisfies TextDraft),
    );
  } catch {
    // Stockage plein ou indisponible : le compositeur reste utilisable.
  }
}

export async function clearTextDraft(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // Rien à faire : au pire le brouillon expirera.
  }
}
