import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetFlatList,
  useScrollEventsHandlersDefault,
  type ScrollEventsHandlersHookType,
} from '@gorhom/bottom-sheet';
import { ChevronDown, ImagePlus, MessageCircle, Mic, Smile, X } from 'lucide-react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import {
  ActivityIndicator,
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  UIManager,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { CommentRow } from '@/features/social/publication/comment-row';
import { useCommentLiveEvents } from '@/features/social/publication/use-comment-live';
import {
  appendComment,
  appendReply,
  applyCommentReaction,
  groupComments,
  mergeCommentPage,
  upsertComment,
} from '@/features/social/publication/comments-model';
import { detectAutocompleteToken } from '@/features/social/publication/rich-text';
import { useReportComment } from '@/features/social/publication/use-report-comment';
import { composerThemeFor } from '@/features/composer/ChatComposer';
import { StickerPanel } from '@/features/stickers/StickerPanel';
import { StickerMessage } from '@/features/stickers/StickerView';
import { useTheme } from '@/hooks/use-theme';
import { useThemePreference } from '@/lib/theme-preference';
import { audioAvailable, loadVoice, type VoiceComponents, type VoiceTake } from '@/lib/voice';
import { ApiError, api, type GifResult } from '@/lib/api';
import { CommentGifPanel } from './comment-gif-panel';
import { useAuth } from '@/lib/auth-context';
import { newClientId } from '@/lib/client-id';
import type {
  CommentReactionKind,
  CommentSort,
  FeedPost,
  PublicationComment,
} from '@/lib/types';

/** Hauteur de la feuille : le post réduit reste lisible au-dessus. */
export const COMMENTS_SHEET_SNAP_RATIO = 0.75;

/** Marge minimale sous le composeur quand la barre système ne remonte pas `insets.bottom`. */
const COMPOSER_SYSTEM_BAR_FALLBACK = 48;

const EMOJIS = ['👍', '❤️', '😂', '🎉', '🙏', '🔥', '😮', '👏'];
/** Réactions rapides au-dessus de la saisie, comme Instagram : un tap les insère. */
const QUICK_EMOJIS = ['❤️', '🙌', '🔥', '👏', '😢', '😍', '😮', '😂'];

type AutocompleteSuggestion = {
  value: string;
  displayName: string;
  avatarUrl?: string | null;
  isUser: boolean;
};

/** Pièce jointe en cours de rédaction : média uploadé ou sticker catalogue. */
type PendingAttachment =
  | { kind: 'image' | 'audio'; assetId: string; previewUri: string; durationMs: number | null }
  | { kind: 'sticker'; ref: string };

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

/**
 * Feuille de commentaires de type fil social.
 *
 * Le glissement, le suivi du doigt, les snap points et la fermeture sont gérés
 * par `@gorhom/bottom-sheet` (la même approche que les bottom sheets natives).
 * Le feed reste monté derrière et se réduit, voir `FeedScreen`.
 */
