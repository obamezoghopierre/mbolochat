import { Check, FolderPlus } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { ApiError, api } from '@/lib/api';
import type { SaveCollection } from '@/lib/types';

/**
 * « Enregistrer dans… » : choix ou création d'une collection, comme la feuille
 * d'Instagram. La publication doit déjà être enregistrée ; la feuille la
 * range ensuite dans la collection choisie.
 */
export function SaveCollectionSheet({
  token,
  publicationId,
  onClose,
  onDone,
}: {
  token: string;
  /** `null` = feuille fermée. */
  publicationId: string | null;
  onClose: () => void;
  /** Appelé après rangement, avec le nom de la collection. */
  onDone?: (collection: SaveCollection) => void;
}) {
  const theme = useTheme();
  const [collections, setCollections] = useState<SaveCollection[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicationId) {
      return;
    }
    let alive = true;
    setCollections(null);
    setCreating(false);
    setName('');
    setError(null);
    api
      .saveCollections(token)
      .then((list) => alive && setCollections(list))
      .catch(() => alive && setCollections([]));
    return () => {
      alive = false;
    };
  }, [publicationId, token]);

  const assign = async (collection: SaveCollection) => {
    if (!publicationId || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.assignSaveCollection(token, publicationId, collection.id);
      onDone?.(collection);
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : fr.social.collectionError);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createSaveCollection(token, trimmed);
      setBusy(false);
      await assign(created);
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof ApiError ? cause.message : fr.social.collectionError);
    }
  };

  return (
    <BottomSheet
      visible={publicationId !== null}
      onClose={onClose}
      title={fr.social.saveToCollectionTitle}>
      {collections === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <View style={styles.list}>
          {collections.map((collection) => (
            <Pressable
              key={collection.id}
              onPress={() => void assign(collection)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={collection.name}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}>
              <View style={[styles.cover, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText style={styles.coverLetter}>
                  {collection.name.slice(0, 1).toUpperCase()}
                </ThemedText>
              </View>
              <View style={styles.rowText}>
                <ThemedText numberOfLines={1} style={styles.rowTitle}>
                  {collection.name}
                </ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {fr.social.collectionCount(collection.count)}
                </ThemedText>
              </View>
            </Pressable>
          ))}

          {creating ? (
            <View style={styles.createRow}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={fr.social.collectionNamePlaceholder}
                placeholderTextColor={theme.textSecondary}
                autoFocus
                maxLength={40}
                returnKeyType="done"
                onSubmitEditing={() => void create()}
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: theme.backgroundSelected },
                ]}
              />
              <Pressable
                onPress={() => void create()}
                disabled={busy || !name.trim()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={fr.social.collectionCreate}>
                {busy ? (
                  <ActivityIndicator color={theme.accent} size="small" />
                ) : (
                  <Icon icon={Check} size={22} color={name.trim() ? theme.accent : theme.textSecondary} />
                )}
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => setCreating(true)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}>
              <View style={[styles.cover, styles.newCover, { borderColor: theme.border }]}>
                <Icon icon={FolderPlus} size={20} color={theme.text} />
              </View>
              <ThemedText style={styles.rowTitle}>{fr.social.collectionNew}</ThemedText>
            </Pressable>
          )}

          {error ? (
            <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
              {error}
            </ThemedText>
          ) : null}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  center: { padding: Spacing.four, alignItems: 'center' },
  list: { paddingBottom: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 60,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  cover: {
    width: 48,
    height: 48,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newCover: { borderWidth: StyleSheet.hairlineWidth },
  coverLetter: { fontSize: 20, fontWeight: '700' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontWeight: '600' },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  input: {
    flex: 1,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  error: { paddingHorizontal: Spacing.three },
});
