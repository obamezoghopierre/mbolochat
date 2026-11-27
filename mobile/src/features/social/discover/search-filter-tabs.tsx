import { useEffect } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import ReAnimated, { useSharedValue, withSpring } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SearchFilter = 'all' | 'users' | 'publications' | 'hashtags';

/**
 * Onglets de filtre des résultats de recherche, comme Instagram : un
 * indicateur glissant sous l'onglet actif, les autres en teinte secondaire.
 */
export function SearchFilterTabs({
  value,
  onChange,
  labels,
}: {
  value: SearchFilter;
  onChange: (next: SearchFilter) => void;
  labels: Record<SearchFilter, string>;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const tabWidth = width / 4;
  const index = Math.max(
    0,
    (['all', 'users', 'publications', 'hashtags'] as SearchFilter[]).indexOf(value),
  );
  const indicatorLeft = useSharedValue(index * tabWidth);

  // L'indicateur glisse vers l'onglet actif au changement.
  useEffect(() => {
    indicatorLeft.value = withSpring(index * tabWidth, { damping: 22 });
  }, [index, indicatorLeft, tabWidth]);

  const tabs: SearchFilter[] = ['all', 'users', 'publications', 'hashtags'];

  return (
    <View>
      <View style={styles.row}>
        {tabs.map((tab) => {
          const active = tab === value;
          return (
            <Pressable
              key={tab}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={labels[tab]}
              onPress={() => onChange(tab)}
              style={styles.tab}>
              <ThemedText
                type="smallBold"
                style={[styles.label, { color: active ? theme.text : theme.textSecondary }]}>
                {labels[tab]}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      <ReAnimated.View
        pointerEvents="none"
        style={[
          styles.indicator,
          {
            left: indicatorLeft,
            width: tabWidth,
            backgroundColor: theme.accent,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
  },
  indicator: {
    height: 3,
    borderRadius: Radii.full,
  },
});
