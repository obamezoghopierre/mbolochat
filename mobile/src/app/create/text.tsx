import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  AlignJustify,
  ArrowLeft,
  Crosshair,
  Hash,
  MapPin,
  NotebookPen,
  Plus,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import {
  Colors,
  FeedSurface,
  FeedTextPost,
  Gutter,
  Radii,
  Spacing,
  Type,
} from '@/constants/theme';
import { TextPostBackdrop } from '@/features/social/feed/pager/text-backdrop';
import {
  isShortTextPost,
  TEXT_POST_BODY_MAX_CHARS,
  TEXT_TITLE_INPUT_MAX_CHARS,
} from '@/features/social/feed/pager/text-post';
import {
  CHAR_RATIO,
  TEXT_CARD_ASPECT,
  autoFitTextSize,
  manualTypography,
  TEXT_MANUAL_FONT,
  cleanPages,
} from '@/features/social/create/text-card';
import { DraftsSheet } from '@/features/social/create/drafts-sheet';
import { invalidateFeedCache } from '@/features/social/feed/use-feed';
import {
  DEFAULT_TEXT_FONT,
  TEXT_ALIGNS,
  TEXT_COLORS,
  TEXT_FONTS,
  textAlignValue,
  textColorByKey,
  textFontByKey,
  textFontStyle,
  type TextAlignKey,
  type TextFontKey,
} from '@/features/social/text-style';
import { fr } from '@/i18n/fr';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { newClientId } from '@/lib/client-id';
import {
  currentCoordinates,
  getLocationAccess,
  requestLocationAccess,
} from '@/lib/location';
import {
  activateTextDraft,
  clearTextDraft,
  currentTextDraft,
  deleteTextDraft,
  listTextDrafts,
  readTextDraft,
  startNewTextDraft,
  writeTextDraft,
  type TextDraft,
} from '@/lib/text-draft';
import type { SearchHashtag, SearchUser } from '@/lib/types';

/** Bornes alignées sur le DTO (`MAX_TEXT_PAGES`, `MAX_TEXT_PAGE_LENGTH`). */
const MAX_PAGES = 10;
const MAX_PAGE_LENGTH = 2000;
/** Longueur au-delà de laquelle le fil tronque avec « Voir plus ». */
const FEED_PREVIEW_CHARS = 320;
/** Suggestions `@`/`#` : délai de frappe et nombre de résultats affichés. */
const SUGGESTION_DELAY_MS = 300;
const SUGGESTION_LIMIT = 5;

const BACKGROUND_KEYS = Object.keys(
  FeedTextPost.backgrounds,
) as (keyof typeof FeedTextPost.backgrounds)[];

function isBackgroundKey(value: string): value is keyof typeof FeedTextPost.backgrounds {
  return (BACKGROUND_KEYS as readonly string[]).includes(value);
}

function isFontKey(value: string | null | undefined): value is TextFontKey {
  return value != null && textFontByKey(value) !== null;
}

/** Couleur choisie : `auto` = teinte du thème (non persistée). */
type TextColorChoice = 'auto' | string;

function isColorKey(value: string | null | undefined): value is string {
  return value != null && textColorByKey(value) !== null;
}

/** Style propre à une page : fond, couleur, police, alignement, taille. */
interface PageStyle {
  background?: string;
  color?: string;
  font?: string;
  align?: string;
  size?: number;
}

/** Suggestion en cours de saisie : `@` = comptes, `#` = hashtags. */
type Suggestion =
  | { kind: 'user'; user: SearchUser }
  | { kind: 'tag'; tag: SearchHashtag };

/** Dernier jeton `@…`/`#…` en fin de page, comme le fait Instagram. */
interface MentionToken {
  sigil: '@' | '#';
  query: string;
  /** Index du sigil dans le texte : sert à remplacer le jeton tapé. */
  start: number;
}

