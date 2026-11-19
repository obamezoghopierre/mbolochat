import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Settings } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from '@/components/icon';
import { CustomTabBar } from '@/components/navigation/custom-tab-bar';
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

  return (
    <Tabs
      // Barre maison (src/components/navigation/custom-tab-bar.tsx) : animations
      // Reanimated et transparence sur le fil.
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        // La barre gère elle-même couleurs et typographie ; ces options ne sont
        // là que pour les consommateurs qui lisent le thème du navigateur.
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textSecondary,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: fr.tabs.feed,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: fr.tabs.discover,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: fr.tabs.notifications,
        }}
      />
      {/*
        Créer n'est pas un onglet : sa place est prise par les notifications.
        La route reste disponible (`router.push('/create')`) pour le studio de la
        phase 3, sans encombrer la barre.
      */}
      <Tabs.Screen name="create" options={{ href: null, title: fr.tabs.create }} />
      <Tabs.Screen
        name="chats"
        options={{
          title: fr.tabs.chats,
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
        }}
      />
    </Tabs>
  );
}

// La hauteur et la surface de la barre vivent dans `constants/theme.ts`
// (`TabBarHeight`, `TabBarSurface`), avec le contenu plein écran posé dessus.

const styles = StyleSheet.create({
  // Sans marge, l'icône vient coller au bord droit alors que le titre garde
  // 16 px à gauche : l'en-tête paraît déséquilibré.
  headerButton: {
    marginRight: Spacing.three,
  },
});
