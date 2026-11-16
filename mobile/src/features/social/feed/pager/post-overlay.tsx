import { Check, Heart, MessageCircle, Plus } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing, Type } from '@/constants/theme';
import { compactCount } from './feed-media';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { FeedPost } from '@/lib/types';

/**
 * Surcouche commune aux pages du pager : nom, description, pastille
 * d'abonnement à gauche, colonne de réactions à droite, scrim pour la lisibilité
 * sur n'importe quel média.
 */
export function PostOverlay({
  post,
  onToggleLike,
  onOpenComments,
  onOpenProfile,
}: {
  post: FeedPost;
  onToggleLike: (post: FeedPost) => void;
  onOpenComments: () => void;
  onOpenProfile: () => void;
}) {
  const { token } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [followState, setFollowState] = useState<'idle' | 'following' | 'pending'>(
    post.viewer.followingAuthor ? 'following' : 'idle',
  );

  const follow = useCallback(async () => {
    if (!token || followState !== 'idle') {
      return;
    }
    setFollowState('following');
    try {
      const result = await api.followUser(token, post.author.id);
      setFollowState(result.status === 'pending' ? 'pending' : 'following');
    } catch {
      // Blocage, compte privé ou réseau : la pastille redevient actionnable.
      setFollowState('idle');
    }
  }, [followState, post.author.id, token]);

  const caption = post.caption ?? '';
  const isLong = caption.length > 90;
  const shown = expanded || !isLong ? caption : `${caption.slice(0, 90).trimEnd()}… `;
  const reacted = post.viewer.reaction !== null;

  return (
    <>
      <View pointerEvents="none" style={styles.bottomScrim} />

      <View style={styles.actionRail}>
        <Pressable
          onPress={() => onToggleLike(post)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ selected: reacted }}
          accessibilityLabel={
            reacted
              ? `Retirer ma réaction (${post.counters.likes})`
              : `Réagir (${post.counters.likes})`
          }
          style={styles.action}>
          <Icon
            icon={Heart}
            size={30}
            color={reacted ? '#FF4D67' : '#ffffff'}
            fill={reacted ? '#FF4D67' : 'none'}
          />
          <ThemedText type="small" style={[styles.actionLabel, styles.onMedia]}>
            {compactCount(post.counters.likes)}
          </ThemedText>
        </Pressable>

        <Pressable
          onPress={onOpenComments}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${post.counters.comments} commentaires`}
          style={styles.action}>
          <Icon icon={MessageCircle} size={30} color="#ffffff" />
          <ThemedText type="small" style={[styles.actionLabel, styles.onMedia]}>
            {compactCount(post.counters.comments)}
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.info}>
        <View style={styles.authorRow}>
          <Pressable
            onPress={onOpenProfile}
            accessibilityRole="button"
            accessibilityLabel={`Voir le profil de ${post.author.displayName}`}>
            <Avatar name={post.author.displayName} uri={post.author.avatarUrl} size={38} />
          </Pressable>
          <Pressable onPress={onOpenProfile} accessibilityRole="button" style={styles.nameBlock}>
            <ThemedText style={[styles.authorName, styles.onMedia]} numberOfLines={1}>
              {post.author.displayName}
              {post.author.verified ? ' ✓' : ''}
            </ThemedText>
            <ThemedText type="small" style={[styles.authorHandle, styles.onMedia]}>
              @{post.author.username}
            </ThemedText>
          </Pressable>
          {post.viewer.followingAuthor || followState === 'following' ? (
            <View style={styles.followPill}>
              <Icon icon={Check} size={14} color="#000000" strokeWidth={3} />
              <ThemedText type="small" style={styles.followPillText}>
                Suivi
              </ThemedText>
            </View>
          ) : followState === 'pending' ? (
            <View style={styles.followPill}>
              <ThemedText type="small" style={styles.followPillText}>
                Demandé
              </ThemedText>
            </View>
          ) : (
            <Pressable
              onPress={() => void follow()}
              accessibilityRole="button"
              accessibilityLabel={`Suivre ${post.author.displayName}`}
              style={styles.followPill}>
              <Icon icon={Plus} size={14} color="#000000" strokeWidth={3} />
              <ThemedText type="small" style={styles.followPillText}>
                Suivre
              </ThemedText>
            </Pressable>
          )}
        </View>

        {caption.length > 0 ? (
          <Pressable
            onPress={() => (isLong ? setExpanded((current) => !current) : onOpenComments())}
            accessibilityRole="button">
            <ThemedText style={[styles.caption, styles.onMedia]}>
              {shown}
              {isLong && !expanded ? (
                <ThemedText type="small" style={styles.more}>
                  voir plus
                </ThemedText>
              ) : null}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  bottomScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 240,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  actionRail: {
    position: 'absolute',
    right: Spacing.three,
    bottom: 96,
    alignItems: 'center',
    gap: Spacing.four,
  },
  action: {
    alignItems: 'center',
    gap: Spacing.one,
    minWidth: 48,
  },
  actionLabel: {
    fontWeight: '600',
  },
  onMedia: {
    color: '#ffffff',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  info: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    paddingRight: 80,
    gap: Spacing.two,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  nameBlock: {
    flexShrink: 1,
  },
  authorName: {
    ...Type.body,
    fontWeight: '700',
  },
  authorHandle: {
    opacity: 0.9,
  },
  followPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ffffff',
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Radii.full,
  },
  followPillText: {
    color: '#000000',
    fontWeight: '700',
  },
  caption: {
    ...Type.body,
  },
  more: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
