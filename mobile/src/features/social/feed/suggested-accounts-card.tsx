import { BadgeCheck, X } from 'lucide-react-native';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedMetrics, FeedSurface, Radii, Spacing, Type } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { api, type SuggestedAccount } from '@/lib/api';
import { resolveMediaUrl } from '@/lib/media-url';
import type { FollowState } from '@/lib/types';
import { useTextPostTones } from './pager/feed-tokens';

/**
 * Carte « Suggestions pour toi » glissée dans le fil, comme Instagram :
 * rangée horizontale de comptes avec « Suivre » et ✕ pour écarter.
 * Masquée s'il n'y a rien à proposer.
 */
export function SuggestedAccountsCard({ token }: { token: string }) {
  const tones = useTextPostTones();
  const [items, setItems] = useState<SuggestedAccount[] | null>(null);
  const [followStates, setFollowStates] = useState<
    Map<string, FollowState['status'] | 'sending'>
  >(() => new Map());

  useEffect(() => {
    let alive = true;
    api
      .suggestedAccounts(token)
      .then((list) => alive && setItems(list))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [token]);

  if (!items || items.length === 0) {
    return null;
  }

  const follow = async (account: SuggestedAccount) => {
    setFollowStates((current) => new Map(current).set(account.id, 'sending'));
    try {
      const result = await api.followUser(token, account.id);
      setFollowStates((current) =>
        new Map(current).set(account.id, result.status === 'accepted' ? 'accepted' : 'pending'),
      );
    } catch {
      setFollowStates((current) => new Map(current).set(account.id, 'none'));
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: tones.surface, borderColor: tones.cardBorder }]}>
      <ThemedText style={[styles.title, { color: tones.text }]}>{fr.social.suggestedTitle}</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((account) => {
          const followState = followStates.get(account.id) ?? 'none';
          const isFollowed = followState === 'accepted';
          const followDisabled = followState !== 'none';
          return (
            <View key={account.id} style={[styles.item, { borderColor: tones.cardBorder }]}>
              <Pressable
                onPress={() => setItems((current) => (current ?? []).filter((x) => x.id !== account.id))}
                hitSlop={Spacing.four}
                accessibilityRole="button"
                accessibilityLabel={fr.social.suggestedDismiss}
                style={styles.dismiss}>
                <Icon icon={X} size={14} color={tones.textFaint} />
              </Pressable>
              <Pressable
                onPress={() => router.push(`/user/${account.id}`)}
                accessibilityRole="button"
                style={styles.identity}>
                <Avatar name={account.displayName} uri={resolveMediaUrl(account.avatarUrl)} size={64} shape="circle" />
                <View style={styles.nameRow}>
                  <ThemedText numberOfLines={1} style={[styles.name, { color: tones.text }]}>
                    {account.displayName}
                  </ThemedText>
                  {account.verified ? (
                    <Icon icon={BadgeCheck} size={13} color={tones.verified} strokeWidth={2.4} />
                  ) : null}
                </View>
                <ThemedText type="caption" numberOfLines={1} style={{ color: tones.textSoft }}>
                  {account.mutualCount > 0
                    ? fr.social.suggestedMutual(account.mutualCount)
                    : fr.social.suggestedPopular}
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => void follow(account)}
                disabled={followDisabled}
                accessibilityRole="button"
                accessibilityState={{ disabled: followDisabled }}
                style={[
                  styles.follow,
                  followState !== 'none'
                    ? { backgroundColor: tones.badge }
                    : { backgroundColor: FeedSurface.follow },
                ]}>
                <ThemedText
                  style={[
                    styles.followText,
                    { color: followState === 'none' ? tones.onFollow : tones.text },
                  ]}>
                  {followState === 'pending'
                    ? fr.social.requested
                    : isFollowed
                      ? fr.social.suggestedFollowing
                      : fr.social.follow}
                </ThemedText>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.three,
    marginBottom: Spacing.four,
    gap: Spacing.two,
  },
  title: { ...Type.body, fontWeight: '700', paddingHorizontal: Spacing.three },
  row: { gap: Spacing.two, paddingHorizontal: Spacing.three },
  item: {
    width: FeedMetrics.suggestedCardWidth,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    padding: Spacing.three,
    alignItems: 'center',
    gap: Spacing.two,
  },
  dismiss: { position: 'absolute', right: Spacing.two, top: Spacing.two, zIndex: 1 },
  identity: { alignItems: 'center', gap: Spacing.half, width: '100%' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half, marginTop: Spacing.one, maxWidth: '100%' },
  name: { ...Type.caption, fontWeight: '700', flexShrink: 1 },
  follow: {
    alignSelf: 'stretch',
    minHeight: FeedMetrics.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm,
  },
  followText: { ...Type.caption, fontWeight: '700' },
});
