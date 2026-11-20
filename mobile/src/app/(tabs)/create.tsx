import { router, Stack } from 'expo-router';
import { ArrowLeft, Check, Plus, X } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
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
import { fr } from '@/i18n/fr';
import { invalidateFeedCache } from '@/features/social/feed/use-feed';

/** Bornes alignées sur le DTO (`MAX_TEXT_PAGES`, `MAX_TEXT_PAGE_LENGTH`). */
const MAX_PAGES = 10;
const MAX_PAGE_LENGTH = 2000;

const BACKGROUND_KEYS = Object.keys(FeedTextPost.backgrounds) as (keyof typeof FeedTextPost.backgrounds)[];

/**
 * Compositeur de publication texte : pages multiples (carrousel de cartes)
 * et fond de carte personnalisable. L'aperçu est la zone de saisie elle-même,
 * posée sur la couleur du fond choisi — ce qui est tapé est ce qui sera lu.
 */
export default function CreateScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [pages, setPages] = useState<string[]>(['']);
  const [background, setBackground] = useState<keyof typeof FeedTextPost.backgrounds>('dark');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Même clé tant que l'écran est ouvert : un rejeu après coupure renvoie la
  // publication déjà créée au lieu d'en publier une seconde.
  const clientId = useRef(newClientId());

  const filledPages = useMemo(
    () => pages.map((page) => page.trim()).filter((page) => page.length > 0),
    [pages],
  );
  const canPublish = filledPages.length > 0 && !publishing;

  const updatePage = (index: number, value: string) =>
    setPages((current) => current.map((page, i) => (i === index ? value : page)));

  const addPage = () =>
    setPages((current) => (current.length >= MAX_PAGES ? current : [...current, '']));

  const removePage = (index: number) =>
    setPages((current) =>
      current.length <= 1 ? current : current.filter((_, i) => i !== index),
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
      });
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
          {pages.map((page, index) => (
            <View key={index} style={styles.pageBlock}>
              <View style={styles.pageHeader}>
                <ThemedText type="caption" style={[styles.pageLabel, { color: FeedSurface.onMediaSoft }]}>
                  {fr.social.createPage(index + 1)}
                </ThemedText>
                {pages.length > 1 ? (
                  <Pressable
                    onPress={() => removePage(index)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={fr.social.createRemovePage}>
                    <Icon icon={X} size={16} color={FeedSurface.onMediaSoft} />
                  </Pressable>
                ) : null}
              </View>
              <View style={[styles.pageCard, { backgroundColor: swatch }]}>
                <TextInput
                  value={page}
                  onChangeText={(value) => updatePage(index, value)}
                  placeholder={fr.social.createPlaceholder}
                  placeholderTextColor={FeedSurface.onMediaFaint}
                  multiline
                  maxLength={MAX_PAGE_LENGTH}
                  style={[styles.pageInput, { color: FeedSurface.onMedia }]}
                  accessibilityLabel={fr.social.createPage(index + 1)}
                />
              </View>
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
