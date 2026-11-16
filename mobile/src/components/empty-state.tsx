import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Gutter, Radii, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * État vide d'un écran : une icône discrète, un titre, une phrase qui dit quoi
 * faire ensuite. Pas de bordure ni d'illustration : l'écran doit paraître fini,
 * pas en construction.
 */
export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
        <Icon icon={icon} size={26} color={theme.accent} strokeWidth={2} />
      </View>
      <ThemedText style={styles.title}>{title}</ThemedText>
      <ThemedText style={[styles.description, { color: theme.textSecondary }]}>
        {description}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Gutter,
    gap: Spacing.two,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  title: {
    ...Type.sectionTitle,
    textAlign: 'center',
  },
  description: {
    ...Type.body,
    textAlign: 'center',
    maxWidth: 320,
  },
});
