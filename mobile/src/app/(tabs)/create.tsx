import { router, Stack } from 'expo-router';
import { ArrowLeft, Check, Plus, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Colors, FeedTextPost, FeedSurface, Radii, Spacing, Type } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { newClientId } from '@/lib/client-id';
import { clearTextDraft, loadTextDraft, saveTextDraft } from '@/lib/text-draft';
import { fr } from '@/i18n/fr';
import { invalidateFeedCache } from '@/features/social/feed/use-feed';

/** Bornes alignées sur le DTO (`MAX_TEXT_PAGES`, `MAX_TEXT_PAGE_LENGTH`). */
const MAX_PAGES = 10;
const MAX_PAGE_LENGTH = 2000;
/** Délai d'inactivité avant sauvegarde du brouillon. */
const DRAFT_SAVE_DELAY_MS = 600;
/** Au-delà de ce seuil le compteur passe en avertissement. */
const PAGE_LENGTH_WARNING = Math.floor(MAX_PAGE_LENGTH * 0.9);

/** Visibilités acceptées par l'API (`VISIBILITIES` du DTO). */
type Visibility = 'public' | 'followers' | 'private';
const VISIBILITY_OPTIONS: { key: Visibility; label: string }[] = [
  { key: 'public', label: fr.social.createVisibilityPublic },
  { key: 'followers', label: fr.social.createVisibilityFollowers },
  { key: 'private', label: fr.social.createVisibilityPrivate },
];

/** Page du compositeur : l'identifiant sert de clé React stable. */
type ComposerPage = { id: number; text: string };

const BACKGROUND_KEYS = Object.keys(FeedTextPost.backgrounds) as (keyof typeof FeedTextPost.backgrounds)[];

/**
 * Compositeur de publication texte : pages multiples (carrousel de cartes)
 * et fond de carte personnalisable. L'aperçu est la zone de saisie elle-même,
 * posée sur la couleur du fond choisi — ce qui est tapé est ce qui sera lu.
 */
