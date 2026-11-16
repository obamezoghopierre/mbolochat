import { Redirect } from 'expo-router';
import { Home } from 'lucide-react-native';
import { StyleSheet } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { LogoMark } from '@/components/logo';
import { ThemedView } from '@/components/themed-view';
import { fr } from '@/i18n/fr';
import { useAuth } from '@/lib/auth-context';

/**
 * Onglet d'accueil : le fil social. Tant que la phase 1 n'expose pas le feed,
 * l'écran dit ce qu'il faut faire (s'abonner) plutôt que d'afficher un vide
 * inexplicable. Le garde d'authentification reste ici, à l'entrée de l'app.
 */
export default function FeedScreen() {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <ThemedView style={styles.splash}>
        <LogoMark size={84} />
      </ThemedView>
    );
  }

  if (!token) {
    return <Redirect href="/login" />;
  }

  return (
    <ThemedView style={styles.screen}>
      <EmptyState icon={Home} title={fr.social.feedTitle} description={fr.social.feedBody} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screen: {
    flex: 1,
  },
});
