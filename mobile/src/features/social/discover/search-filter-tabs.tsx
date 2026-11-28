import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReAnimated, { useSharedValue, withSpring } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { DiscoverMetrics, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { SearchFilter } from './search-model';

const TABS: SearchFilter[] = ['all', 'users', 'publications', 'hashtags'];

/**
 * Onglets de filtre des résultats de recherche, comme Instagram : un
 * indicateur glissant sous l'onglet actif, les autres en teinte secondaire.
 *
 * La largeur d'un onglet est mesurée sur la rangée elle-même : l'écran est en
 * retrait de ses marges latérales, donc la largeur de la fenêtre ne donnerait
 * pas des onglets alignés sur l'indicateur.
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
  // Largeur mesurée de la rangée ; 0 tant que le premier rendu n'a pas eu lieu.
  const [rowWidth, setRowWidth] = useState(0);
  const tabWidth = rowWidth / TABS.length;
  const index = Math.max(0, TABS.indexOf(value));
  const indicatorLeft = useSharedValue(0);

  // L'indicateur glisse vers l'onglet actif au changement, et se replace
  // quand la largeur mesurée arrive.
  useEffect(() => {
    indicatorLeft.value = withSpring(index * tabWidth, { damping: 22 });
  }, [index, indicatorLeft, tabWidth]);

  return (
    <View onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
      <View style={styles.row}>
        {TABS.map((tab) => {
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
      {tabWidth > 0 ? (
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
      ) : null}
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
    // Posé sous la rangée sans lui prendre de hauteur.
    position: 'absolute',
    bottom: 0,
    height: DiscoverMetrics.filterIndicator,
    borderRadius: Radii.full,
  },
});
