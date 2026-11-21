import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/**
 * Ouverture d'un profil à partir d'une `@mention` : l'API résout le nom
 * d'utilisateur (`GET /users/by-username/:username`), puis on remplace cet
 * écran par `/user/[id]`, pour que « retour » revienne directement au post.
 */
export default function MentionProfileScreen() {
  const { token, loading } = useAuth();
  const { username } = useLocalSearchParams<{ username: string }>();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!token || typeof username !== 'string' || username.length === 0) {
      return;
    }
    let cancelled = false;
    api
      .getUserProfileByUsername(token, username)
      .then((profile) => {
        if (!cancelled) {
          router.replace(`/user/${profile.id}`);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNotFound(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, username]);

  if (loading) {
    return <ThemedView style={styles.screen} />;
  }
  if (!token) {
    return <Redirect href="/login" />;
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen options={{ title: `@${username ?? ''}` }} />
      {notFound ? (
        <View style={styles.center}>
          <ThemedText type="subtitle">{fr.social.mentionNotFound(username ?? '')}</ThemedText>
          <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={10}>
            <ThemedText type="link">{fr.social.back}</ThemedText>
          </Pressable>
        </View>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
});
