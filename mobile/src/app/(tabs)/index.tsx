import { Redirect } from 'expo-router';
import { StyleSheet } from 'react-native';

import { LogoMark } from '@/components/logo';
import { ThemedView } from '@/components/themed-view';
import { FeedScreen as SocialFeedScreen } from '@/features/social/feed/feed-screen';
import { useAuth } from '@/lib/auth-context';

/**
 * Onglet d'accueil : le fil social. Le garde d'authentification reste ici, à
 * l'entrée de l'application ; le fil gère lui-même ses états.
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

  return <SocialFeedScreen />;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
