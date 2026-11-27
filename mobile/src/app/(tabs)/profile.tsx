import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Bookmark, ChevronRight } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProfileAction, ProfileHeader } from '@/components/profile-view';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, TabBarHeight } from '@/constants/theme';
import { RepostsSection } from '@/features/social/feed/reposts-section';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cache } from '@/lib/cache';
import type { UserProfile } from '@/lib/types';

export default function ProfileScreen() {
  const { token, user } = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(() => {
    if (!user) {
      return null;
    }
    const cached = cache.getProfile(user.id);
    if (cached) {
      return cached;
    }
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      gender: user.gender,
      genderCustom: user.genderCustom,
      notificationsEnabled: user.notificationsEnabled,
      notificationSound: user.notificationSound ?? true,
      notificationPreview: user.notificationPreview ?? true,
      createdAt: user.createdAt,
      isMe: true,
      age: null,
      city: null,
      country: null,
      birthdateSet: false,
      stats: { messages: 0, conversations: 0 },
    };
  });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !user) {
      return;
    }
    try {
      const result = await api.getUserProfile(token, user.id);
      setProfile(result);
      cache.setProfile(result);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger le profil.');
    }
  }, [token, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!token || !user) {
    return <Redirect href="/login" />;
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: TabBarHeight + insets.bottom + Spacing.four },
        ]}
        keyboardShouldPersistTaps="handled">
        {profile ? (
          <ProfileHeader
            profile={profile}
            showUsername={false}
            onPressEdit={() => router.push('/profile/edit')}
            actions={
              !profile.birthdateSet ? (
                <View style={styles.actions}>
                  <ProfileAction
                    label="Renseigner ma date de naissance"
                    onPress={() => router.push('/profile/birthdate')}
                  />
                </View>
              ) : null
            }
          />
        ) : null}

        {/* Enregistrés : privé, comme Instagram (visible sur son propre profil). */}
        <Pressable
          onPress={() => router.push('/saved')}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.savedRow,
            { backgroundColor: theme.backgroundElement },
            pressed && { opacity: 0.7 },
          ]}>
          <Icon icon={Bookmark} size={20} color={theme.text} />
          <ThemedText style={styles.savedLabel}>{fr.social.savedTitle}</ThemedText>
          <Icon icon={ChevronRight} size={18} color={theme.textSecondary} />
        </Pressable>

        {profile ? <RepostsSection userId={profile.id} token={token} source="authored" /> : null}
        {profile ? <RepostsSection userId={profile.id} token={token} /> : null}

        {error ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {error}
          </ThemedText>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.four,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.threeHalf,
  },
  savedLabel: { flex: 1, fontWeight: '600' },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
  },
});
