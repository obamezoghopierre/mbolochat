import { Redirect } from 'expo-router';
import { SquarePlus } from 'lucide-react-native';

import { EmptyState } from '@/components/empty-state';
import { ThemedView } from '@/components/themed-view';
import { fr } from '@/i18n/fr';
import { useAuth } from '@/lib/auth-context';

/**
 * Onglet Créer. Le studio (capture, galerie, recadrage, upload) arrive avec la
 * phase 3 ; l'écran occupe déjà sa place dans la navigation pour que le shell
 * soit complet et testable.
 */
export default function CreateScreen() {
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
        icon={SquarePlus}
        title={fr.social.createTitle}
        description={fr.social.createBody}
      />
    </ThemedView>
  );
}
