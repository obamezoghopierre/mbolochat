import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { SearchUser } from '@/lib/types';

type FollowState = 'idle' | 'following' | 'pending';

/**
 * Compte dans les résultats de recherche, avec un bouton « Suivre » en
 * ligne comme Instagram : l'appui suit/déssuit de façon optimiste (avec
 * retour en arrière), le reste de la ligne ouvre le profil.
 */
export function SearchUserRow({
  account,
  onOpenProfile,
}: {
  account: SearchUser;
  onOpenProfile: (id: string) => void;
}) {
  const theme = useTheme();
  const { token } = useAuth();
  const [state, setState] = useState<FollowState>('idle');
  const [busy, setBusy] = useState(false);

  const follow = useCallback(async () => {
    if (!token || busy || state !== 'idle') {
      return;
    }
    setBusy(true);
    setState('following');
    try {
      const result = await api.followUser(token, account.id);
      // Compte privé : le serveur attend l'accord de l'auteur.
      setState(result.status === 'pending' ? 'pending' : 'following');
    } catch {
      setState('idle');
    } finally {
      setBusy(false);
    }
  }, [account.id, busy, state, token]);

  const unfollow = useCallback(async () => {
    if (!token || busy || state !== 'following') {
      return;
    }
    setBusy(true);
    setState('idle');
    try {
      await api.unfollowUser(token, account.id);
    } catch {
      setState('following');
    } finally {
      setBusy(false);
    }
  }, [account.id, busy, state, token]);

  const label =
    state === 'following'
      ? fr.social.followingButton
      : state === 'pending'
        ? fr.social.followPending
        : fr.social.followInline;

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${account.displayName}, @${account.username}`}
        onPress={() => onOpenProfile(account.id)}
        style={({ pressed }) => [
          styles.body,
          pressed && { backgroundColor: theme.backgroundSelected },
        ]}>
        <Avatar
          name={account.displayName}
          uri={account.avatarUrl}
          size={Spacing.five}
        />
        <View style={styles.bodyText}>
          <ThemedText style={styles.name} numberOfLines={1}>
            {account.displayName}
            {account.verified ? ' ✓' : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            @{account.username}
            {account.privateAccount ? ` · ${fr.social.privateAccount}` : ''}
          </ThemedText>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: state !== 'idle' }}
        disabled={busy}
        onPress={state === 'following' ? () => void unfollow() : () => void follow()}
        style={({ pressed }) => [
          styles.followButton,
          state === 'following'
            ? {
                borderWidth: 1,
                borderColor: theme.accent,
                backgroundColor: theme.background,
              }
            : { backgroundColor: theme.accent },
          pressed && { opacity: 0.7 },
        ]}>
        <ThemedText
          type="smallBold"
          style={{
            color: state === 'following' ? theme.accent : theme.onAccent,
          }}>
          {label}
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radii.sm,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.threeHalf,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  bodyText: {
    flex: 1,
    gap: Spacing.half,
  },
  name: {
    ...Type.body,
    fontWeight: '600',
  },
  followButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.full,
    marginRight: Spacing.three,
  },
});
