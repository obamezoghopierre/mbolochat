import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Compass, Home, MessageCircle, Settings, SquarePlus, User } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { fr } from '@/i18n/fr';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Navigation principale du produit fusionné (plan §10) :
 * Fil · Découvrir · Créer · Messages · Profil.
 *
 * Les écrans restent des fichiers de route ordinaires : le groupe `(tabs)`
 * n'apparaît pas dans l'URL, donc `/chats` et `/profile` gardent leur chemin et
 * les liens existants continuent de fonctionner.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.backgroundElement,
          borderTopColor: theme.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          // Hauteur explicite : la barre par défaut (49 px) rogne le libellé
          // sous l'icône de 22 px sur les écrans à petit insigne de navigation.
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom + Spacing.one,
          paddingTop: Spacing.two,
        },
        tabBarLabelStyle: styles.label,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: fr.tabs.feed,
          tabBarIcon: ({ color }) => <Icon icon={Home} size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: fr.tabs.discover,
          tabBarIcon: ({ color }) => <Icon icon={Compass} size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: fr.tabs.create,
          tabBarIcon: ({ color }) => <Icon icon={SquarePlus} size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: fr.tabs.chats,
          tabBarIcon: ({ color }) => <Icon icon={MessageCircle} size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: fr.tabs.profile,
          // L'en-tête vit ici : un `Stack.Screen` rendu dans l'onglet serait
          // ignoré, et le bouton Paramètres disparaîtrait.
          headerShown: true,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerTitleStyle: { color: theme.text },
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/settings')}
              hitSlop={8}
              style={styles.headerButton}
              accessibilityRole="button"
              accessibilityLabel={fr.tabs.settings}>
              <Icon icon={Settings} size={22} color={theme.text} />
            </Pressable>
          ),
          tabBarIcon: ({ color }) => <Icon icon={User} size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}

/** Hauteur utile de la barre, hors inset système. */
const TAB_BAR_HEIGHT = 58;

const styles = StyleSheet.create({
  // `lineHeight` explicite : à 11 px, la valeur par défaut dépasse la hauteur
  // allouée au libellé et la dernière ligne se fait rogner.
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
  },
  // Sans marge, l'icône vient coller au bord droit alors que le titre garde
  // 16 px à gauche : l'en-tête paraît déséquilibré.
  headerButton: {
    marginRight: Spacing.three,
  },
});
