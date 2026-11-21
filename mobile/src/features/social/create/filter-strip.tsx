import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MediaSurface, Radii, Spacing, Type } from '@/constants/theme';
import { MEDIA_FILTERS, type MediaFilter } from '@/features/media/media-filter';
import { fr } from '@/i18n/fr';

/** Libellé FR d'un filtre : `labelKey` pointe une entrée texte de `fr.social`. */
function filterLabel(filter: MediaFilter): string {
  return fr.social[filter.labelKey as keyof typeof fr.social] as string;
}

/**
 * Sélecteur de filtres façon TikTok/Instagram : pastilles horizontales avec
 * aperçu coloré et libellé. Partagé entre la caméra et l'écran de
 * publication — `value === null` correspond au rendu brut (« Normal »).
 */
export function FilterStrip({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (key: string | null) => void;
  disabled?: boolean;
}) {
  const renderSwatch = (filter: MediaFilter | null) => {
    if (!filter) {
      // « Normal » : dégradé neutre sombre → clair, comme une photo brute.
      return (
        <View style={[styles.swatch, styles.normalSwatch]}>
          <View style={[styles.normalHalf, styles.normalTop]} />
          <View style={[styles.normalHalf, styles.normalBottom]} />
        </View>
      );
    }
    const [first, second] = filter.layers;
    return (
      <View style={[styles.swatch, { backgroundColor: first?.color ?? '#333' }]}>
        {second ? (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: second.color, opacity: Math.min(1, second.opacity * 2) },
            ]}
          />
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      style={styles.scroll}>
      <FilterChip
        label={fr.social.filterNormal}
        selected={value === null}
        disabled={disabled}
        onPress={() => onChange(null)}>
        {renderSwatch(null)}
      </FilterChip>
      {MEDIA_FILTERS.map((filter) => (
        <FilterChip
          key={filter.key}
          label={filterLabel(filter)}
          selected={value === filter.key}
          disabled={disabled}
          onPress={() => onChange(filter.key)}>
          {renderSwatch(filter)}
        </FilterChip>
      ))}
    </ScrollView>
  );
}

function FilterChip({
  label,
  selected,
  disabled,
  onPress,
  children,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.chip,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}>
      <View style={[styles.swatchFrame, selected && styles.swatchFrameSelected]}>
        {children}
      </View>
      <ThemedText
        numberOfLines={1}
        style={[styles.label, selected ? styles.labelSelected : styles.labelIdle]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  strip: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  chip: {
    alignItems: 'center',
    gap: Spacing.one,
    width: 58,
  },
  swatchFrame: {
    borderRadius: Radii.md,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchFrameSelected: {
    borderColor: MediaSurface.onSurface,
  },
  swatch: {
    width: 46,
    height: 46,
    borderRadius: Radii.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  normalSwatch: {
    backgroundColor: MediaSurface.background,
  },
  normalHalf: { flex: 1, width: '100%' },
  normalTop: { backgroundColor: '#5A6472' },
  normalBottom: { backgroundColor: '#2A2F3A' },
  label: {
    ...Type.caption,
    fontSize: 11,
  },
  labelSelected: {
    color: MediaSurface.onSurface,
    fontWeight: '700',
  },
  labelIdle: {
    color: MediaSurface.onSurfaceSoft,
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
});
