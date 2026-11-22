import { Redirect, Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProfileAction, ProfileHeader } from '@/components/profile-view';
import { Icon } from '@/components/icon';
import { useCalls } from '@/features/calls/CallProvider';
import { followAction, followLabelKey } from '@/features/social/follow/follow-state';
import { RepostsSection } from '@/features/social/feed/reposts-section';
import { useTheme } from '@/hooks/use-theme';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cache } from '@/lib/cache';
import { fr } from '@/i18n/fr';
import type { Gender, UserProfile } from '@/lib/types';

export default function UserProfileScreen() {
  // Le nom et la photo sont passés par l'écran appelant (liste, chat) : le
  // profil s'affiche ainsi instantanément, avant même la réponse du serveur.
  const { id, name, username, avatar, gender: genderParam } = useLocalSearchParams<{
    id: string;
    name?: string;
    username?: string;
    avatar?: string;
    gender?: string;
  }>();
  const initialGender: Gender | null =
    genderParam === 'MALE' || genderParam === 'FEMALE' || genderParam === 'CUSTOM'
      ? genderParam
      : null;
  const { token, user } = useAuth();
  const calls = useCalls();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  const [profile, setProfile] = useState<UserProfile | null>(() => {
    if (!id) {
      return null;
    }
    const cached = cache.getProfile(id);
    if (cached) {
      return cached;
    }
    if (!name || !username) {
      return null;
    }
    return {
      id,
      username,
      displayName: name,
      bio: null,
      avatarUrl: avatar ? avatar : null,
      gender: initialGender,
      genderCustom: null,
      notificationsEnabled: true,
      notificationSound: true,
      notificationPreview: true,
      createdAt: '',
      isMe: false,
      age: null,
      city: null,
      country: null,
      birthdateSet: false,
      stats: { messages: 0, conversations: 0 },
    };
  });
  const [starting, setStarting] = useState(false);
  const [calling, setCalling] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [following, setFollowing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) {
      return;
    }
    try {
      const [result, blockedUsers] = await Promise.all([
        api.getUserProfile(token, id),
        api.listBlockedUsers(token),
      ]);
      setProfile(result);
      cache.setProfile(result);
      setBlocked(blockedUsers.some((item) => item.id === id));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger ce profil.');
    }
  }, [token, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!token || !user) {
    return <Redirect href="/login" />;
  }

  const startConversation = async () => {
    if (!token || !profile) {
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const conversation = await api.createConversation(token, { memberIds: [profile.id] });
      router.replace({ pathname: '/chat/[id]', params: { id: conversation.id } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible d’ouvrir la discussion.');
      setStarting(false);
    }
  };

  const callUser = async () => {
    if (!token || !profile || calling) {
      return;
    }
    setCalling(true);
    setError(null);
    try {
      const conversation = await api.createConversation(token, { memberIds: [profile.id] });
      await calls.startCall(conversation.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de lancer l’appel.');
    } finally {
      setCalling(false);
    }
  };

  const toggleBlock = async () => {
    if (!token || !profile) {
      return;
    }
    try {
      if (blocked) {
        await api.unblockUser(token, profile.id);
      } else {
        await api.blockUser(token, profile.id);
      }
      setBlocked(!blocked);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action impossible.');
    }
  };

  const social = profile?.social;
  const followStatus = social?.followStatus ?? 'none';
  const followKey = followLabelKey(followStatus);

  const toggleFollow = async () => {
    if (!token || !profile || !social || following) {
      return;
    }
    const action = followAction(social.followStatus);
    setFollowing(true);
    setError(null);
    try {
      const result =
        action === 'follow'
          ? await api.followUser(token, profile.id)
          : await api.unfollowUser(token, profile.id);
      setProfile((current) =>
        current
          ? {
              ...current,
              social: {
                ...(current.social ?? social),
                followStatus: result.status,
                followerCount: result.followerCount,
              },
            }
          : current,
      );
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? fr.social.followError
          : 'Action impossible. Réessaie.',
      );
    } finally {
      setFollowing(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: profile?.displayName ?? name ?? 'Profil' }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing.four },
        ]}>
        {profile ? (
          <ProfileHeader
            profile={profile}
            onPressEdit={
              profile.isMe ? () => router.push('/profile/edit') : undefined
            }
            actions={
              profile.isMe ? null : blocked ? (
                <ProfileAction
                  label="Débloquer le compte"
                  onPress={() => void toggleBlock()}
                  primary
                />
              ) : (
                <>
                  {social ? (
                    <ProfileAction
                      label={fr.social[followKey]}
                      onPress={() => void toggleFollow()}
                      loading={following}
                      primary={followStatus === 'none'}
                    />
                  ) : null}
                  <ProfileAction
                    label="Écrire"
                    onPress={() => void startConversation()}
                    loading={starting}
                    primary
                  />
                  <ProfileAction
                    label="Appeler"
                    onPress={() => void callUser()}
                    loading={calling}
                  />
                  <ProfileAction
                    label="Bloquer le compte"
                    onPress={() => void toggleBlock()}
                    danger
                  />
                </>
              )
            }
          />
        ) : null}

        {social ? (
          <View style={styles.stats} accessibilityRole="summary">
            <Stat label={fr.social.followers} value={social.followerCount} />
            <Stat label={fr.social.following} value={social.followingCount} />
            <Stat label={fr.social.publications} value={social.publicationCount} />
          </View>
        ) : null}

        {social && social.privateAccount && !social.contentVisible && !profile?.isMe ? (
          <View style={[styles.privateBox, { borderColor: theme.border }]}>
            <Icon icon={Lock} size={20} color={theme.textSecondary} />
            <View style={styles.privateText}>
              <ThemedText style={styles.privateTitle}>{fr.social.privateTitle}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {fr.social.privateBody}
              </ThemedText>
            </View>
          </View>
        ) : profile ? (
          <>
            <RepostsSection userId={profile.id} token={token} source="authored" />
            <RepostsSection userId={profile.id} token={token} />
          </>
        ) : null}

        {error ? (
          <ThemedText type="small" themeColor="danger">
            {error}
          </ThemedText>
        ) : null}

      </ScrollView>
    </ThemedView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <ThemedText style={styles.statValue}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.four,
  },
  section: {
    gap: Spacing.three,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  stats: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.half,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  privateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.threeHalf,
    padding: Spacing.three,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  privateText: {
    flex: 1,
    gap: Spacing.half,
  },
  privateTitle: {
    fontWeight: '600',
  },
});
