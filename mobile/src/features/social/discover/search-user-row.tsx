import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { SearchUser } from '@/lib/types';
import { followUiState, type SearchFollowUi } from './search-model';

/**
 * Compte dans les résultats de recherche, avec un bouton « Suivre » en
 * ligne comme Instagram : le bouton part de l'abonnement réel renvoyé par
 * l'API (suivi, demande en attente), l'appui suit ou se désabonne de façon
 * optimiste avec retour en arrière, le reste de la ligne ouvre le profil.
 *
 * Une demande en attente se retire comme un abonnement : le serveur supprime
 * la ligne `pending`.
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
  const [state, setState] = useState<SearchFollowUi>(() =>
    followUiState(account.followStatus),
  );
  const [busy, setBusy] = useState(false);

  const follow = async () => {
    if (!token || busy || state !== 'idle') {
      return;
    }
    setBusy(true);
    setState('following');
    try {
      const result = await api.followUser(token, account.id);
      // Compte privé : le serveur attend l'accord de l'auteur.
      setState(followUiState(result.status));
    } catch {
      setState('idle');
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    if (!token || busy || state === 'idle') {
      return;
    }
    const previous = state;
    setBusy(true);
    setState('idle');
    try {
      await api.unfollowUser(token, account.id);
    } catch {
      setState(previous);
    } finally {
      setBusy(false);
    }
  };

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
        onPress={state === 'idle' ? () => void follow() : () => void release()}
        style={({ pressed }) => [
          styles.followButton,
          state === 'idle'
            ? { backgroundColor: theme.accent }
            : {
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.accent,
                backgroundColor: theme.background,
              },
          pressed && styles.pressed,
        ]}>
        <ThemedText
          type="smallBold"
          style={{ color: state === 'idle' ? theme.onAccent : theme.accent }}>
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
  pressed: {
    opacity: 0.7,
  },
});
