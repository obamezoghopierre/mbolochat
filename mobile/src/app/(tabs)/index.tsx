import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { FeedSurface } from '@/constants/theme';
import { FeedScreen as SocialFeedScreen } from '@/features/social/feed/feed-screen';
import { useAuth } from '@/lib/auth-context';
import { markLaunchReady } from '@/lib/launch-gate';

/**
 * Onglet d'accueil : le fil social. Le garde d'authentification reste ici, à
 * l'entrée de l'application ; le fil gère lui-même ses états.
 *
 * Pendant la restauration de session, l'écran de lancement natif reste
 * affiché (cf. `launch-gate`) : rien à dessiner ici, sinon un second logo
 * apparaîtrait entre le lancement et le fil.
 */
export default function FeedScreen() {
  const { token, loading } = useAuth();

  // Pas de session : la connexion est le premier écran, on la montre.
  useEffect(() => {
    if (!loading && !token) {
      markLaunchReady();
    }
  }, [loading, token]);

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: FeedSurface.background }} />;
  }

  if (!token) {
    return <Redirect href="/login" />;
  }

  return <SocialFeedScreen />;
}
