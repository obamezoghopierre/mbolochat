import { History, Search, Trash2, X } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { filterSuggestions } from './search-history';

/**
 * Panneau d'historique / de suggestions de la recherche, comme Instagram :
 * - champ focus et vide : les recherches récentes, avec effacement par
 *   ligne et « effacer tout » ;
 * - champ focus et requête : les recherches récentes contenant la saisie,
 *   proposées comme suggestions.
 *
 * Il ne s'affiche que quand le champ est focus ; sinon la grille reprend
 * sa place.
 */
export function SearchHistoryPanel({
  entries,
  query,
  onPick,
  onRemove,
  onClear,
}: {
  entries: string[];
  query: string;
  onPick: (query: string) => void;
  onRemove: (query: string) => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  const normalized = query.trim();

  if (normalized === '') {
    if (entries.length === 0) {
      return null;
    }
    return (
      <View style={styles.wrap}>
        <ThemedText
          type="caption"
          style={[styles.header, { color: theme.textSecondary }]}>
          {fr.social.searchRecent}
        </ThemedText>
        {entries.map((entry) => (
          <HistoryRow
            key={entry}
            entry={entry}
            variant="recent"
            onPick={onPick}
            onRemove={onRemove}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fr.social.searchClearAll}
          onPress={onClear}
          style={({ pressed }) => [
            styles.clearRow,
            { backgroundColor: theme.backgroundSelected },
            pressed && styles.pressed,
          ]}>
          <Icon icon={Trash2} size={Spacing.three} color={theme.textSecondary} />
          <ThemedText
            type="small"
            style={{ color: theme.textSecondary, fontWeight: '600' }}>
            {fr.social.searchClearAll}
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  const suggestions = filterSuggestions(entries, normalized);
  if (suggestions.length === 0) {
    return null;
  }
  return (
    <View style={styles.wrap}>
      <ThemedText style={[styles.header, { color: theme.textSecondary }]}>
        {fr.social.searchSuggestions}
      </ThemedText>
      {suggestions.map((entry) => (
        <HistoryRow
          key={entry}
          entry={entry}
          variant="suggestion"
          onPick={onPick}
          onRemove={onRemove}
        />
      ))}
    </View>
  );
}

function HistoryRow({
  entry,
  variant,
  onPick,
  onRemove,
}: {
  entry: string;
  /** `recent` = historique (effacement possible), `suggestion` = suggestion. */
  variant: 'recent' | 'suggestion';
  onPick: (query: string) => void;
  onRemove: (query: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={entry}
        onPress={() => onPick(entry)}
        style={({ pressed }) => [
          styles.rowBody,
          pressed && { backgroundColor: theme.backgroundSelected },
        ]}>
        <Icon
          icon={variant === 'suggestion' ? Search : History}
          size={Spacing.four}
          color={theme.textSecondary}
        />
        <ThemedText type="body" style={styles.rowText} numberOfLines={1}>
          {entry}
        </ThemedText>
      </Pressable>
      {variant === 'recent' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fr.social.searchRemove(entry)}
          onPress={() => onRemove(entry)}
          style={({ pressed }) => [
            styles.remove,
            { backgroundColor: theme.backgroundSelected },
            pressed && styles.pressed,
          ]}>
          <Icon icon={X} size={Spacing.three} color={theme.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  header: {
    fontWeight: '700',
    marginBottom: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radii.sm,
  },
  rowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  remove: {
    padding: Spacing.two,
    marginRight: Spacing.two,
    borderRadius: Radii.full,
  },
  rowText: {
    flex: 1,
  },
  clearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Radii.sm,
    marginTop: Spacing.one,
  },
  pressed: {
    opacity: 0.7,
  },
});
