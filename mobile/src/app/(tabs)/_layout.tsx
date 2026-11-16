import { Tabs } from 'expo-router/js-tabs';
import { Compass, Home, MessageCircle, SquarePlus, User } from 'lucide-react-native';
import { StyleSheet } from 'react-native';

import { Icon } from '@/components/icon';
import { Spacing } from '@/constants/theme';
import { fr } from '@/i18n/fr';
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
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.backgroundElement,
          borderTopColor: theme.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.item,
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
          tabBarIcon: ({ color }) => <Icon icon={User} size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: '500',
  },
  item: {
    paddingTop: Spacing.one,
  },
});