const MENTION_PATTERN = /(^|\s)([@#])([\p{L}\p{N}_.-]*)$/u;

function trailingMention(text: string): MentionToken | null {
  const match = text.match(MENTION_PATTERN);
  if (!match) {
    return null;
  }
  const query = match[3] ?? '';
  // `#` seul ouvre déjà les suggestions (tendances) ; `@` attend une lettre.
  if (match[2] === '@' && query.length === 0) {
    return null;
  }
  return { sigil: match[2] as '@' | '#', query, start: text.length - query.length - 1 };
}

const ALIGN_ICONS = {
  left: TextAlignStart,
  center: TextAlignCenter,
  right: TextAlignEnd,
  justify: AlignJustify,
} as const;

/**
 * Compositeur de publication texte, calqué sur Instagram : une carte portrait
 * 4:5 plein écran à la fois, texte centré et police auto-ajustée, pages
 * feuilletées au glissement, fond choisi dans une bande de pastilles, puis
 * polices, alignement, mentions `@`/`#` et aperçu avant publication.
 *
 * Ce qui est tapé est ce qui sera lu : la carte reprend le ratio et les fonds
 * du fil, et le brouillon survit à la sortie de l'écran.
 */
export default function CreateTextScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  /** `?id=` présent = mode édition : le contenu du post fait foi, pas le brouillon. */
  const { id: editParam } = useLocalSearchParams<{ id?: string }>();
  const editingId = typeof editParam === 'string' && editParam.length > 0 ? editParam : null;

  const initialDraft = currentTextDraft();
  const [pages, setPages] = useState<string[]>(initialDraft?.pages ?? ['']);
  /**
   * Style par page (fond/couleur), aligné sur `pages`. En multi-cartes,
   * chaque carte est indépendante comme sur Instagram ; en page unique,
   * les champs `background`/`color` restent la source.
   */
  const [pageStyles, setPageStyles] = useState<(PageStyle | null)[]>(
    initialDraft?.pageStyles ?? [],
  );
  const [title, setTitle] = useState(initialDraft?.title ?? '');
  const [background, setBackground] = useState<keyof typeof FeedTextPost.backgrounds>(() =>
    initialDraft && isBackgroundKey(initialDraft.background) ? initialDraft.background : 'dark',
  );
  const [font, setFont] = useState<TextFontKey>(() =>
    isFontKey(initialDraft?.font) ? (initialDraft!.font as TextFontKey) : DEFAULT_TEXT_FONT,
  );
  const [align, setAlign] = useState<TextAlignKey>(() =>
    textAlignValue(initialDraft?.align),
  );
  const [color, setColor] = useState<TextColorChoice>(() =>
    isColorKey(initialDraft?.color) ? initialDraft!.color! : 'auto',
  );
  /** Taille manuelle en points ; `null` = auto-ajustement (défaut IG). */
  const [textSize, setTextSize] = useState<number | null>(() =>
    typeof initialDraft?.textSize === 'number' ? initialDraft.textSize : null,
  );
  /** Lieu facultatif : nom saisi à la main ou détecté par géocodage inverse. */
  const [location, setLocation] = useState(initialDraft?.location ?? '');
  const [locating, setLocating] = useState(false);
  /** Suggestions de villes pendant la saisie du lieu (Nominatim côté serveur). */
  const [placeSuggestions, setPlaceSuggestions] = useState<
    { city: string; country: string | null }[]
  >([]);
  /** Vrai seulement après une saisie manuelle : pas de suggestions au pré-remplissage. */
  const locationEdited = useRef(false);
  const [index, setIndex] = useState(0);
  const [preview, setPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Suggestions `@`/`#` indexées par jeton : ignorées si le jeton a changé. */
  const [suggestions, setSuggestions] = useState<{ key: string; items: Suggestion[] }>({
    key: '',
    items: [],
  });
  /** Zone du pager mesurée : la carte s'y inscrit sans jamais déborder. */
  const [area, setArea] = useState({ width: 0, height: 0 });
  /** Le post à éditer est chargé : l'écran peut afficher le formulaire. */
  const [editLoaded, setEditLoaded] = useState(editingId === null);
  const editLoading = editingId !== null && !editLoaded;
  /** Feuille des brouillons : liste chargée à l'ouverture. */
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [draftList, setDraftList] = useState<TextDraft[]>([]);

  const listRef = useRef<FlatList<string> | null>(null);
  const inputRefs = useRef<(ComponentRef<typeof TextInput> | null)[]>([]);
  /** Passe à vrai dès la première saisie : on n'écrase plus par le brouillon. */
  const dirtyRef = useRef(false);
  // Même clé tant que l'écran est ouvert : un rejeu après coupure renvoie la
  // publication déjà créée au lieu d'en publier une seconde.
  const clientId = useRef(newClientId());

  // Brouillon disque : relu une fois, et seulement si rien n'a été tapé.
  // En mode édition, c'est le post existant qui pré-remplit le formulaire.
  useEffect(() => {
    if (editingId) {
      return;
    }
    let alive = true;
    void readTextDraft().then((draft) => {
      if (!alive || !draft || dirtyRef.current) {
        return;
      }
      setPages(draft.pages);
      setPageStyles(draft.pageStyles ?? []);
      setTitle(draft.title ?? '');
      if (isBackgroundKey(draft.background)) {
        setBackground(draft.background);
      }
      if (isFontKey(draft.font)) {
        setFont(draft.font as TextFontKey);
      }
      setAlign(textAlignValue(draft.align));
      if (isColorKey(draft.color)) {
        setColor(draft.color);
      }
      if (typeof draft.textSize === 'number') {
        setTextSize(draft.textSize);
      }
      setLocation(draft.location ?? '');
    });
    return () => {
      alive = false;
    };
  }, [editingId]);

  // Mode édition : le post existant pré-remplit tout le formulaire.
  useEffect(() => {
    if (!editingId || !token) {
      return;
    }
    let alive = true;
    void api
      .publication(token, editingId)
      .then((post) => {
        if (!alive) {
          return;
        }
        const postPages = (post.pages ?? []).filter((page) => page.trim().length > 0);
        setPages(postPages.length > 0 ? postPages : [post.caption ?? '']);
        setPageStyles(
          (post.pageStyles ?? []).map((style) =>
            style &&
            (style.background ||
              style.color ||
              style.font ||
              style.align ||
              typeof style.size === 'number')
              ? {
                  ...(style.background ? { background: style.background } : {}),
                  ...(style.color ? { color: style.color } : {}),
                  ...(style.font ? { font: style.font } : {}),
                  ...(style.align ? { align: style.align } : {}),
                  ...(typeof style.size === 'number' ? { size: style.size } : {}),
                }
              : null,
          ),
        );
        setTitle(post.textTitle ?? '');
        if (isBackgroundKey(post.textBackground ?? '')) {
          setBackground(post.textBackground as keyof typeof FeedTextPost.backgrounds);
        }
        if (isFontKey(post.textFont)) {
          setFont(post.textFont as TextFontKey);
        }
        setAlign(textAlignValue(post.textAlign));
        if (isColorKey(post.textColor)) {
          setColor(post.textColor);
        }
        setTextSize(typeof post.textSize === 'number' ? post.textSize : null);
        setLocation(post.location ?? '');
        setEditLoaded(true);
      })
      .catch(() => {
        if (alive) {
          setError(fr.social.createPublishError);
          setEditLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [editingId, token]);

  // Écriture groupée à chaque frappe, sauf sur l'état initial vierge.
  useEffect(() => {
    if (!dirtyRef.current && pages.length === 1 && pages[0] === '' && title === '') {
      return;
    }
    writeTextDraft({
      pages,
      pageStyles: pageStyles.length > 0 ? pageStyles : undefined,
      title,
      background,
      font,
      align,
      color,
      textSize: textSize ?? undefined,
      location: location.trim() || undefined,
    });
  }, [align, background, color, font, location, pageStyles, pages, textSize, title]);

  // La carte prend toute la largeur ; sa hauteur est bornée par le ratio 4:5
  // et par la place réellement visible. Clavier ouvert, elle devient large et
  // courte au lieu de rétrécir en fine colonne 4:5 — ce qui effondrait la
  // police au minimum à chaque frappe.
  const cardWidth = area.width > 0 ? area.width : Math.max(160, windowWidth - Gutter * 2);
  const cardHeight = Math.min(
    cardWidth / TEXT_CARD_ASPECT,
    area.height > 0 ? area.height : cardWidth / TEXT_CARD_ASPECT,
  );
  const current = pages[index] ?? '';
  /** Teinte du texte : `null` = la couleur « onMedia » du compositeur. */
  const textColor = color === 'auto' ? null : (textColorByKey(color)?.color ?? null);

  const canPublish = cleanPages(pages).length > 0 && !publishing;
  // Comme Facebook : le fond coloré ne vaut que pour les posts courts. Texte
  // long ou multi-pages → fond normal, appliqué à l'aperçu et à la publication
  // (la pastille reste sélectionnée : elle s'appliquera si le texte raccourcit).
  const effectiveBackground = isShortTextPost(title, pages) ? background : 'dark';

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  // --- Style par page (multi-cartes) ---
  // Deux pages ou plus : les pastilles fond/couleur écrivent dans
  // `pageStyles[index]` au lieu des champs globaux — chaque carte est
  // indépendante, comme les carrousels Instagram.
  const isMultiPageUi = pages.length > 1;
  const pageStyleAt = useCallback(
    (pageIndex: number): PageStyle | null => pageStyles[pageIndex] ?? null,
    [pageStyles],
  );
  const updatePageStyle = useCallback(
    (pageIndex: number, patch: PageStyle) => {
      markDirty();
      setPageStyles((current) => {
        const next = [...current];
        while (next.length <= pageIndex) {
          next.push(null);
        }
        const merged: PageStyle = { ...(next[pageIndex] ?? {}), ...patch };
        // Clés vides retirées : `null` = page sans style.
        next[pageIndex] =
          merged.background !== undefined ||
          merged.color !== undefined ||
          merged.font !== undefined ||
          merged.align !== undefined ||
          typeof merged.size === 'number'
            ? merged
            : null;
        return next;
      });
    },
    [markDirty],
  );
  /** Fond affiché par la carte `pageIndex` (aperçu et édition). */
  const pageBackgroundAt = useCallback(
    (pageIndex: number): string => {
      if (!isMultiPageUi) {
        return effectiveBackground;
      }
      return pageStyleAt(pageIndex)?.background ?? 'dark';
    },
    [effectiveBackground, isMultiPageUi, pageStyleAt],
  );
  /** Couleur du texte de la carte `pageIndex` : `null` = « onMedia ». */
  const pageTextColorAt = useCallback(
    (pageIndex: number): string | null => {
      if (!isMultiPageUi) {
        return textColor;
      }
      const key = pageStyleAt(pageIndex)?.color;
      return key ? (textColorByKey(key)?.color ?? null) : null;
    },
    [isMultiPageUi, pageStyleAt, textColor],
  );
  /** Police de la carte `pageIndex` : clé propre ou police globale. */
  const pageFontAt = useCallback(
    (pageIndex: number): TextFontKey => {
      if (!isMultiPageUi) {
        return font;
      }
      const key = pageStyleAt(pageIndex)?.font;
      return isFontKey(key) ? (key as TextFontKey) : font;
    },
    [font, isMultiPageUi, pageStyleAt],
  );
  /** Alignement de la carte `pageIndex`. */
  const pageAlignAt = useCallback(
    (pageIndex: number): TextAlignKey => {
      if (!isMultiPageUi) {
        return align;
      }
      const raw = pageStyleAt(pageIndex)?.align;
      return raw === 'left' || raw === 'center' || raw === 'right' || raw === 'justify'
        ? raw
        : align;
    },
    [align, isMultiPageUi, pageStyleAt],
  );
  /** Taille manuelle de la carte `pageIndex` (`null` = auto). */
  const pageSizeAt = useCallback(
    (pageIndex: number): number | null => {
      if (!isMultiPageUi) {
        return textSize;
      }
      return pageStyleAt(pageIndex)?.size ?? textSize;
    },
    [isMultiPageUi, pageStyleAt, textSize],
  );

  const updatePage = useCallback(
    (pageIndex: number, value: string) => {
      markDirty();
      setPages((current) => current.map((page, i) => (i === pageIndex ? value : page)));
    },
    [markDirty],
  );

  // Suggestions `@`/`#` : le jeton en cours de frappe dans la page active
  // déclenche une recherche débouncée ; la sélection remplace le jeton.
  const mention = useMemo(() => trailingMention(current), [current]);
  const mentionKey = mention ? `${index}:${mention.sigil}${mention.query}` : null;
  useEffect(() => {
    if (!mention || !mentionKey || !token || preview) {
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          if (mention.sigil === '@') {
            const result = await api.search(token, mention.query, 'users');
            if (alive) {
              setSuggestions({
                key: mentionKey,
                items: result.users.items
                  .slice(0, SUGGESTION_LIMIT)
                  .map((user) => ({ kind: 'user' as const, user })),
              });
            }
            return;
          }
          if (mention.query.length === 0) {
            const trending = await api.trendingHashtags(token);
            if (alive) {
              setSuggestions({
                key: mentionKey,
                items: trending
                  .slice(0, SUGGESTION_LIMIT)
                  .map((tag) => ({ kind: 'tag' as const, tag })),
              });
            }
            return;
          }
          const result = await api.search(token, mention.query, 'hashtags');
          if (alive) {
            setSuggestions({
              key: mentionKey,
              items: result.hashtags.items
                .slice(0, SUGGESTION_LIMIT)
                .map((tag) => ({ kind: 'tag' as const, tag })),
            });
          }
        } catch {
          // Recherche indisponible : on garde la bande vide, la saisie continue.
        }
      })();
    }, SUGGESTION_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [index, mention, mentionKey, preview, token]);

  // Les suggestions d'un jeton précédent ne sont jamais affichées : la clé
  // change à chaque frappe, donc une réponse tardive est ignorée.
  const visibleSuggestions =
    mentionKey && suggestions.key === mentionKey ? suggestions.items : [];

  const applySuggestion = useCallback(
    (suggestion: Suggestion) => {
      if (!mention) {
        return;
      }
      const replacement =
        suggestion.kind === 'user'
          ? `@${suggestion.user.username} `
          : `#${suggestion.tag.tag} `;
      const next = `${current.slice(0, mention.start)}${replacement}`;
      updatePage(index, next);
      setSuggestions({ key: '', items: [] });
      // Le focus reste sur l'input : la saisie continue après le jeton.
      inputRefs.current[index]?.focus();
    },
    [current, index, mention, updatePage],
  );

  const scrollToPage = useCallback(
    (pageIndex: number, animated = true) => {
      listRef.current?.scrollToOffset({ offset: pageIndex * windowWidth, animated });
    },
    [windowWidth],
  );

  const addPage = useCallback(() => {
    if (pages.length >= MAX_PAGES) {
      return;
    }
    markDirty();
    const next = Math.min(pages.length, MAX_PAGES - 1);
    setPages((current) => (current.length >= MAX_PAGES ? current : [...current, '']));
    setIndex(next);
    // Le défilement attend la nouvelle page ; le focus suit d'un cran.
    setTimeout(() => {
      scrollToPage(next);
      inputRefs.current[next]?.focus();
    }, 80);
    void Haptics.selectionAsync().catch(() => undefined);
  }, [markDirty, pages.length, scrollToPage]);

  const removePage = useCallback(
    (pageIndex: number) => {
      if (pages.length <= 1) {
        return;
      }
      markDirty();
      setPages((current) => current.filter((_, i) => i !== pageIndex));
      // Le style de la page supprimée saute avec elle : les index restent
      // alignés sur les pages restantes.
      setPageStyles((current) => current.filter((_, i) => i !== pageIndex));
      const next = Math.max(0, Math.min(pageIndex, pages.length - 2));
      setIndex(next);
      setTimeout(() => scrollToPage(next), 60);
      void Haptics.selectionAsync().catch(() => undefined);
    },
    [markDirty, pages.length, scrollToPage],
  );

  const selectBackground = useCallback(
    (key: keyof typeof FeedTextPost.backgrounds) => {
      markDirty();
      if (isMultiPageUi) {
        updatePageStyle(index, { background: key });
      } else {
        setBackground(key);
      }
      void Haptics.selectionAsync().catch(() => undefined);
    },
    [index, isMultiPageUi, markDirty, updatePageStyle],
  );

  const selectFont = useCallback(
    (key: TextFontKey) => {
      markDirty();
      if (isMultiPageUi) {
        updatePageStyle(index, { font: key });
      } else {
        setFont(key);
      }
      void Haptics.selectionAsync().catch(() => undefined);
    },
    [index, isMultiPageUi, markDirty, updatePageStyle],
  );

  const selectAlign = useCallback(
    (key: TextAlignKey) => {
      markDirty();
      if (isMultiPageUi) {
        updatePageStyle(index, { align: key });
      } else {
        setAlign(key);
      }
      void Haptics.selectionAsync().catch(() => undefined);
    },
    [index, isMultiPageUi, markDirty, updatePageStyle],
  );

  const selectColor = useCallback(
    (key: TextColorChoice) => {
      markDirty();
      if (isMultiPageUi) {
        // « auto » = pas de clé : la page reprend la teinte par défaut.
        updatePageStyle(index, { color: key === 'auto' ? undefined : key });
      } else {
        setColor(key);
      }
      void Haptics.selectionAsync().catch(() => undefined);
    },
    [index, isMultiPageUi, markDirty, updatePageStyle],
  );

  /**
   * Taille manuelle : `null` = auto-ajustement ; sinon pas de ±2 borné.
   * Partir de `null` sur « + » ouvre à 28, valeur médiane du catalogue.
   */
  const stepTextSize = useCallback(
    (direction: 1 | -1) => {
      markDirty();
      if (isMultiPageUi) {
        // Taille propre à la page : partie de la valeur de la page, sinon
        // de la taille globale, sinon de la médiane du catalogue.
        updatePageStyle(index, {
          size: Math.min(
            TEXT_MANUAL_FONT.max,
            Math.max(
              TEXT_MANUAL_FONT.min,
              (pageStyleAt(index)?.size ?? textSize ?? 28) + direction * TEXT_MANUAL_FONT.step,
            ),
          ),
        });
      } else {
        setTextSize((current) => {
          const base = current ?? 28;
          const next = base + direction * TEXT_MANUAL_FONT.step;
          return Math.min(TEXT_MANUAL_FONT.max, Math.max(TEXT_MANUAL_FONT.min, next));
        });
      }
      void Haptics.selectionAsync().catch(() => undefined);
    },
    [index, isMultiPageUi, markDirty, pageStyleAt, textSize, updatePageStyle],
  );

  const resetTextSize = useCallback(() => {
    markDirty();
    if (isMultiPageUi) {
      // Taille « auto » pour cette page seulement.
      updatePageStyle(index, { size: undefined });
    } else {
      setTextSize(null);
    }
    void Haptics.selectionAsync().catch(() => undefined);
  }, [index, isMultiPageUi, markDirty, updatePageStyle]);

  // --- Brouillons multiples ---

  const refreshDraftList = useCallback(() => {
    void listTextDrafts().then(setDraftList);
  }, []);

  const openDrafts = useCallback(() => {
    Keyboard.dismiss();
    setSuggestions({ key: '', items: [] });
    refreshDraftList();
    setDraftsOpen(true);
  }, [refreshDraftList]);

  /** Recharge un brouillon choisi : le contenu remplace l'écran courant. */
  const applyDraft = useCallback((draft: TextDraft) => {
    activateTextDraft(draft.id);
    setPages(draft.pages.length > 0 ? draft.pages : ['']);
    setPageStyles(draft.pageStyles ?? []);
    setTitle(draft.title ?? '');
    if (isBackgroundKey(draft.background)) {
      setBackground(draft.background);
    }
    if (isFontKey(draft.font)) {
      setFont(draft.font as TextFontKey);
    }
    setAlign(textAlignValue(draft.align));
    if (isColorKey(draft.color)) {
      setColor(draft.color);
    }
    setTextSize(typeof draft.textSize === 'number' ? draft.textSize : null);
    setLocation(draft.location ?? '');
    setIndex(0);
    setPreview(false);
    setError(null);
    setDraftsOpen(false);
  }, []);

  const removeDraft = useCallback(
    (id: string) => {
      void deleteTextDraft(id).then(refreshDraftList);
    },
    [refreshDraftList],
  );

  /** « Nouveau brouillon » : l'actuel reste en liste, l'écran repart vierge. */
  const newDraft = useCallback(() => {
    startNewTextDraft();
    setPages(['']);
    setPageStyles([]);
    setTitle('');
    setBackground('dark');
    setFont(DEFAULT_TEXT_FONT);
    setAlign(textAlignValue(undefined));
    setColor('auto');
    setTextSize(null);
    setLocation('');
    setIndex(0);
    setPreview(false);
    setError(null);
    setDraftsOpen(false);
  }, []);

  /**
   * « Ma position » : demande la permission si besoin, géocode côté serveur
   * et remplit le champ lieu avec « Ville, Pays ». Les coordonnées ne
   * quittent jamais l'appareil.
   */
  const detectLocation = useCallback(async () => {
    if (!token || locating) {
      return;
    }
    setLocating(true);
    setError(null);
    try {
      let access = await getLocationAccess();
      if (access.status === 'undetermined') {
        access = await requestLocationAccess();
      }
      if (access.status !== 'granted') {
        setError(fr.social.createLocationDenied);
        return;
      }
      const coords = await currentCoordinates();
      if (!coords) {
        setError(fr.social.createLocationFailed);
        return;
      }
      const place = await api.reverseGeo(token, coords.latitude, coords.longitude);
      if (!place?.city) {
        setError(fr.social.createLocationFailed);
        return;
      }
      markDirty();
      locationEdited.current = false;
      setLocation(place.country ? `${place.city}, ${place.country}` : place.city);
    } catch {
      setError(fr.social.createLocationFailed);
    } finally {
      setLocating(false);
    }
  }, [locating, markDirty, token]);

  /**
   * Autocomplétion du lieu : après une frappe, requête débouncée vers
   * `/users/geo/search` (Nominatim côté serveur). Sans saisie manuelle —
   * brouillon restauré ou GPS — aucune suggestion ne remonte.
   */
  useEffect(() => {
    const query = location.trim();
    if (!token || !locationEdited.current || query.length < 3) {
      setPlaceSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void api
        .geoSearch(token, query)
        .then((places) => {
          if (!cancelled) {
            setPlaceSuggestions(places);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPlaceSuggestions([]);
          }
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [location, token]);

  /** Sélection d'une suggestion : le libellé « Ville, Pays » devient le lieu. */
  const pickPlace = useCallback(
    (place: { city: string; country: string | null }) => {
      markDirty();
      locationEdited.current = false;
      setLocation(place.country ? `${place.city}, ${place.country}` : place.city);
      setPlaceSuggestions([]);
    },
    [markDirty],
  );

  const openPreview = useCallback(() => {
    if (!canPublish) {
      return;
    }
    Keyboard.dismiss();
    setSuggestions({ key: '', items: [] });
    setPreview(true);
    void Haptics.selectionAsync().catch(() => undefined);
  }, [canPublish]);

  const closePreview = useCallback(() => {
    setPreview(false);
  }, []);

  const onMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (windowWidth === 0) {
        return;
      }
      setIndex(Math.round(event.nativeEvent.contentOffset.x / windowWidth));
    },
    [windowWidth],
  );

  const onAreaLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setArea((previous) => {
      // La carte s'inscrit dans la zone réellement visible : quand le clavier
      // réduit la hauteur, elle rétrécit au lieu de déborder sous le clavier.
      if (Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1) {
        return previous;
      }
      return { width, height };
    });
  }, []);

  const publish = useCallback(async () => {
    // Pages et styles appairés AVANT de retirer les vides : l'index du style
    // suit sa page même si une page intermédiaire est laissée vide.
    const filledPairs = pages
      .map((text, pageIndex) => ({
        text: text.trim(),
        style: pageStyles[pageIndex] ?? null,
      }))
      .filter((pair) => pair.text.length > 0);
    const filled = filledPairs.map((pair) => pair.text);
    if (!token || publishing || filled.length === 0) {
      return;
    }
    // Styles envoyés uniquement en multi-cartes, alignés sur les pages
    // retenues. `{}` = page sans style : le DTO refuse `null` dans le
    // tableau, le serveur normalise l'objet vide en `null` au stockage.
    const pageStylesPayload = filledPairs.map((pair) => {
      const style = pair.style;
      const clean: PageStyle = {};
      if (style?.background) {
        clean.background = style.background;
      }
      if (style?.color) {
        clean.color = style.color;
      }
      if (style?.font) {
        clean.font = style.font;
      }
      if (style?.align) {
        clean.align = style.align;
      }
      if (typeof style?.size === 'number') {
        clean.size = style.size;
      }
      return clean;
    });
    setPublishing(true);
    setError(null);
    try {
      const style = {
        textBackground: effectiveBackground,
        textFont: font,
        textAlign: align,
        // « auto » = pas de choix : le serveur stocke `null` (couleur du thème).
        textColor: color === 'auto' ? null : color,
        // Titre dédié : `null` efface, une valeur le remplace.
        textTitle: title.trim() ? title.trim() : null,
        // Taille : `null` = auto-ajustement, un nombre = taille manuelle.
        textSize,
        // Lieu : `null` efface, une valeur le pose.
        location: location.trim() ? location.trim() : null,
      };
      if (editingId) {
        await api.updatePublication(token, editingId, {
          // `textPages` est toujours envoyé en édition : repasser à une page
          // doit réellement repasser le post en publication classique.
          textPages: filled,
          textPageStyles: filled.length > 1 ? pageStylesPayload : [],
          ...style,
        });
      } else {
        await api.createPublication(token, {
          clientId: clientId.current,
          // Une seule page = publication classique (`caption`) ; plusieurs =
          // `textPages`, le serveur en déduit la légende (première page).
          ...(filled.length > 1
            ? { textPages: filled, textPageStyles: pageStylesPayload }
            : { caption: filled[0] }),
          // `textColor` n'est pas accepté par la création quand « auto » :
          // on l'omet, le serveur stocke `null`.
          ...(color === 'auto' ? {} : { textColor: color }),
          textBackground: effectiveBackground,
          textFont: font,
          textAlign: align,
          // Titre dédié facultatif : absent = le fil déduit la première ligne.
          ...(title.trim() ? { textTitle: title.trim() } : {}),
          // Taille manuelle facultative : absente = auto-ajustement.
          ...(textSize !== null ? { textSize } : {}),
          // Lieu facultatif : absent = pas de localisation.
          ...(location.trim() ? { location: location.trim() } : {}),
        });
      }
      clearTextDraft();
      invalidateFeedCache(token);
      // Retour au fil : la pile de création est remplacée par le résultat.
      router.dismissTo('/');
    } catch {
      setError(fr.social.createPublishError);
      setPublishing(false);
    }
  }, [align, color, editingId, effectiveBackground, font, location, pageStyles, pages, publishing, textSize, title, token]);

  const renderEditPage = useCallback(
    ({ item, index: pageIndex }: { item: string; index: number }) => {
      const itemSize = pageSizeAt(pageIndex);
      const itemFontSpec = textFontByKey(pageFontAt(pageIndex));
      const itemFontStyle = textFontStyle(itemFontSpec, Platform.OS);
      const itemCharRatio = itemFontSpec?.charRatio ?? CHAR_RATIO;
      const fit =
        itemSize === null
          ? autoFitTextSize(item, cardWidth, itemCharRatio)
          : manualTypography(itemSize);
      const itemAlign = pageAlignAt(pageIndex);
      // Multi-cartes : fond et couleur propres à la page affichée.
      const pageBg = pageBackgroundAt(pageIndex);
      const pageColor = pageTextColorAt(pageIndex);
      return (
        <View style={[styles.page, { width: windowWidth }]}>
          <View
            style={[
              styles.card,
              {
                width: cardWidth,
                height: cardHeight,
                backgroundColor: FeedTextPost.backgroundSwatch(pageBg),
              },
            ]}>
            <TextInput
              ref={(node) => {
                inputRefs.current[pageIndex] = node;
              }}
              value={item}
              onChangeText={(value) => updatePage(pageIndex, value)}
              placeholder={fr.social.createPlaceholder}
              placeholderTextColor={FeedSurface.onMediaFaint}
              multiline
              maxLength={MAX_PAGE_LENGTH}
              textAlignVertical="center"
              style={[
                styles.cardInput,
                itemFontStyle,
                {
                  fontSize: fit.fontSize,
                  lineHeight: fit.lineHeight,
                  color: pageColor ?? FeedSurface.onMedia,
                  textAlign: itemAlign,
                },
              ]}
              accessibilityLabel={fr.social.createTextPageInput(pageIndex + 1)}
            />
            {pages.length > 1 ? (
              <Pressable
                onPress={() => removePage(pageIndex)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={fr.social.createRemovePage}
                style={({ pressed }) => [styles.removePage, pressed && styles.pressed]}>
                <Icon icon={X} size={15} color={FeedSurface.onMedia} />
              </Pressable>
            ) : null}
          </View>
        </View>
      );
    },
    [cardHeight, cardWidth, pageAlignAt, pageBackgroundAt, pageFontAt, pageSizeAt, pageTextColorAt, pages.length, removePage, updatePage, windowWidth],
  );

  /** Aperçu : la carte telle qu'elle apparaîtra dans le fil (dégradé réel). */
  const renderPreviewPage = useCallback(
    ({ item, index: pageIndex }: { item: string; index: number }) => {
      const itemSize = pageSizeAt(pageIndex);
      const itemFontSpec = textFontByKey(pageFontAt(pageIndex));
      const itemFontStyle = textFontStyle(itemFontSpec, Platform.OS);
      const itemCharRatio = itemFontSpec?.charRatio ?? CHAR_RATIO;
      const fit =
        itemSize === null
          ? autoFitTextSize(item, cardWidth, itemCharRatio)
          : manualTypography(itemSize);
      const itemAlign = pageAlignAt(pageIndex);
      const previewTitle = pageIndex === 0 ? title.trim() : '';
      // Multi-cartes : le fond coloré d'une page ne vaut que si son propre
      // texte est court — même règle que le fil, carte par carte.
      const pageBg = isMultiPageUi
        ? item.trim().length <= TEXT_POST_BODY_MAX_CHARS
          ? (pageStyleAt(pageIndex)?.background ?? 'dark')
          : 'dark'
        : effectiveBackground;
      const pageColor = pageTextColorAt(pageIndex);
      return (
        <View style={[styles.page, { width: windowWidth }]}>
          <View
            style={[
              styles.card,
              styles.previewCard,
              { width: cardWidth, height: cardHeight },
            ]}>
            <TextPostBackdrop backgroundKey={pageBg} />
            {previewTitle ? (
              <ThemedText
                style={[
                  styles.previewTitle,
                  itemFontStyle,
                  {
                    color: pageColor ?? FeedSurface.onMedia,
                    textAlign: itemAlign,
                  },
                ]}>
                {previewTitle}
              </ThemedText>
            ) : null}
            <ThemedText
              style={[
                itemFontStyle,
                {
                  fontSize: fit.fontSize,
                  lineHeight: fit.lineHeight,
                  color: pageColor ?? FeedSurface.onMedia,
                  textAlign: itemAlign,
                },
              ]}
              accessibilityLabel={item}>
              {item || ' '}
            </ThemedText>
          </View>
        </View>
      );
    },
    [cardHeight, cardWidth, effectiveBackground, isMultiPageUi, pageAlignAt, pageFontAt, pageSizeAt, pageStyleAt, pageTextColorAt, title, windowWidth],
  );

  const renderPage = preview ? renderPreviewPage : renderEditPage;

  // Valeurs affichées par les pastilles : en multi-cartes, celles de la
  // page en cours d'édition ; sinon les champs globaux du post.
  const pickerColor: TextColorChoice = isMultiPageUi
    ? (pageStyleAt(index)?.color ?? 'auto')
    : color;
  const pickerBackground: string = isMultiPageUi
    ? (pageStyleAt(index)?.background ?? 'dark')
    : background;
  const pickerFont = pageFontAt(index);
  const pickerAlign = pageAlignAt(index);
  const pickerSize = pageSizeAt(index);
  // Rangée d'outils compacte : chaque contrôle n'affiche que la valeur
  // choisie et se déplie au tap pour révéler les autres options.
  const [openFormat, setOpenFormat] = useState<'font' | 'align' | 'size' | null>(null);
  const pickerFontSpec = textFontByKey(pickerFont);
  const pickerFontStyle = textFontStyle(pickerFontSpec, Platform.OS);
  const pickerFontLabel = pickerFontSpec
    ? (fr.social[
        pickerFontSpec.labelKey.split('.')[1] as keyof typeof fr.social
      ] as string)
    : '';
  const pickerAlignSpec = TEXT_ALIGNS.find((entry) => entry.key === pickerAlign);
  const pickerAlignLabel = pickerAlignSpec
    ? (fr.social[
        pickerAlignSpec.labelKey.split('.')[1] as keyof typeof fr.social
      ] as string)
    : '';

  const onBack = useCallback(() => {
    if (preview) {
      closePreview();
      return;
    }
    router.back();
  }, [closePreview, preview]);

  // Mode édition : on attend le post avant d'afficher le formulaire.
  if (editLoading) {
    return (
      <View style={[styles.screen, { backgroundColor: FeedSurface.background }]}>
        <Stack.Screen options={{ headerShown: false, statusBarStyle: 'light' }} />
        <ActivityIndicator style={styles.loading} color={FeedSurface.accent} />
      </View>
    );
  }

  return (
    // Compositeur volontairement sombre, comme le fil : l'aperçu de la carte
    // doit correspondre au rendu réel quel que soit le thème de l'app.
    <View style={[styles.screen, { backgroundColor: FeedSurface.background }]}>
      <Stack.Screen options={{ headerShown: false, statusBarStyle: 'light' }} />
      <View
        style={[
          styles.topBar,
          { paddingTop: insets.top + Spacing.two, borderBottomColor: FeedSurface.onMediaFaint },
        ]}>
        <View style={styles.topLeft}>
          <Pressable
            onPress={onBack}
            disabled={publishing}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={preview ? fr.social.createEditAction : fr.social.back}>
            <Icon icon={ArrowLeft} size={22} color={FeedSurface.onMedia} />
          </Pressable>
          {/* Brouillons : uniquement en création — en édition, le post fait foi. */}
          {!preview && !editingId ? (
            <Pressable
              onPress={openDrafts}
              disabled={publishing}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={fr.social.createDrafts}>
              <Icon icon={NotebookPen} size={20} color={FeedSurface.onMediaSoft} />
            </Pressable>
          ) : null}
        </View>
        <ThemedText style={[Type.body, styles.topTitle, { color: FeedSurface.onMedia }]}>
          {preview
            ? fr.social.createPreviewAction
            : editingId
              ? fr.social.editHeader
              : fr.social.createHeader}
        </ThemedText>
        {preview ? (
          <Pressable
            onPress={() => void publish()}
            disabled={!canPublish}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={editingId ? fr.social.saveChanges : fr.social.createPublish}
            accessibilityState={{ disabled: !canPublish }}>
            {publishing ? (
              <ActivityIndicator size="small" color={FeedSurface.accent} />
            ) : (
              <ThemedText
                style={[
                  Type.body,
                  styles.publishLabel,
                  { color: canPublish ? FeedSurface.accent : FeedSurface.onMediaFaint },
                ]}>
                {editingId ? fr.social.saveChanges : fr.social.createPublish}
              </ThemedText>
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={openPreview}
            disabled={!canPublish}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={fr.social.createPreviewAction}
            accessibilityState={{ disabled: !canPublish }}>
            <ThemedText
              style={[
                Type.body,
                styles.publishLabel,
                { color: canPublish ? FeedSurface.accent : FeedSurface.onMediaFaint },
              ]}>
              {fr.social.createNext}
            </ThemedText>
          </Pressable>
        )}
      </View>

      {/* Android : `adjustResize` (défaut Expo) réduit déjà la fenêtre pour le
          clavier — un KAV « height » retrancherait la hauteur une seconde fois
          et créerait un vide entre la carte et les barres d'outils. Sur iOS,
          le clavier recouvre la fenêtre : « padding » le compense. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Titre dédié facultatif : en aperçu, il est rendu dans la carte. */}
        {!preview ? (
          <View
            style={[
              styles.titleBar,
              { borderBottomColor: FeedSurface.onMediaFaint },
            ]}>
            <TextInput
              value={title}
              onChangeText={(value) => {
                markDirty();
                setTitle(value);
              }}
              placeholder={fr.social.createTitlePlaceholder}
              placeholderTextColor={FeedSurface.onMediaFaint}
              maxLength={TEXT_TITLE_INPUT_MAX_CHARS}
              style={styles.titleInput}
              accessibilityLabel={fr.social.createTitleInput}
            />
            {/* Lieu facultatif : saisie libre ou détection par position. */}
            <View style={styles.locationRow}>
              <Icon icon={MapPin} size={15} color={FeedSurface.onMediaFaint} />
              <TextInput
                value={location}
                onChangeText={(value) => {
                  markDirty();
                  locationEdited.current = true;
                  setLocation(value);
                }}
                placeholder={fr.social.createLocationPlaceholder}
                placeholderTextColor={FeedSurface.onMediaFaint}
                maxLength={100}
                style={styles.locationInput}
                accessibilityLabel={fr.social.createLocationInput}
              />
              <Pressable
                onPress={() => void detectLocation()}
                disabled={locating}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={fr.social.createLocationGps}
                style={({ pressed }) => [styles.locationGps, pressed && styles.pressed]}>
                {locating ? (
                  <ActivityIndicator size="small" color={FeedSurface.onMediaSoft} />
                ) : (
                  <Icon icon={Crosshair} size={16} color={FeedSurface.onMediaSoft} />
                )}
              </Pressable>
            </View>
            {/* Suggestions de villes : liste courte sous le champ, un appui
                fige « Ville, Pays » comme lieu du post. */}
            {placeSuggestions.length > 0 ? (
              <View style={styles.placeList}>
                {placeSuggestions.map((place) => {
                  const label = place.country
                    ? `${place.city}, ${place.country}`
                    : place.city;
                  return (
                    <Pressable
                      key={label}
                      onPress={() => pickPlace(place)}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      style={({ pressed }) => [
                        styles.placeRow,
                        pressed && styles.pressed,
                      ]}>
                      <Icon icon={MapPin} size={14} color={FeedSurface.onMediaFaint} />
                      <ThemedText
                        numberOfLines={1}
                        style={[styles.placeText, { color: FeedSurface.onMedia }]}>
                        {label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={styles.pagerArea} onLayout={onAreaLayout}>
          <FlatList
            ref={listRef}
            data={pages}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(_, pageIndex) => `page-${pageIndex}`}
            renderItem={renderPage}
            onMomentumScrollEnd={onMomentumEnd}
            scrollEnabled={!preview || pages.length > 1}
            getItemLayout={(_, pageIndex) => ({
              length: windowWidth,
              offset: windowWidth * pageIndex,
              index: pageIndex,
            })}
          />

          {!preview && pages.length < MAX_PAGES ? (
            <Pressable
              onPress={addPage}
              accessibilityRole="button"
              accessibilityLabel={fr.social.createAddPage}
              style={({ pressed }) => [styles.addPage, pressed && styles.pressed]}>
              <Icon icon={Plus} size={20} color={FeedSurface.onMedia} strokeWidth={2.6} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.statusRow}>
          {/* Points de pagination purement visuels : l'annonce vocale porte sur
              le groupe, pas sur chaque point. */}
          <View
            style={styles.dots}
            accessible={pages.length > 1}
            accessibilityLabel={
              pages.length > 1 ? fr.social.createPageOf(index + 1, pages.length) : undefined
            }>
            {pages.length > 1
              ? pages.map((_, dotIndex) => (
                  <View
                    key={dotIndex}
                    style={[styles.dot, dotIndex === index && styles.dotActive]}
                  />
                ))
              : null}
          </View>
          {!preview ? (
            <ThemedText type="caption" style={styles.counter}>
              {current.length > FEED_PREVIEW_CHARS
                ? fr.social.createTextCounter(current.length, MAX_PAGE_LENGTH)
                : ''}
            </ThemedText>
          ) : null}
        </View>

        {!preview && current.length > FEED_PREVIEW_CHARS ? (
          <ThemedText type="micro" style={styles.hint}>
            {fr.social.createTextTruncatedHint}
          </ThemedText>
        ) : null}

        {error ? (
          <ThemedText type="caption" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}

        {!preview && visibleSuggestions.length > 0 ? (
          <View
            style={styles.suggestions}
            accessibilityLabel={fr.social.createSuggestionsLabel}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.suggestionsRow}>
              {visibleSuggestions.map((suggestion) =>
                suggestion.kind === 'user' ? (
                  <Pressable
                    key={`u-${suggestion.user.id}`}
                    onPress={() => applySuggestion(suggestion)}
                    accessibilityRole="button"
                    accessibilityLabel={fr.social.createMentionUser(
                      suggestion.user.displayName,
                    )}
                    style={({ pressed }) => [
                      styles.suggestionChip,
                      pressed && styles.pressed,
                    ]}>
                    <Avatar
                      name={suggestion.user.displayName}
                      uri={suggestion.user.avatarUrl}
                      size={22}
                      shape="rounded"
                    />
                    <ThemedText numberOfLines={1} style={styles.suggestionText}>
                      @{suggestion.user.username}
                    </ThemedText>
                  </Pressable>
                ) : (
                  <Pressable
                    key={`t-${suggestion.tag.id}`}
                    onPress={() => applySuggestion(suggestion)}
                    accessibilityRole="button"
                    accessibilityLabel={`#${suggestion.tag.tag}`}
                    style={({ pressed }) => [
                      styles.suggestionChip,
                      pressed && styles.pressed,
                    ]}>
                    <Icon icon={Hash} size={14} color={FeedSurface.onMediaSoft} />
                    <ThemedText numberOfLines={1} style={styles.suggestionText}>
                      #{suggestion.tag.tag}
                    </ThemedText>
                  </Pressable>
                ),
              )}
            </ScrollView>
          </View>
        ) : null}

        {preview ? (
          <View
            style={[
              styles.previewBar,
              {
                borderTopColor: FeedSurface.onMediaFaint,
                paddingBottom: insets.bottom + Spacing.two,
              },
            ]}>
            <Pressable
              onPress={closePreview}
              disabled={publishing}
              accessibilityRole="button"
              accessibilityLabel={fr.social.createEditAction}
              style={({ pressed }) => [styles.previewSecondary, pressed && styles.pressed]}>
              <ThemedText style={[Type.body, styles.previewSecondaryText]}>
                {fr.social.createEditAction}
              </ThemedText>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Formatage : polices en pastilles « Aa » et alignement segmenté,
                comme la rangée d'outils d'Instagram. */}
            <View
              style={[
                styles.formatBar,
                { borderTopColor: FeedSurface.onMediaFaint },
              ]}>
              {openFormat === 'font' ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.fonts}>
                  {TEXT_FONTS.map((spec) => {
                    const specStyle = textFontStyle(spec, Platform.OS);
                    const selected = spec.key === pickerFont;
                    const label =
                      fr.social[spec.labelKey.split('.')[1] as keyof typeof fr.social] as string;
                    return (
                      <Pressable
                        key={spec.key}
                        onPress={() => {
                          selectFont(spec.key);
                          setOpenFormat(null);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        accessibilityState={{ selected }}
                        style={({ pressed }) => [
                          styles.fontChip,
                          selected && styles.fontChipSelected,
                          pressed && styles.pressed,
                        ]}>
                        <ThemedText
                          style={[
                            styles.fontPreview,
                            specStyle,
                            { color: FeedSurface.onMedia },
                          ]}>
                          Aa
                        </ThemedText>
                        <ThemedText
                          numberOfLines={1}
                          style={[
                            Type.micro,
                            styles.fontName,
                            { color: selected ? FeedSurface.onMedia : FeedSurface.onMediaFaint },
                          ]}>
                          {label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : (
                <Pressable
                  onPress={() => setOpenFormat('font')}
                  accessibilityRole="button"
                  accessibilityLabel={pickerFontLabel}
                  style={({ pressed }) => [
                    styles.fontChip,
                    styles.fontChipSelected,
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText
                    style={[
                      styles.fontPreview,
                      pickerFontStyle,
                      { color: FeedSurface.onMedia },
                    ]}>
                    Aa
                  </ThemedText>
                  <ThemedText
                    numberOfLines={1}
                    style={[Type.micro, styles.fontName, { color: FeedSurface.onMedia }]}>
                    {pickerFontLabel}
                  </ThemedText>
                </Pressable>
              )}
              {openFormat === 'align' ? (
                <View style={styles.alignGroup} accessibilityLabel={fr.social.createAlign}>
                  {TEXT_ALIGNS.map(({ key, labelKey }) => {
                    const selected = key === pickerAlign;
                    const AlignIcon = ALIGN_ICONS[key];
                    return (
                      <Pressable
                        key={key}
                        onPress={() => {
                          selectAlign(key);
                          setOpenFormat(null);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={
                          fr.social[labelKey.split('.')[1] as keyof typeof fr.social] as string
                        }
                        accessibilityState={{ selected }}
                        style={({ pressed }) => [
                          styles.alignChip,
                          selected && styles.alignChipSelected,
                          pressed && styles.pressed,
                        ]}>
                        <Icon
                          icon={AlignIcon}
                          size={17}
                          color={selected ? FeedSurface.onMedia : FeedSurface.onMediaSoft}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Pressable
                  onPress={() => setOpenFormat('align')}
                  accessibilityRole="button"
                  accessibilityLabel={pickerAlignLabel}
                  style={({ pressed }) => [
                    styles.alignGroup,
                    styles.alignChipSelected,
                    pressed && styles.pressed,
                  ]}>
                  <Icon
                    icon={ALIGN_ICONS[pickerAlign]}
                    size={17}
                    color={FeedSurface.onMedia}
                  />
                </Pressable>
              )}
              {/* Taille manuelle : « Auto » = ajustement au contenu ;
                  sinon ±2 borné 16–64, la valeur s'affiche en points. */}
              {openFormat === 'size' ? (
                <View style={styles.sizeGroup} accessibilityLabel={fr.social.createTextSize}>
                  <Pressable
                    onPress={() => stepTextSize(-1)}
                    accessibilityRole="button"
                    accessibilityLabel={fr.social.createTextSizeDown}
                    style={({ pressed }) => [styles.sizeChip, pressed && styles.pressed]}>
                    <ThemedText style={[Type.body, styles.sizeChipText]}>A−</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      resetTextSize();
                      setOpenFormat(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={
                      pickerSize === null
                        ? fr.social.createTextSizeAuto
                        : fr.social.createTextSizeReset(pickerSize)
                    }
                    style={({ pressed }) => [styles.sizeValue, pressed && styles.pressed]}>
                    <ThemedText style={[Type.micro, styles.sizeValueText]}>
                      {pickerSize === null ? fr.social.createTextSizeAuto : `${pickerSize}`}
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => stepTextSize(1)}
                    accessibilityRole="button"
                    accessibilityLabel={fr.social.createTextSizeUp}
                    style={({ pressed }) => [styles.sizeChip, pressed && styles.pressed]}>
                    <ThemedText style={[Type.body, styles.sizeChipText]}>A+</ThemedText>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => setOpenFormat('size')}
                  accessibilityRole="button"
                  accessibilityLabel={
                    pickerSize === null
                      ? fr.social.createTextSizeAuto
                      : fr.social.createTextSizeReset(pickerSize)
                  }
                  style={({ pressed }) => [
                    styles.sizeValue,
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText style={[Type.micro, styles.sizeValueText]}>
                    {pickerSize === null ? fr.social.createTextSizeAuto : `${pickerSize}`}
                  </ThemedText>
                </Pressable>
              )}
            </View>

            {/* Couleur du texte : « auto » suit le thème, les pastilles
                appliquent la teinte telle quelle (comme Instagram). */}
            <View
              style={[
                styles.colorBar,
                { borderTopColor: FeedSurface.onMediaFaint },
              ]}>
              <ThemedText type="caption" style={styles.backgroundLabel}>
                {fr.social.createTextColor}
              </ThemedText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.colorDots}>
                <Pressable
                  onPress={() => selectColor('auto')}
                  accessibilityRole="button"
                  accessibilityLabel={fr.social.createColorAuto}
                  accessibilityState={{ selected: pickerColor === 'auto' }}
                  style={({ pressed }) => [
                    styles.colorFrame,
                    pickerColor === 'auto' && styles.colorFrameSelected,
                    pressed && styles.pressed,
                  ]}>
                  <View style={[styles.colorDot, styles.colorDotAuto]}>
                    <ThemedText style={styles.colorDotAutoLabel}>A</ThemedText>
                  </View>
                </Pressable>
                {TEXT_COLORS.map((spec) => {
                  const selected = pickerColor === spec.key;
                  const label =
                    fr.social[spec.labelKey.split('.')[1] as keyof typeof fr.social] as string;
                  return (
                    <Pressable
                      key={spec.key}
                      onPress={() => selectColor(spec.key)}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      accessibilityState={{ selected }}
                      style={({ pressed }) => [
                        styles.colorFrame,
                        selected && styles.colorFrameSelected,
                        pressed && styles.pressed,
                      ]}>
                      <View style={[styles.colorDot, { backgroundColor: spec.color }]} />
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Fonds de carte : pastilles avec aperçu « Aa », comme le sélecteur IG. */}
            <View
              style={[
                styles.backgroundBar,
                {
                  borderTopColor: FeedSurface.onMediaFaint,
                  paddingBottom: insets.bottom + Spacing.two,
                },
              ]}>
              <ThemedText type="caption" style={styles.backgroundLabel}>
                {fr.social.createBackground}
              </ThemedText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.swatches}>
                {BACKGROUND_KEYS.map((key) => {
                  const selected = key === pickerBackground;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => selectBackground(key)}
                      accessibilityRole="button"
                      accessibilityLabel={fr.social.createBackgroundName(key)}
                      accessibilityState={{ selected }}
                      style={({ pressed }) => [
                        styles.swatchFrame,
                        selected && styles.swatchFrameSelected,
                        pressed && styles.pressed,
                      ]}>
                      <View
                        style={[
                          styles.swatch,
                          { backgroundColor: FeedTextPost.backgroundSwatch(key) },
                        ]}>
                        <ThemedText type="smallBold" style={styles.swatchLabel}>
                          Aa
                        </ThemedText>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
      <DraftsSheet
        visible={draftsOpen}
        drafts={draftList}
        onSelect={applyDraft}
        onDelete={removeDraft}
        onNew={newDraft}
        onClose={() => setDraftsOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Gutter,
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topTitle: { fontWeight: '700', color: FeedSurface.onMedia },
  publishLabel: { fontWeight: '700' },
  pagerArea: { flex: 1, justifyContent: 'center', overflow: 'hidden' },
  page: { alignItems: 'center', justifyContent: 'center' },
  card: {
    borderRadius: Radii.lg,
    padding: 20,
    overflow: 'hidden',
  },
  previewCard: {
    justifyContent: 'center',
    gap: Spacing.two,
  },
  previewTitle: {
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '800',
    textAlign: 'center',
  },
  titleBar: {
    paddingHorizontal: Gutter,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleInput: {
    ...Type.body,
    color: FeedSurface.onMedia,
    padding: 0,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  locationInput: {
    ...Type.caption,
    flex: 1,
    color: FeedSurface.onMediaSoft,
    padding: 0,
  },
  locationGps: {
    width: 30,
    height: 30,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FeedSurface.glass,
  },
  placeList: {
    marginTop: Spacing.one,
    borderRadius: Radii.md,
    backgroundColor: FeedSurface.glass,
    overflow: 'hidden',
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  placeText: { ...Type.caption, fontWeight: '600', flexShrink: 1 },
  cardInput: {
    flex: 1,
    textAlign: 'center',
    padding: 0,
  },
  removePage: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    width: 28,
    height: 28,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FeedSurface.glass,
  },
  addPage: {
    position: 'absolute',
    right: Gutter,
    bottom: Spacing.three,
    width: 44,
    height: 44,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FeedSurface.glass,
    borderWidth: 1,
    borderColor: FeedSurface.onMediaFaint,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 22,
    paddingHorizontal: Gutter,
  },
  dots: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  dot: {
    width: 6,
    height: 6,
    borderRadius: Radii.full,
    backgroundColor: FeedSurface.onMediaFaint,
  },
  dotActive: {
    width: 18,
    backgroundColor: FeedSurface.onMedia,
  },
  counter: { color: FeedSurface.onMediaSoft, fontVariant: ['tabular-nums'] },
  hint: {
    color: FeedSurface.onMediaFaint,
    paddingHorizontal: Gutter,
    paddingTop: Spacing.half,
  },
  error: { color: Colors.dark.error, paddingHorizontal: Gutter, paddingTop: Spacing.one },
  suggestions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: FeedSurface.onMediaFaint,
    paddingVertical: Spacing.one,
  },
  suggestionsRow: { gap: Spacing.two, paddingHorizontal: Gutter },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radii.full,
    backgroundColor: FeedSurface.glass,
    maxWidth: 220,
  },
  suggestionText: { color: FeedSurface.onMedia, fontWeight: '600', flexShrink: 1 },
  formatBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingLeft: Spacing.two,
  },
  fonts: { gap: Spacing.two, paddingRight: Spacing.two, alignItems: 'flex-end' },
  fontChip: {
    alignItems: 'center',
    gap: Spacing.half,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radii.md,
    minWidth: 52,
  },
  fontChipSelected: { backgroundColor: FeedSurface.glass },
  fontPreview: { fontSize: 20, fontWeight: '600' },
  fontName: { maxWidth: 64 },
  alignGroup: {
    flexDirection: 'row',
    marginLeft: 'auto',
    marginRight: Spacing.two,
    borderRadius: Radii.full,
    backgroundColor: FeedSurface.glass,
    padding: 3,
    gap: Spacing.half,
  },
  alignChip: {
    width: 34,
    height: 30,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alignChipSelected: { backgroundColor: FeedSurface.glassStrong },
  sizeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: Spacing.two,
    borderRadius: Radii.full,
    backgroundColor: FeedSurface.glass,
    padding: 3,
    gap: Spacing.half,
  },
  sizeChip: {
    minWidth: 30,
    height: 30,
    paddingHorizontal: Spacing.one,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeChipText: { color: FeedSurface.onMedia, fontWeight: '700' },
  sizeValue: {
    minWidth: 34,
    height: 30,
    paddingHorizontal: Spacing.one,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FeedSurface.glassStrong,
  },
  sizeValueText: { color: FeedSurface.onMedia, fontWeight: '700' },
  colorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Gutter,
    paddingTop: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  colorDots: { gap: Spacing.two, paddingRight: Gutter, alignItems: 'center' },
  colorFrame: {
    borderRadius: Radii.full,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: Spacing.half,
  },
  colorFrameSelected: { borderColor: FeedSurface.onMedia },
  colorDot: {
    width: 26,
    height: 26,
    borderRadius: Radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: FeedSurface.onMediaFaint,
  },
  colorDotAuto: {
    backgroundColor: FeedSurface.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorDotAutoLabel: { color: FeedSurface.onMedia, fontSize: 13, fontWeight: '800' },
  previewBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Gutter,
    paddingTop: Spacing.two,
  },
  previewSecondary: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radii.md,
    backgroundColor: FeedSurface.glass,
  },
  previewSecondaryText: { color: FeedSurface.onMedia, fontWeight: '700' },
  backgroundBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Gutter,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  backgroundLabel: { color: FeedSurface.onMediaSoft, fontWeight: '600' },
  swatches: { gap: Spacing.two, paddingRight: Gutter },
  swatchFrame: {
    borderRadius: Radii.md,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchFrameSelected: { borderColor: FeedSurface.onMedia },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchLabel: { color: FeedSurface.onMedia, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