export function CommentsSheet({
  post,
  onClose,
  sheetPosition,
}: {
  post: FeedPost;
  onClose: () => void;
  /** Position Y du bord haut de la feuille, partagée avec le feed réduit. */
  sheetPosition?: SharedValue<number>;
}) {
  const { token, user } = useAuth();
  const theme = useTheme();
  const { scheme } = useThemePreference();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const [current, setCurrent] = useState<FeedPost>(post);
  const [comments, setComments] = useState<PublicationComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const locallyCreatedIds = useRef(new Set<string>());
  const [replyTo, setReplyTo] = useState<PublicationComment | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exprOpen, setExprOpen] = useState(false);
  /** Onglet du panneau d'expressions : stickers & emojis, ou GIF. */
  const [exprTab, setExprTab] = useState<'stickers' | 'gif'>('stickers');
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<CommentSort>('top');
  const [pinned, setPinned] = useState<PublicationComment[]>([]);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [replyBusy, setReplyBusy] = useState<Set<string>>(() => new Set());
  const [newCount, setNewCount] = useState(0);
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  /** `null` = pas d'enregistrement ; sinon le composant vocal est monté. */
  const [voice, setVoice] = useState<VoiceComponents | null>(null);
  /** Enregistrement vocal en cours (maintien du micro). */
  const [recording, setRecording] = useState(false);
  // Partagée avec le handler de scroll worklet : `.value` est lisible sur le
  // thread JS comme sur le runtime UI.
  const scrollY = useSharedValue(0);
  const listRef = useRef<ComponentRef<typeof BottomSheetFlatList>>(null);
  // BottomSheetFlatList retire onScroll/scrollEventThrottle du type : la
  // position de défilement se lit via le hook de handlers de la feuille.
  const scrollEventsHandlersHook = useCallback<ScrollEventsHandlersHookType>(
    (scrollableRef, contentOffsetY) => {
      // Appelé par BottomSheetScrollable pendant son propre rendu : c'est un
      // point d'appel de hook valide, mais le lint ne peut pas le savoir.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const handlers = useScrollEventsHandlersDefault(scrollableRef, contentOffsetY);
      const defaultOnScroll = handlers.handleOnScroll;
      return {
        ...handlers,
        handleOnScroll: (payload, context) => {
          'worklet';
          scrollY.value = payload.contentOffset.y;
          defaultOnScroll?.(payload, context);
        },
      };
    },
    [scrollY],
  );
  const pending = useRef<{
    clientId: string;
    body: string;
    parentId?: string;
    attachmentKey?: string;
  } | null>(null);
  const replyCursors = useRef(new Map<string, string | null>());
  const replyPrefill = useRef<{ parentId: string; text: string } | null>(null);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);

  const grouped = useMemo(() => groupComments(comments), [comments]);
  // Les épinglés sont des racines : ils passent avant les commentaires paginés
  // et bénéficient des mêmes réponses repliables.
  const allRoots = useMemo(() => [...pinned, ...grouped.roots], [pinned, grouped]);

  // Un seul snap « réduit » + un snap « ouvert » : la carte du feed suit la
  // position réelle de la feuille (voir FeedScreen).
  // Clavier ouvert : deux détentes relatives à sa hauteur pour garder le
  // composeur visible sur Waydroid où le clavier recouvre la fenêtre.
  const snapPoints = useMemo(() => {
    if (keyboardHeight > 0) {
      const top = Math.max(240, screenHeight - keyboardHeight);
      return [Math.max(200, top - 120), top];
    }
    return ['45%', `${COMMENTS_SHEET_SNAP_RATIO * 100}%`];
  }, [keyboardHeight, screenHeight]);

  // Le clavier se superpose à la fenêtre sur Waydroid : on remonte la feuille
  // de sa hauteur et on réduit son snap point pour garder le composeur visible.
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  // Tap sur le feed réduit derrière la feuille : elle se ferme.
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        pressBehavior="close"
        opacity={0.3}
      />
    ),
    [],
  );

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const page = await api.comments(token, current.id, { sort });
      setComments(page.items);
      setPinned(page.pinned ?? []);
      setCursor(page.nextCursor);
      setError(null);
      setStatus('ready');
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 404
          ? fr.social.postMissing
          : fr.social.commentsError,
      );
      setStatus('error');
    }
  }, [current.id, sort, token]);

  useEffect(() => {
    // Les états sont posés après la réponse réseau, pas pendant le montage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!token || !cursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await api.comments(token, current.id, { cursor, sort });
      const merged = mergeCommentPage(comments, page);
      setComments(merged.items);
      setPinned(page.pinned ?? []);
      setCursor(merged.nextCursor);
    } catch {
      setError(fr.social.commentsError);
    } finally {
      setLoadingMore(false);
    }
  }, [comments, cursor, current.id, loadingMore, sort, token]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const updateScore = useCallback((commentId: string, score: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const apply = (item: PublicationComment) =>
      item.id === commentId ? { ...item, score } : item;
    setComments((items) =>
      items
        .map(apply)
        .sort(
          (a, b) =>
            b.score - a.score ||
            a.createdAt.localeCompare(b.createdAt) ||
            a.id.localeCompare(b.id),
        ),
    );
    setPinned((items) => items.map(apply));
  }, []);

  /** Envoi effectif d'un commentaire déjà validé (texte et/ou pièce jointe). */
  const postComment = useCallback(
    async (input: {
      clientId: string;
      body: string;
      parentId?: string;
      mediaAssetId?: string;
      voiceMediaAssetId?: string;
      stickerRef?: string;
    }) => {
      const { parentId } = input;
      sendingRef.current = true;
      setSending(true);
      try {
        const created = await api.addComment(token as string, current.id, {
          clientId: input.clientId,
          body: input.body.length > 0 ? input.body : undefined,
          parentId,
          mediaAssetId: input.mediaAssetId,
          voiceMediaAssetId: input.voiceMediaAssetId,
          stickerRef: input.stickerRef,
        });
        locallyCreatedIds.current.add(created.id);
        const replay =
          comments.some((item) => item.id === created.id) ||
          pinned.some((item) => item.id === created.id);
        const replayPinned = pinned.some((item) => item.id === created.id);
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setComments((items) => {
          if (parentId) {
            return appendReply(items, created);
          }
          if (items.some((item) => item.id === created.id)) {
            return appendComment(items, created);
          }
          // En tri « Récents », le nouveau commentaire ouvre le fil.
          return sort === 'recent' ? [created, ...items] : appendComment(items, created);
        });
        if (replayPinned) {
          setPinned((items) => upsertComment(items, created));
        }
        if (parentId && !replay) {
          setExpanded((ids) => new Set(ids).add(parentId));
        }
        if (!replay) {
          setCurrent((value) => ({
            ...value,
            counters: { ...value.counters, comments: value.counters.comments + 1 },
          }));
        }
        setDraft('');
        setReplyTo(null);
        setAttachment(null);
        setExprOpen(false);
        replyPrefill.current = null;
        pending.current = null;
        setError(null);
      } catch {
        setNotice(fr.social.commentError);
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [comments, current.id, pinned, sort, token],
  );

  const send = useCallback(() => {
    const body = draft.trim();
    const mediaAssetId =
      attachment && attachment.kind !== 'sticker' ? attachment.assetId : undefined;
    const stickerRef = attachment?.kind === 'sticker' ? attachment.ref : undefined;
    if (!token || sending || uploading) {
      return;
    }
    if (body.length === 0 && !mediaAssetId && !stickerRef) {
      return;
    }
    const parentId = replyTo?.id;
    const attachmentKey = stickerRef ?? mediaAssetId;
    const reusable =
      pending.current?.body === body &&
      pending.current.parentId === parentId &&
      pending.current.attachmentKey === attachmentKey;
    const clientId = reusable ? (pending.current?.clientId ?? newClientId()) : newClientId();
    pending.current = { clientId, body, parentId, attachmentKey };
    void postComment({ clientId, body, parentId, mediaAssetId, stickerRef });
  }, [attachment, draft, pending, postComment, replyTo, sending, token, uploading]);

  /** Upload d'un média (photo ou vocal) puis attache l'asset au brouillon. */
  const attachMedia = useCallback(
    async (input: { uri: string; kind: 'image' | 'audio'; mime: string; durationMs?: number }) => {
      if (!token || uploading) {
        return;
      }
      setUploading(true);
      setError(null);
      try {
        const asset = await api.uploadSocialMedia(token, input);
        setAttachment({
          kind: input.kind,
          assetId: asset.id,
          previewUri: input.uri,
          durationMs: input.durationMs ?? asset.durationMs ?? null,
        });
      } catch {
        setNotice(fr.social.mediaUploadError);
      } finally {
        setUploading(false);
      }
    },
    [token, uploading],
  );

  const pickPhoto = useCallback(async () => {
    if (!token || uploading) {
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    const picked = result.assets?.[0];
    if (result.canceled || !picked) {
      return;
    }
    await attachMedia({
      uri: picked.uri,
      kind: 'image',
      mime: picked.mimeType ?? 'image/jpeg',
    });
  }, [attachMedia, token, uploading]);

  // Le micro doit répondre au premier appui (maintenir pour parler) : les
  // composants vocaux sont chargés dès l'ouverture de la feuille.
  useEffect(() => {
    let alive = true;
    void loadVoice().then((components) => {
      if (alive) {
        setVoice(components);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Note vocale : le ✓ de l'aperçu enchaîne upload + publication en une
   * seule étape — l'utilisateur n'a plus rien à saisir ni à renvoyer.
   * - Sans pièce jointe : commentaire purement vocal.
   * - Avec photo/sticker : la voix part en `voiceMediaAssetId`, légende du
   *   média, avec le brouillon comme corps du commentaire.
   */
  const sendVoice = useCallback(
    async (take: VoiceTake) => {
      if (!token || sending || uploading) {
        return;
      }
      const pendingAttachment = attachment;
      setUploading(true);
      setError(null);
      try {
        const asset = await api.uploadSocialMedia(token, {
          uri: take.uri,
          kind: 'audio',
          mime: take.mime,
          durationMs: take.durationMs,
        });
        const hasMedia =
          pendingAttachment !== null && pendingAttachment.kind !== 'audio';
        await postComment({
          clientId: newClientId(),
          body: draft.trim(),
          parentId: replyTo?.id,
          mediaAssetId: hasMedia
            ? pendingAttachment.kind !== 'sticker'
              ? pendingAttachment.assetId
              : undefined
            : asset.id,
          voiceMediaAssetId: hasMedia ? asset.id : undefined,
          stickerRef:
            hasMedia && pendingAttachment.kind === 'sticker'
              ? pendingAttachment.ref
              : undefined,
        });
      } catch {
        setNotice(fr.social.mediaUploadError);
      } finally {
        setUploading(false);
      }
    },
    [attachment, draft, postComment, replyTo, sending, token, uploading],
  );

  const finishVoice = useCallback(
    (take: VoiceTake) => {
      void sendVoice(take);
    },
    [sendVoice],
  );

  /**
   * GIF choisi : le serveur l'importe (WebP animée) comme une photo, la
   * vignette du brouillon montre l'aperçu animé.
   */
  const pickGif = useCallback(
    async (gif: GifResult) => {
      if (!token || uploading) {
        return;
      }
      setExprOpen(false);
      setUploading(true);
      try {
        const asset = await api.importGif(token, gif.id);
        setAttachment({ kind: 'image', assetId: asset.id, previewUri: gif.previewUrl, durationMs: null });
      } catch {
        setNotice(fr.social.gifUnavailable);
      } finally {
        setUploading(false);
      }
    },
    [token, uploading],
  );

  /** Sticker catalogue : référence directe, aucun upload nécessaire. */
  const sendStickerRef = useCallback((ref: string) => {
    setAttachment({ kind: 'sticker', ref });
    setExprOpen(false);
  }, []);

  /** Sticker personnel : l'image est importée comme photo de commentaire. */
  const sendPersonalSticker = useCallback(
    (sticker: { uri: string; mime: string }) => {
      setExprOpen(false);
      void attachMedia({ uri: sticker.uri, kind: 'image', mime: sticker.mime });
    },
    [attachMedia],
  );

  const panelTheme = useMemo(() => composerThemeFor(theme, scheme), [theme, scheme]);
  const canRecord = audioAvailable();

  const handleReply = useCallback(
    (target: PublicationComment) => {
      // Une seule ligne de réponses est affichée : on répond toujours au fil racine.
      const root = target.parentId
        ? comments.find((item) => item.id === target.parentId) ?? target
        : target;
      setReplyTo(root);
      // La mention est préremplie et le clavier ouvert.
      const text = `@${root.author.username} `;
      const previous = replyPrefill.current;
      setDraft((current) =>
        current.trim().length === 0 || current === previous?.text ? text : current,
      );
      replyPrefill.current = { parentId: root.id, text };
      // Différé : le focus doit survivre au changement de brouillon et à
      // l'ouverture du clavier de la feuille.
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    [comments],
  );

  /**
   * Charge les réponses d'un fil jusqu'à couvrir `replyCount` (ou épuiser le
   * curseur). Les réponses déjà présentes dans la liste principale sont
   * fusionnées sans doublon ; le curseur par fil est mémorisé.
   */
  const ensureReplies = useCallback(
    async (root: PublicationComment) => {
      if (!token || replyBusy.has(root.id)) {
        return;
      }
      // Curseur par fil : absent = pas commencé, `null` = épuisé.
      if (replyCursors.current.get(root.id) === null) {
        return;
      }
      setReplyBusy((ids) => new Set(ids).add(root.id));
      try {
        // La liste principale couvre déjà une partie du fil : on fusionne dans
        // un accumulateur local pour ne pas perdre les pages déjà chargées.
        let items = comments;
        let cursor: string | null | undefined = replyCursors.current.get(root.id) ?? undefined;
        for (let page = 0; page < 10; page += 1) {
          const loaded = items.filter((item) => item.parentId === root.id).length;
          if (loaded >= root.replyCount || cursor === null) {
            break;
          }
          const result = await api.commentReplies(token, root.id, cursor);
          const merged = mergeCommentPage(items, result);
          items = merged.items;
          cursor = result.nextCursor;
          replyCursors.current.set(root.id, result.nextCursor);
        }
        setComments(items);
      } catch {
        setError(fr.social.commentsError);
      } finally {
        setReplyBusy((ids) => {
          const next = new Set(ids);
          next.delete(root.id);
          return next;
        });
      }
    },
    [comments, replyBusy, token],
  );

  const toggleReplies = useCallback(
    (root: PublicationComment) => {
      const opening = !expanded.has(root.id);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setExpanded((ids) => {
        const next = new Set(ids);
        if (next.has(root.id)) {
          next.delete(root.id);
        } else {
          next.add(root.id);
        }
        return next;
      });
      if (opening) {
        const replies = grouped.repliesByParent.get(root.id) ?? [];
        if (replies.length < root.replyCount) {
          void ensureReplies(root);
        }
      }
    },
    [expanded, grouped, ensureReplies],
  );

  // Miroir à jour des listes pour les handlers temps réel (sinon closures périmées).
  const liveRef = useRef<{ comments: PublicationComment[]; pinned: PublicationComment[] }>({
    comments: [],
    pinned: [],
  });
  useEffect(() => {
    liveRef.current = { comments, pinned };
  }, [comments, pinned]);

  const scoreOrder = (a: PublicationComment, b: PublicationComment) =>
    b.score - a.score || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

  /** Commentaire créé ailleurs : insertion selon le tri, pilule si scrollé. */
  const handleLiveCreated = useCallback(
    (view: PublicationComment) => {
      if (locallyCreatedIds.current.has(view.id)) {
        return;
      }
      if (view.author.id === user?.id && sendingRef.current) {
        return;
      }
      const known = [...liveRef.current.comments, ...liveRef.current.pinned].some(
        (item) => item.id === view.id,
      );
      if (known) {
        return; // notre propre écho REST/socket : déjà inséré par `send`.
      }
      if (scrollY.value > 240) {
        setNewCount((count) => count + 1);
      }
      if (view.parentId) {
        setComments((items) => appendReply(items, view));
        setPinned((items) =>
          items.map((item) =>
            item.id === view.parentId ? { ...item, replyCount: item.replyCount + 1 } : item,
          ),
        );
      } else {
        setComments((items) => {
          // `liveRef` est synchronisé en effet : un écho socket peut arriver
          // entre l'insertion REST et la mise à jour — on re-vérifie ici.
          if (items.some((item) => item.id === view.id)) {
            return items;
          }
          return sort === 'recent' ? [view, ...items] : [...items, view].sort(scoreOrder);
        });
      }
      setCurrent((value) => ({
        ...value,
        counters: { ...value.counters, comments: value.counters.comments + 1 },
      }));
    },
    // `scrollY` est une SharedValue stable : `.value` est lu au moment de l'événement.
    [scrollY, sort, user?.id],
  );

  /** Score, réactions, épinglage ou compteur modifiés ailleurs. */
  const handleLiveUpdated = useCallback(
    (view: PublicationComment) => {
      if (view.pinned) {
        setComments((items) => items.filter((item) => item.id !== view.id));
        setPinned((items) => [view, ...items.filter((item) => item.id !== view.id)]);
        return;
      }
      setPinned((items) => items.filter((item) => item.id !== view.id));
      setComments((items) => {
        const next = upsertComment(items, view);
        // En tri « Mieux notés », un changement de score peut déplacer le commentaire.
        return sort === 'top' && items.some((item) => item.id === view.id)
          ? next.sort(scoreOrder)
          : next;
      });
    },
    [sort],
  );

  /** Suppression distante : le commentaire et ses réponses directes partent. */
  const handleLiveDeleted = useCallback((commentId: string) => {
    const isRemoved = (item: PublicationComment) =>
      item.id === commentId || item.parentId === commentId;
    setComments((items) => items.filter((item) => !isRemoved(item)));
    setPinned((items) => items.filter((item) => !isRemoved(item)));
    const removed = [...liveRef.current.comments, ...liveRef.current.pinned].filter(isRemoved).length;
    if (removed > 0) {
      setCurrent((value) => ({
        ...value,
        counters: {
          ...value.counters,
          comments: Math.max(0, value.counters.comments - removed),
        },
      }));
    }
  }, []);

  useCommentLiveEvents({
    token,
    publicationId: current.id,
    onCreated: handleLiveCreated,
    onUpdated: handleLiveUpdated,
    onDeleted: handleLiveDeleted,
  });

  const scrollToNewest = useCallback(() => {
    setNewCount(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  const report = useReportComment(setNotice);

  /** Réaction emoji : optimiste puis remplacée par la vue serveur. */
  const reactToComment = useCallback(
    async (target: PublicationComment, kind: CommentReactionKind | null) => {
      if (!token) {
        return;
      }
      const optimistic = (item: PublicationComment) =>
        item.id === target.id ? applyCommentReaction(item, kind) : item;
      setComments((items) => items.map(optimistic));
      setPinned((items) => items.map(optimistic));
      try {
        const updated = await api.reactComment(token, target.id, kind);
        const replace = (items: PublicationComment[]) =>
          items.some((item) => item.id === updated.id) ? upsertComment(items, updated) : items;
        setComments(replace);
        setPinned(replace);
      } catch {
        setError(fr.social.commentActionError);
      }
    },
    [token],
  );

  /** Épingle/désépingle : le commentaire change de liste (flux ↔ tête). */
  const togglePin = useCallback(
    async (target: PublicationComment, pinnedFlag: boolean) => {
      if (!token) {
        return;
      }
      try {
        const updated = await api.pinComment(token, target.id, pinnedFlag);
        setComments((items) => items.filter((item) => item.id !== target.id));
        setPinned((items) => {
          const rest = items.filter((item) => item.id !== target.id);
          return updated.pinned ? [updated, ...rest] : rest;
        });
        if (!updated.pinned) {
          // Désépinglé : il reprend sa place dans le flux, triée par score.
          setComments((items) =>
            [...items, updated].sort(
              (a, b) =>
                b.score - a.score ||
                a.createdAt.localeCompare(b.createdAt) ||
                a.id.localeCompare(b.id),
            ),
          );
        }
      } catch {
        setNotice(fr.social.commentActionError);
      }
    },
    [token],
  );

  const changeSort = useCallback(
    (next: CommentSort) => {
      setSortSheetOpen(false);
      if (next === sort) {
        return;
      }
      // Le curseur encode le tri : on repart de zéro pour éviter un refus.
      replyCursors.current.clear();
      setCursor(null);
      setSort(next);
    },
    [sort],
  );

  useEffect(() => {
    const active = detectAutocompleteToken(draft);
    if (!token || !active || active.query.length === 0) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await api.search(
          token,
          active.query,
          active.kind === 'mention' ? 'users' : 'hashtags',
        );
        if (cancelled) {
          return;
        }
        setSuggestions(
          active.kind === 'mention'
            ? result.users.items.slice(0, 4).map((item) => ({
                value: `@${item.username}`,
                displayName: item.displayName,
                avatarUrl: item.avatarUrl,
                isUser: true,
              }))
            : result.hashtags.items.slice(0, 4).map((item) => ({
                value: `#${item.tag}`,
                displayName: `#${item.tag}`,
                isUser: false,
              })),
        );
      } catch {
        if (!cancelled) {
          setSuggestions([]);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, token]);

  const handleDraftChange = useCallback((value: string) => {
    setDraft(value);
    const active = detectAutocompleteToken(value);
    if (!active || active.query.length === 0) {
      setSuggestions([]);
    }
  }, []);

  const insertSuggestion = useCallback(
    (value: string) => {
      const active = detectAutocompleteToken(draft);
      setDraft(active ? `${draft.slice(0, active.start)}${value} ` : `${draft}${value} `);
      setSuggestions([]);
    },
    [draft],
  );

  const insertEmoji = useCallback((emoji: string) => {
    setDraft((value) => value + emoji);
  }, []);

  const repliesCount = useMemo(
    () => [...grouped.repliesByParent.values()].reduce((total, items) => total + items.length, 0),
    [grouped],
  );

  const toggleAllReplies = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((current) =>
      current.size > 0
        ? new Set()
        : new Set(
            allRoots
              .filter((root) => grouped.repliesByParent.has(root.id))
              .map((root) => root.id),
          ),
    );
  }, [allRoots, grouped]);

  const isPublicationAuthor = user?.id === current.author.id;

  const sortActions: SheetAction[] = [
    {
      key: 'top',
      label: fr.social.commentsSortTop,
      selected: sort === 'top',
      onPress: () => changeSort('top'),
    },
    {
      key: 'recent',
      label: fr.social.commentsSortRecent,
      selected: sort === 'recent',
      onPress: () => changeSort('recent'),
    },
  ];

  // Les confirmations (copie, signalement, suppression) sont éphémères.
  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const deleteComment = useCallback(
    async (comment: PublicationComment) => {
      if (!token) {
        return;
      }
      try {
        await api.deleteComment(token, comment.id);
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        const isRemoved = (item: PublicationComment) =>
          item.id === comment.id || item.parentId === comment.id;
        setComments((items) => items.filter((item) => !isRemoved(item)));
        setPinned((items) => items.filter((item) => !isRemoved(item)));
        const removed = [...comments, ...pinned].filter(isRemoved).length;
        setCurrent((value) => ({
          ...value,
          counters: {
            ...value.counters,
            comments: Math.max(0, value.counters.comments - removed),
          },
        }));
        setNotice(fr.social.commentDeleted);
      } catch {
        setNotice(fr.social.commentDeleteError);
      }
    },
    [comments, pinned, token],
  );

  return (
    <>
    <BottomSheet
      index={1}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableDynamicSizing={false}
      onClose={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={{
        backgroundColor: theme.backgroundElement,
        borderTopLeftRadius: Radii.sheet,
        borderTopRightRadius: Radii.sheet,
      }}
      handleIndicatorStyle={{ backgroundColor: theme.textSecondary }}
      containerStyle={{ transform: [{ translateY: -keyboardHeight }] }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      animatedPosition={sheetPosition}>
      {/* En-tête hors de la liste : il reste fixe pendant le défilement. */}
      <View style={styles.header}>
        {repliesCount > 0 ? (
          <Pressable
            onPress={toggleAllReplies}
            hitSlop={6}
            accessibilityRole="button"
            style={styles.headerSide}>
            <ThemedText type="caption" themeColor="textSecondary">
              {expanded.size > 0 ? fr.social.collapseAllReplies : fr.social.expandAllReplies}
            </ThemedText>
          </Pressable>
        ) : (
          <View style={styles.headerSide} />
        )}
        <ThemedText type="sectionTitle">
          {fr.social.commentsCount(current.counters.comments)}
        </ThemedText>
        <View style={styles.headerRight}>
          <Pressable
            onPress={() => setSortSheetOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              sort === 'top' ? fr.social.commentsSortTop : fr.social.commentsSortRecent
            }
            style={styles.sortButton}>
            <ThemedText type="caption" themeColor="textSecondary">
              {sort === 'top' ? fr.social.commentsSortTop : fr.social.commentsSortRecent}
            </ThemedText>
            <ChevronDown size={12} color={theme.textSecondary} />
          </Pressable>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={fr.common.close}
            style={styles.close}>
            <X size={20} color={theme.text} />
          </Pressable>
        </View>
      </View>

      <BottomSheetFlatList
          ref={listRef}
          data={allRoots}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEventsHandlersHook={scrollEventsHandlersHook}
          // La liste occupe toute la hauteur restante : la barre de saisie
          // reste collée en bas de la feuille, comme TikTok, même avec peu
          // de commentaires.
          style={styles.listFill}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={theme.accent}
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.center}>
                <ActivityIndicator color={theme.accent} size="small" />
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            status === 'loading' && comments.length === 0 ? (
              <View style={styles.center}>
                <ActivityIndicator color={theme.accent} />
              </View>
            ) : status === 'error' && comments.length === 0 ? (
              <View style={styles.center}>
                <ThemedText type="small" style={{ color: theme.danger }}>
                  {error}
                </ThemedText>
                <Pressable onPress={() => void load()} hitSlop={8} accessibilityRole="button">
                  <ThemedText type="small" style={{ color: theme.accent, marginTop: Spacing.two }}>
                    {fr.common.retry}
                  </ThemedText>
                </Pressable>
              </View>
            ) : (
              <View style={styles.center}>
                <MessageCircle size={36} color={theme.textSecondary} />
                <ThemedText type="sectionTitle">{fr.social.commentsEmptyTitle}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {fr.social.commentsEmptyHint}
                </ThemedText>
              </View>
            )
          }
          renderItem={({ item }) => {
            const replies = grouped.repliesByParent.get(item.id) ?? [];
            const open = expanded.has(item.id);
            return (
              <View>
                <CommentRow
                  comment={item}
                  onReply={handleReply}
                  onReport={report.open}
                  onDelete={(target) => void deleteComment(target)}
                  onNotice={setNotice}
                  onScoreChange={updateScore}
                  onPin={(target, pinnedFlag) => void togglePin(target, pinnedFlag)}
                  onReact={(target, kind) => void reactToComment(target, kind)}
                  isPublicationAuthor={isPublicationAuthor}
                  pinLimitReached={pinned.length >= 3 && !item.pinned}
                  publicationAuthorId={current.author.id}
                />
                {replies.length > 0 ? (
                  <Pressable
                    onPress={() => toggleReplies(item)}
                    accessibilityRole="button"
                    style={styles.repliesToggle}>
                    <ThemedText type="caption" themeColor="textSecondary">
                      {open
                        ? fr.social.hideReplies
                        : fr.social.viewReplies(Math.max(item.replyCount, replies.length))}
                    </ThemedText>
                  </Pressable>
                ) : null}
                {open
                  ? replies.map((reply) => (
                      <CommentRow
                        key={reply.id}
                        comment={reply}
                        onReply={handleReply}
                        onReport={report.open}
                        onDelete={(target) => void deleteComment(target)}
                        onNotice={setNotice}
                        onScoreChange={updateScore}
                        onReact={(target, kind) => void reactToComment(target, kind)}
                        publicationAuthorId={current.author.id}
                        indented
                      />
                    ))
                  : null}
                {open && replies.length < item.replyCount ? (
                  <Pressable
                    onPress={() => void ensureReplies(item)}
                    disabled={replyBusy.has(item.id)}
                    accessibilityRole="button"
                    style={styles.repliesToggle}>
                    {replyBusy.has(item.id) ? (
                      <ActivityIndicator color={theme.accent} size="small" />
                    ) : (
                      <ThemedText type="caption" themeColor="textSecondary">
                        {fr.social.loadMoreReplies}
                      </ThemedText>
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          }}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
        />

      {notice ? (
        <View style={[styles.notice, { backgroundColor: theme.accentSoft }]}>
          <ThemedText type="caption" style={{ color: theme.accent }}>
            {notice}
          </ThemedText>
          <Pressable onPress={() => setNotice(null)} hitSlop={8} accessibilityRole="button">
            <X size={14} color={theme.accent} />
          </Pressable>
        </View>
      ) : null}

      {newCount > 0 ? (
        <Pressable
          onPress={scrollToNewest}
          accessibilityRole="button"
          style={[styles.newPill, { backgroundColor: theme.accent }]}
          hitSlop={6}>
          <ThemedText type="caption" style={{ color: theme.onAccent, fontWeight: '700' }}>
            {fr.social.newComments(newCount)}
          </ThemedText>
        </Pressable>
      ) : null}

      {replyTo ? (
        <View style={[styles.replyBanner, { borderTopColor: theme.border }]}>
          <ThemedText type="caption" themeColor="textSecondary">
            {fr.social.replyingTo(replyTo.author.displayName)}
          </ThemedText>
          <Pressable
            onPress={() => setReplyTo(null)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={fr.common.close}>
            <X size={14} color={theme.textSecondary} />
          </Pressable>
        </View>
      ) : null}

      {suggestions.length > 0 ? (
        <View style={[styles.suggestions, { borderTopColor: theme.border }]}>
          {suggestions.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => insertSuggestion(item.value)}
              accessibilityRole="button"
              style={styles.suggestionRow}>
              {item.isUser ? (
                <Avatar name={item.displayName} uri={item.avatarUrl} size={32} shape="rounded" />
              ) : (
                <View
                  style={[styles.hashtagAvatar, { backgroundColor: theme.backgroundSelected }]}>
                  <ThemedText style={{ color: theme.accent }}>#</ThemedText>
                </View>
              )}
              <ThemedText type="small">{item.displayName}</ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}


      {current.commentsDisabled && !isPublicationAuthor ? (
        /* L'auteur a coupé les commentaires : pas de barre de saisie. */
        <View
          style={[
            styles.composerShell,
            styles.commentsOff,
            {
              borderTopColor: theme.border,
              backgroundColor: theme.backgroundElement,
              paddingBottom: Math.max(insets.bottom, COMPOSER_SYSTEM_BAR_FALLBACK),
            },
          ]}>
          <ThemedText type="small" themeColor="textSecondary">
            {fr.social.commentsDisabledNotice}
          </ThemedText>
        </View>
      ) : (
      <View
        style={[
          styles.composerShell,
          {
            borderTopColor: theme.border,
            backgroundColor: theme.backgroundElement,
            paddingBottom: exprOpen ? Spacing.two : Math.max(insets.bottom, COMPOSER_SYSTEM_BAR_FALLBACK),
          },
        ]}>
        {/* Emojis rapides (Instagram) : masqués pendant l'enregistrement et
            quand le panneau d'expressions est ouvert. */}
        {!exprOpen && !recording ? (
          <View style={styles.quickEmojis}>
            {QUICK_EMOJIS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => insertEmoji(emoji)}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={emoji}
                style={({ pressed }) => pressed && styles.quickEmojiPressed}>
                <ThemedText style={styles.quickEmoji}>{emoji}</ThemedText>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Pièce jointe en attente : vignette au-dessus de la pilule. */}
        {attachment ? (
          <View style={styles.previewRow}>
            <AttachmentPreview attachment={attachment} onRemove={() => setAttachment(null)} />
            <ThemedText type="caption" themeColor="textSecondary" style={styles.previewHint}>
              {fr.social.commentAttachmentHint}
            </ThemedText>
          </View>
        ) : null}

        {/* Une seule rangée, comme Instagram : avatar · pilule [texte … 📷 😊]
            · micro à maintenir (Snapchat) ou « Publier ». */}
        <View style={styles.composer}>
          <Avatar
            name={user?.displayName ?? ''}
            uri={user?.avatarUrl}
            gender={user?.gender}
            size={32}
          />
          <View
            style={[
              styles.inputWrap,
              { backgroundColor: theme.backgroundSelected, borderColor: theme.border },
            ]}>
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={handleDraftChange}
              placeholder={
                replyTo
                  ? fr.social.replyPlaceholder(replyTo.author.displayName)
                  : fr.social.commentPlaceholderFor(current.author.displayName)
              }
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text }]}
              maxLength={1000}
              multiline
              onFocus={() => setExprOpen(false)}
              accessibilityLabel={fr.social.commentPlaceholder}
            />
            {/* Photo et expressions dans la pilule, à droite. */}
            {draft.trim().length === 0 ? (
              <Pressable
                onPress={() => void pickPhoto()}
                disabled={uploading || sending}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={fr.social.commentPhoto}
                style={styles.pillAction}>
                <ImagePlus size={20} color={theme.textSecondary} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                setExprOpen((value) => !value);
              }}
              disabled={uploading || sending}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={fr.social.commentSticker}
              accessibilityState={{ selected: exprOpen }}
              style={styles.pillAction}>
              <Smile size={20} color={exprOpen ? theme.accent : theme.textSecondary} />
            </Pressable>
          </View>

          {/* À droite : « Publier » dès qu'il y a quelque chose à envoyer,
              sinon le micro à maintenir. */}
          {sending || uploading ? (
            <View style={styles.trailing}>
              <ActivityIndicator color={theme.accent} size="small" />
            </View>
          ) : draft.trim().length > 0 || attachment ? (
            <Pressable
              onPress={() => void send()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={fr.social.commentSend}
              style={styles.trailing}>
              <ThemedText style={[styles.publish, { color: theme.accent }]}>
                {fr.social.commentSend}
              </ThemedText>
            </Pressable>
          ) : voice ? (
            <voice.HoldToRecord
              onSend={finishVoice}
              onActiveChange={setRecording}
              onHint={() => setNotice(fr.social.voiceHoldHint)}
            />
          ) : canRecord ? (
            <View style={styles.trailing}>
              <ActivityIndicator color={theme.textSecondary} size="small" />
            </View>
          ) : null}
        </View>
        {draft.length > 900 ? (
          <ThemedText type="caption" themeColor="textSecondary" style={styles.charCount}>
            {draft.length}/1000
          </ThemedText>
        ) : null}
      </View>
      )}

      {exprOpen ? (
        /* Panneau d'expressions : rangée d'emojis puis stickers — la pilule
           de saisie reste épurée, sans icône 😊. */
        <View style={{ backgroundColor: panelTheme.panelBg, paddingBottom: insets.bottom }}>
          {/* Onglets : Stickers & emojis | GIF (Instagram). */}
          <View style={styles.exprTabs}>
            {(['stickers', 'gif'] as const).map((tab) => (
              <Pressable
                key={tab}
                onPress={() => setExprTab(tab)}
                accessibilityRole="tab"
                accessibilityState={{ selected: exprTab === tab }}
                style={[
                  styles.exprTab,
                  exprTab === tab && { backgroundColor: theme.backgroundSelected },
                ]}>
                <ThemedText type="small" style={styles.exprTabText}>
                  {tab === 'gif' ? 'GIF' : fr.social.exprStickers}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          {exprTab === 'gif' && token ? (
            <CommentGifPanel token={token} height={300} onPick={(gif) => void pickGif(gif)} />
          ) : (
          <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.emojiRail}
            keyboardShouldPersistTaps="handled">
            {EMOJIS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => insertEmoji(emoji)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={emoji}>
                <ThemedText style={styles.emoji}>{emoji}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
          <StickerPanel
            height={240}
            theme={panelTheme}
            onSendRef={sendStickerRef}
            onSendPersonal={sendPersonalSticker}
          />
          </>
          )}
        </View>
      ) : null}
    </BottomSheet>
    {report.sheet}
    <ActionSheet
      visible={sortSheetOpen}
      title={fr.social.commentsTitle}
      actions={sortActions}
      onClose={() => setSortSheetOpen(false)}
    />
    </>
  );
}

/** Vignette 44 px d'une pièce jointe en cours, avec badge de retrait. */
function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onRemove}
      accessibilityRole="button"
      accessibilityLabel={fr.common.remove}
      style={styles.previewWrap}>
      {attachment.kind === 'image' ? (
        <Image
          source={{ uri: attachment.previewUri }}
          style={styles.previewThumb}
          contentFit="cover"
        />
      ) : attachment.kind === 'sticker' ? (
        <View style={styles.previewSticker}>
          <StickerMessage stickerRef={attachment.ref} size={34} />
        </View>
      ) : (
        <View
          style={[
            styles.previewThumb,
            styles.previewAudio,
            { backgroundColor: theme.backgroundSelected },
          ]}>
          <Mic size={18} color={theme.textSecondary} />
        </View>
      )}
      <View
        style={[
          styles.previewBadge,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        <X size={11} color={theme.text} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  exprTabs: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  exprTab: { borderRadius: Radii.full, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  exprTabText: { fontWeight: '700' },
  quickEmojis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  quickEmoji: { fontSize: 24, lineHeight: 30 },
  quickEmojiPressed: { transform: [{ scale: 1.2 }] },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  headerSide: { position: 'absolute', left: Spacing.three },
  headerRight: {
    position: 'absolute',
    right: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  sortButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  close: { padding: Spacing.one },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  listFill: { flex: 1 },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, flexGrow: 1 },
  repliesToggle: { paddingLeft: 42, paddingTop: Spacing.half, paddingBottom: Spacing.one },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  newPill: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 76,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.full,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  suggestions: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  hashtagAvatar: {
    width: 32,
    height: 32,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 22 },
  emojiRail: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  charCount: { textAlign: 'right', paddingHorizontal: Spacing.three },
  composerShell: {
    borderTopWidth: 1,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    // Alignée sur le bord gauche de la pilule : avatar (34) + marges.
    paddingLeft: Spacing.three * 2 + 34 + Spacing.two,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.half,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    // Aligné sur la pilule : marge + avatar (32) + écart.
    paddingLeft: Spacing.three + 32 + Spacing.two,
    paddingRight: Spacing.three,
    paddingTop: Spacing.two,
  },
  previewWrap: {
    width: 44,
    height: 44,
  },
  previewSticker: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewAudio: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  voicePreviewRow: {
    flexDirection: 'row',
    marginBottom: Spacing.two,
  },
  previewThumb: {
    width: 44,
    height: 44,
    borderRadius: Radii.md,
  },
  previewBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
    // Ancre de la bande d'enregistrement (position absolue).
    position: 'relative',
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingRight: Spacing.one,
    minHeight: 40,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 110,
    paddingHorizontal: Spacing.three,
    paddingTop: Platform.OS === 'ios' ? 11 : 8,
    paddingBottom: Platform.OS === 'ios' ? 11 : 8,
    fontSize: 15,
    lineHeight: 20,
  },
  inputEmoji: {
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
    paddingBottom: Spacing.two,
  },
  composerAction: { justifyContent: 'center', padding: Spacing.one },
  commentsOff: { alignItems: 'center', paddingTop: Spacing.three },
  pillAction: { height: 40, paddingHorizontal: Spacing.one + 2, justifyContent: 'center' },
  trailing: { minWidth: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  publish: { fontWeight: '700', fontSize: 15 },
  previewHint: { flex: 1 },
});