export default function CreateScreen() {
  const { token, user } = useAuth();
  const userId = user?.id ?? null;
  const insets = useSafeAreaInsets();

  // Chaque page porte un identifiant stable : la clé React ne dépend plus de
  // la position, donc supprimer une page ne décale ni le texte ni le focus
  // des champs suivants.
  const nextPageId = useRef(1);
  const [pages, setPages] = useState<ComposerPage[]>([{ id: 0, text: '' }]);
  const [background, setBackground] = useState<keyof typeof FeedTextPost.backgrounds>('dark');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Même clé tant que l'écran est ouvert : un rejeu après coupure renvoie la
  // publication déjà créée au lieu d'en publier une seconde.
  const clientId = useRef(newClientId());
  // Le brouillon n'est sauvegardé qu'une fois la restauration terminée, pour
  // ne pas écraser un brouillon existant par l'état vide initial.
  const [draftReady, setDraftReady] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  useEffect(() => {
    if (!userId) {
      return;
    }
    let cancelled = false;
    void loadTextDraft(userId).then((draft) => {
      if (cancelled) {
        return;
      }
      if (draft && draft.pages.length > 0) {
        const restored = draft.pages.slice(0, MAX_PAGES).map((text, i) => ({ id: i, text }));
        nextPageId.current = restored.length;
        setPages(restored);
        if (draft.background in FeedTextPost.backgrounds) {
          setBackground(draft.background as keyof typeof FeedTextPost.backgrounds);
        }
        setVisibility(draft.visibility);
        clientId.current = draft.clientId;
        setDraftRestored(true);
      }
      setDraftReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !draftReady || publishing) {
      return;
    }
    const timer = setTimeout(() => {
      void saveTextDraft(userId, {
        pages: pages.map((page) => page.text),
        background,
        visibility,
        clientId: clientId.current,
      });
    }, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [userId, draftReady, publishing, pages, background, visibility]);

  const discardDraft = () => {
    if (userId) {
      void clearTextDraft(userId);
    }
    nextPageId.current = 1;
    setPages([{ id: 0, text: '' }]);
    setBackground('dark');
    setVisibility('public');
    clientId.current = newClientId();
    setDraftRestored(false);
  };

  const filledPages = useMemo(
    () => pages.map((page) => page.text.trim()).filter((page) => page.length > 0),
    [pages],
  );
  const canPublish = filledPages.length > 0 && !publishing;

  const updatePage = (id: number, value: string) =>
    setPages((current) =>
      current.map((page) => (page.id === id ? { ...page, text: value } : page)),
    );

  const addPage = () =>
    setPages((current) =>
      current.length >= MAX_PAGES
        ? current
        : [...current, { id: nextPageId.current++, text: '' }],
    );

  const removePage = (id: number) =>
    setPages((current) =>
      current.length <= 1 ? current : current.filter((page) => page.id !== id),
    );

  const publish = async () => {
    if (!token || !canPublish) {
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      await api.createPublication(token, {
        clientId: clientId.current,
        // Une seule page = publication classique (`caption`) ; plusieurs =
        // `textPages`, le serveur en déduit la légende (première page).
        ...(filledPages.length > 1
          ? { textPages: filledPages }
          : { caption: filledPages[0] }),
        textBackground: background,
        visibility,
      });
      if (userId) {
        await clearTextDraft(userId);
      }
      invalidateFeedCache(token);
      router.back();
    } catch {
      setError(fr.social.createPublishError);
      setPublishing(false);
    }
  };

  const swatch = FeedTextPost.backgroundSwatch(background);

  return (
    // Compositeur volontairement sombre, comme le fil : l'aperçu des pages
    // doit correspondre au rendu réel quelle que soit le thème de l'app.
    <View style={[styles.screen, { backgroundColor: FeedSurface.background }]}>
      <Stack.Screen options={{ headerShown: false, statusBarStyle: 'light' }} />
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top + Spacing.two,
            borderBottomColor: FeedSurface.onMediaFaint,
          },
        ]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={fr.social.back}>
          <Icon icon={ArrowLeft} size={22} color={FeedSurface.onMedia} />
        </Pressable>
        <ThemedText style={[Type.body, styles.topTitle, { color: FeedSurface.onMedia }]}>
          {fr.social.createHeader}
        </ThemedText>
        <Pressable
          onPress={() => void publish()}
          disabled={!canPublish}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={fr.social.createPublish}
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
              {fr.social.createPublish}
            </ThemedText>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.pagesList}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {draftRestored ? (
            <View style={[styles.draftBanner, { borderColor: FeedSurface.onMediaFaint }]}>
              <ThemedText type="caption" style={{ color: FeedSurface.onMediaSoft, flex: 1 }}>
                {fr.social.createDraftRestored}
              </ThemedText>
              <Pressable
                onPress={discardDraft}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={fr.social.createDraftDiscard}>
                <ThemedText type="caption" style={[styles.draftDiscard, { color: FeedSurface.accent }]}>
                  {fr.social.createDraftDiscard}
                </ThemedText>
              </Pressable>
            </View>
          ) : null}
          {pages.map((page, index) => (
            <View key={page.id} style={styles.pageBlock}>
              <View style={styles.pageHeader}>
                <ThemedText type="caption" style={[styles.pageLabel, { color: FeedSurface.onMediaSoft }]}>
                  {fr.social.createPage(index + 1)}
                </ThemedText>
                {pages.length > 1 ? (
                  <Pressable
                    onPress={() => removePage(page.id)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={fr.social.createRemovePage}>
                    <Icon icon={X} size={16} color={FeedSurface.onMediaSoft} />
                  </Pressable>
                ) : null}
              </View>
              <View style={[styles.pageCard, { backgroundColor: swatch }]}>
                <TextInput
                  value={page.text}
                  onChangeText={(value) => updatePage(page.id, value)}
                  placeholder={fr.social.createPlaceholder}
                  placeholderTextColor={FeedSurface.onMediaFaint}
                  multiline
                  maxLength={MAX_PAGE_LENGTH}
                  style={[styles.pageInput, { color: FeedSurface.onMedia }]}
                  accessibilityLabel={fr.social.createPage(index + 1)}
                />
              </View>
              <ThemedText
                type="caption"
                accessibilityLabel={fr.social.createCharCountA11y(MAX_PAGE_LENGTH - page.text.length)}
                style={[
                  styles.charCount,
                  {
                    color:
                      page.text.length >= MAX_PAGE_LENGTH
                        ? Colors.dark.error
                        : page.text.length >= PAGE_LENGTH_WARNING
                          ? FeedSurface.accent
                          : FeedSurface.onMediaFaint,
                  },
                ]}>
                {fr.social.createCharCount(page.text.length, MAX_PAGE_LENGTH)}
              </ThemedText>
            </View>
          ))}

          {pages.length < MAX_PAGES ? (
            <Pressable
              onPress={addPage}
              accessibilityRole="button"
              accessibilityLabel={fr.social.createAddPage}
              style={({ pressed }) => [
                styles.addPage,
                { borderColor: FeedSurface.onMediaFaint },
                pressed && styles.pressed,
              ]}>
              <Icon icon={Plus} size={18} color={FeedSurface.accent} />
              <ThemedText style={[Type.body, { color: FeedSurface.accent }]}>
                {fr.social.createAddPage}
              </ThemedText>
            </Pressable>
          ) : null}

          {error ? (
            <ThemedText type="caption" style={{ color: Colors.dark.error }}>
              {error}
            </ThemedText>
          ) : null}
        </ScrollView>

        {/* Visibilité : mêmes valeurs que le DTO, public par défaut. */}
        <View
          style={[styles.visibilityBar, { borderTopColor: FeedSurface.onMediaFaint }]}
          accessibilityRole="radiogroup"
          accessibilityLabel={fr.social.createVisibility}>
          <ThemedText type="caption" style={[styles.backgroundLabel, { color: FeedSurface.onMediaSoft }]}>
            {fr.social.createVisibility}
          </ThemedText>
          <View style={styles.visibilityOptions}>
            {VISIBILITY_OPTIONS.map((option) => {
              const selected = option.key === visibility;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setVisibility(option.key)}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                  style={[
                    styles.visibilityChip,
                    { borderColor: selected ? FeedSurface.accent : FeedSurface.onMediaFaint },
                    selected && { backgroundColor: FeedSurface.accent },
                  ]}>
                  <ThemedText
                    type="caption"
                    style={[
                      styles.visibilityLabel,
                      { color: selected ? FeedSurface.background : FeedSurface.onMediaSoft },
                    ]}>
                    {option.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Fonds de carte : pastilles aux couleurs des palettes persistées. */}
        <View
          style={[
            styles.backgroundBar,
            {
              borderTopColor: FeedSurface.onMediaFaint,
              paddingBottom: insets.bottom + Spacing.two,
            },
          ]}>
          <ThemedText type="caption" style={[styles.backgroundLabel, { color: FeedSurface.onMediaSoft }]}>
            {fr.social.createBackground}
          </ThemedText>
          <View style={styles.swatches}>
            {BACKGROUND_KEYS.map((key) => {
              const selected = key === background;
              return (
                <Pressable
                  key={key}
                  onPress={() => setBackground(key)}
                  accessibilityRole="button"
                  accessibilityLabel={fr.social.createBackground}
                  accessibilityState={{ selected }}
                  style={[
                    styles.swatch,
                    { backgroundColor: FeedTextPost.backgroundSwatch(key) },
                    selected && styles.swatchSelected,
                  ]}>
                  {selected ? (
                    <Icon icon={Check} size={14} color={FeedSurface.onMedia} strokeWidth={3} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topTitle: { fontWeight: '700' },
  publishLabel: { fontWeight: '700' },
  pagesList: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  pageBlock: { gap: Spacing.one },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageLabel: { fontWeight: '600' },
  pageCard: {
    borderRadius: Radii.lg,
    minHeight: 140,
    padding: Spacing.three,
  },
  pageInput: {
    ...Type.body,
    fontSize: 17,
    lineHeight: 25,
    // Centré comme dans la carte du fil : ce qui est tapé est ce qui est lu.
    textAlign: 'center',
    textAlignVertical: 'top',
    minHeight: 120,
  },
  addPage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radii.lg,
    paddingVertical: Spacing.three,
  },
  backgroundBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  backgroundLabel: { fontWeight: '600' },
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  draftDiscard: { fontWeight: '700' },
  charCount: { alignSelf: 'flex-end', fontVariant: ['tabular-nums'] },
  visibilityBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  visibilityOptions: { flexDirection: 'row', gap: Spacing.two },
  visibilityChip: {
    borderWidth: 1,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  visibilityLabel: { fontWeight: '600' },
  swatches: { flexDirection: 'row', gap: Spacing.two },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchSelected: {
    borderWidth: 2,
    borderColor: FeedSurface.onMedia,
  },
  pressed: { opacity: 0.7 },
});