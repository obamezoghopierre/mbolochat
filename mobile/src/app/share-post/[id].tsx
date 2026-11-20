import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ContactPicker } from '@/components/contact-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Gutter, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { fr } from '@/i18n/fr';
import { setPendingPostShare } from '@/lib/pending-post-share';
import type { User } from '@/lib/types';

/**
 * « Partager à » : choix d'un ami dans la liste de contacts, puis envoi de
 * la publication dans la discussion directe (créée si besoin) — le chat
 * consomme le partage en attente à l'arrivée, comme pour les discussions
 * récentes de la feuille de partage.
 */
export default function SharePostScreen() {
  const { token } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!token || !id) {
    return <Redirect href="/login" />;
  }

  const sendTo = async (other: User) => {
    if (creating) return;
    setCreating(other.id);
    setError(null);
    try {
      const conversation = await api.createConversation(token, { memberIds: [other.id] });
      // Le chat envoie le lien profond via son transport (clair ou E2EE).
      setPendingPostShare({ publicationId: id });
      router.replace({ pathname: '/chat/[id]', params: { id: conversation.id } });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : fr.social.shareError,
      );
      setCreating(null);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="caption" themeColor="textSecondary">
          {creating ? fr.social.shareSending : fr.social.shareToHint}
        </ThemedText>
        {error ? (
          <ThemedText type="caption" style={{ color: theme.danger }} accessibilityRole="alert">
            {error}
          </ThemedText>
        ) : null}
      </View>
      <ContactPicker
        selected={[]}
        onToggle={(user) => void sendTo(user)}
        placeholder={fr.social.shareSearchPlaceholder}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: Gutter, paddingTop: Spacing.two, gap: Spacing.half },
});
