import { Image } from 'expo-image';
import { Search, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { api, type GifResult } from '@/lib/api';

const COLUMNS = 2;
const GAP = 4;

/**
 * Onglet GIF de la feuille commentaires, comme Instagram / TikTok :
 * tendances à l'ouverture, recherche au fil de la frappe, grille en
 * maçonnerie simple (2 colonnes, ratio d'origine). Un tap choisit le GIF.
 * Les requêtes passent par l'API : la clé GIPHY ne quitte jamais le serveur.
 */
export function CommentGifPanel({
  token,
  height,
  onPick,
}: {
  token: string;
  height: number;
  onPick: (gif: GifResult) => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<GifResult[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const cell = (width - Spacing.three * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

  const load = useCallback(
    async (q: string, offset: number) => {
      const id = ++request.current;
      setLoading(true);
      setFailed(false);
      try {
        const page = await api.searchGifs(token, q, offset);
        if (id !== request.current) return;
        setItems((current) => (offset === 0 ? page.items : [...current, ...page.items]));
        setNextOffset(page.nextOffset);
      } catch {
        if (id === request.current) {
          setFailed(true);
          if (offset === 0) setItems([]);
        }
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [token],
  );

  // Recherche « au fil de la frappe », avec un court délai.
  useEffect(() => {
    const timer = setTimeout(() => void load(query, 0), query ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  return (
    <View style={{ height }}>
      <View style={[styles.search, { backgroundColor: theme.backgroundSelected }]}>
        <Search size={16} color={theme.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={fr.social.gifSearchPlaceholder}
          placeholderTextColor={theme.textSecondary}
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.input, { color: theme.text }]}
          accessibilityLabel={fr.social.gifSearchPlaceholder}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button">
            <X size={16} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      <FlatList
        data={items}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        numColumns={COLUMNS}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={styles.grid}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (!loading && nextOffset !== null && nextOffset > 0) {
            void load(query, nextOffset);
          }
        }}
        ListEmptyComponent={
          loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ) : (
            <View style={styles.center}>
              <ThemedText type="small" themeColor="textSecondary">
                {failed ? fr.social.gifUnavailable : fr.social.gifEmpty}
              </ThemedText>
            </View>
          )
        }
        ListFooterComponent={
          items.length > 0 ? (
            <ThemedText type="micro" themeColor="textSecondary" style={styles.attribution}>
              {fr.social.gifAttribution}
            </ThemedText>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onPick(item)}
            accessibilityRole="button"
            accessibilityLabel={item.title || 'GIF'}
            style={({ pressed }) => [
              styles.cell,
              {
                width: cell,
                height: Math.min(220, Math.max(90, (cell * item.height) / Math.max(1, item.width))),
                backgroundColor: theme.backgroundSelected,
              },
              pressed && styles.pressed,
            ]}>
            <Image
              source={{ uri: item.previewUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              autoplay
            />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.full,
    height: 38,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: 0 },
  grid: { paddingHorizontal: Spacing.three, gap: GAP, paddingBottom: Spacing.three },
  cell: { borderRadius: Radii.sm, overflow: 'hidden' },
  pressed: { opacity: 0.7 },
  center: { alignItems: 'center', justifyContent: 'center', padding: Spacing.five },
  attribution: { textAlign: 'center', marginTop: Spacing.two },
});
