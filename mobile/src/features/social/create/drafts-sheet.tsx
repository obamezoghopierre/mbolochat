import { FilePlus2, Trash2, X } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { formatRelativeTimestamp } from '@/lib/format';
import type { TextDraft } from '@/lib/text-draft';

/**
 * Feuille « Brouillons » du compositeur texte : liste les textes en cours
 * conservés sur l'appareil. Toucher un brouillon le recharge dans
 * l'éditeur ; la corbeille le supprime ; « Nouveau » repart de zéro en
 * conservant les autres.
 */
export function DraftsSheet({
  visible,
  drafts,
  onSelect,
  onDelete,
  onNew,
  onClose,
}: {
  visible: boolean;
  drafts: TextDraft[];
  onSelect: (draft: TextDraft) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <View
          style={[
            styles.header,
            {
              paddingTop: insets.top + Spacing.two,
              borderBottomColor: theme.border,
            },
          ]}>
          <ThemedText style={[Type.sectionTitle, styles.title]}>
            {fr.social.createDrafts}
          </ThemedText>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={fr.social.back}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <Icon icon={X} size={22} color={theme.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.list}>
          {drafts.length === 0 ? (
            <ThemedText type="body" style={[styles.empty, { color: theme.textSecondary }]}>
              {fr.social.createDraftsEmpty}
            </ThemedText>
          ) : (
            drafts.map((draft) => {
              const snippet = draft.pages
                .map((page) => page.trim())
                .find((page) => page.length > 0);
              const filled = draft.pages.filter((page) => page.trim().length > 0).length;
              return (
                <View
                  key={draft.id}
                  style={[
                    styles.row,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                  ]}>
                  <Pressable
                    onPress={() => onSelect(draft)}
                    accessibilityRole="button"
                    accessibilityLabel={fr.social.createDraftOpen}
                    style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
                    <ThemedText numberOfLines={2} style={[styles.snippet, { color: theme.text }]}>
                      {snippet || fr.social.createDraftUntitled}
                    </ThemedText>
                    <ThemedText type="micro" style={[styles.meta, { color: theme.textSecondary }]}>
                      {fr.social.createDraftMeta(
                        filled,
                        formatRelativeTimestamp(new Date(draft.updatedAt).toISOString()),
                      )}
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => onDelete(draft.id)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={fr.social.createDraftDelete}
                    style={({ pressed }) => [styles.trash, pressed && styles.pressed]}>
                    <Icon icon={Trash2} size={18} color={theme.textSecondary} />
                  </Pressable>
                </View>
              );
            })
          )}
        </ScrollView>

        <View
          style={[
            styles.footer,
            { paddingBottom: insets.bottom + Spacing.three, borderTopColor: theme.border },
          ]}>
          <Pressable
            onPress={onNew}
            accessibilityRole="button"
            accessibilityLabel={fr.social.createDraftNew}
            style={({ pressed }) => [
              styles.newButton,
              { backgroundColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}>
            <Icon icon={FilePlus2} size={18} color={theme.accent} />
            <ThemedText style={[Type.body, { color: theme.accent, fontWeight: '700' }]}>
              {fr.social.createDraftNew}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontWeight: '700' },
  close: { padding: Spacing.one },
  pressed: { opacity: 0.6 },
  list: { padding: Spacing.three, gap: Spacing.two, flexGrow: 1 },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: Spacing.three,
  },
  rowMain: { flex: 1, paddingVertical: Spacing.three, gap: Spacing.half },
  snippet: { fontWeight: '600' },
  meta: {},
  trash: { padding: Spacing.three },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Radii.full,
  },
});
