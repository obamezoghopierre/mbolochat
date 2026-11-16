import { Redirect } from 'expo-router';
import { Compass } from 'lucide-react-native';

import { EmptyState } from '@/components/empty-state';
import { ThemedView } from '@/components/themed-view';
import { fr } from '@/i18n/fr';
import { useAuth } from '@/lib/auth-context';

/** Onglet Découvrir : recherche, hashtags et tendances (phase 4). */
export default function DiscoverScreen() {
  const { token, loading } = useAuth();

  if (loading) {
    return <ThemedView style={{ flex: 1 }} />;
  }
  if (!token) {
    return <Redirect href="/login" />;
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <EmptyState
        icon={Compass}
        title={fr.social.discoverTitle}
        description={fr.social.discoverBody}
      />
    </ThemedView>
  );
}
