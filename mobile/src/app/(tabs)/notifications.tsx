import { Redirect } from 'expo-router';
import { Bell } from 'lucide-react-native';

import { EmptyState } from '@/components/empty-state';
import { ThemedView } from '@/components/themed-view';
import { fr } from '@/i18n/fr';
import { useAuth } from '@/lib/auth-context';

/**
 * Onglet Notifications : réactions, commentaires, abonnements et modération.
 * Le flux serveur (`social_notifications`) arrive avec la phase 1 ; l'écran
 * occupe sa place dans la navigation sans afficher de fausses données.
 */
export default function NotificationsScreen() {
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
        icon={Bell}
        title={fr.social.notificationsTitle}
        description={fr.social.notificationsBody}
      />
    </ThemedView>
  );
}
