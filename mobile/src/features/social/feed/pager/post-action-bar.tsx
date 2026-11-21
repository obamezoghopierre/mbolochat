import { Bookmark, Forward, Heart, MessageCircle, Repeat2 } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedSurface, Spacing } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import type { FeedPost } from '@/lib/types';
import { compactCount } from './feed-media';
import { feedText, useTextPostTones } from './feed-tokens';

/**
 * Barre d'actions d'une publication texte, calquée sur le pied de post
 * Instagram : cœur, commentaire, republication, partage à gauche et
 * enregistrement à droite — horizontale, pas de rail vertical.
 * Chaque icône porte son compteur compact quand il est non nul.
 */
export function PostActionBar({
  post,
  reacted,
  saved,
  reposted,
  likeScale,
  onToggleLike,
  onPickReaction,
  onOpenComments,
  onToggleSave,
  onToggleRepost,
  onShare,
}: {
  post: FeedPost;
  reacted: boolean;
  saved: boolean;
  reposted: boolean;
  likeScale?: Animated.Value;
  onToggleLike: () => void;
  onPickReaction?: (() => void) | null;
  onOpenComments: () => void;
  onToggleSave: () => void;
  onToggleRepost: () => void;
  onShare: () => void;
}) {
  const tones = useTextPostTones();
  const likeIcon = (
    <Icon
      icon={Heart}
      size={22}
      color={reacted ? tones.action : tones.text}
      fill={reacted ? tones.action : 'none'}
    />
  );

  /** Tap sur J'aime : petit « pouls » du cœur, comme le double-tap des pages média. */
  const handleLike = () => {
    if (likeScale) {
      Animated.sequence([
        Animated.spring(likeScale, { toValue: 1.3, useNativeDriver: true, friction: 3 }),
        Animated.spring(likeScale, { toValue: 1, useNativeDriver: true, friction: 3 }),
      ]).start();
    }
    onToggleLike();
  };

  /** Icône + compteur compact en dessous, toujours visible (0 inclus). */
  const actionContent = (icon: ReactNode, count: number) => (
    <>
      {icon}
      <ThemedText style={[styles.count, { color: tones.textSoft }]}>
        {compactCount(count)}
      </ThemedText>
    </>
  );

  return (
    <View style={styles.bar}>
      <Pressable
        onPress={handleLike}
        onLongPress={onPickReaction ?? undefined}
        delayLongPress={320}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ selected: reacted }}
        accessibilityLabel={
          reacted
            ? `${fr.social.unlikeAccessibility} (${post.counters.likes})`
            : `${fr.social.likeAccessibility} (${post.counters.likes})`
        }
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
        {likeScale ? (
          <Animated.View
            style={{
              transform: [{ scale: likeScale }],
              // Garde l'empilement icône/compteur centré comme les autres actions.
              alignItems: 'center',
            }}>
            {actionContent(likeIcon, post.counters.likes)}
          </Animated.View>
        ) : (
          actionContent(likeIcon, post.counters.likes)
        )}
      </Pressable>

      <Pressable
        onPress={onOpenComments}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${post.counters.comments} commentaires`}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
        {actionContent(
          <Icon icon={MessageCircle} size={22} color={tones.text} />,
          post.counters.comments,
        )}
      </Pressable>

      <Pressable
        onPress={onToggleRepost}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ selected: reposted }}
        accessibilityLabel={reposted ? fr.social.repostedLabel : fr.social.repostLabel}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
        {actionContent(
          <Icon
            icon={Repeat2}
            size={22}
            color={reposted ? tones.action : tones.text}
          />,
          post.counters.reposts,
        )}
      </Pressable>

      <Pressable
        onPress={onShare}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={fr.social.shareLabel}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
        {actionContent(
          <Icon icon={Forward} size={22} color={tones.text} />,
          post.counters.shares ?? 0,
        )}
      </Pressable>

      <Pressable
        onPress={onToggleSave}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ selected: saved }}
        accessibilityLabel={saved ? fr.social.savedLabel : fr.social.saveLabel}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
        {actionContent(
          <Icon
            icon={Bookmark}
            size={22}
            color={saved ? tones.action : tones.text}
            fill={saved ? tones.action : 'none'}
          />,
          post.counters.saves,
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    // Les actions se répartissent sur toute la largeur de la carte :
    // plus d'espace mort entre « Partager » et « Sauvegarder ».
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  action: {
    // Icône au-dessus, compteur compact en dessous — comme le rail vertical.
    flexDirection: 'column',
    alignItems: 'center',
    gap: Spacing.half,
    minWidth: 32,
    minHeight: 44,
    paddingHorizontal: Spacing.half,
    justifyContent: 'center',
  },
  count: {
    ...feedText.caption,
    fontWeight: '700',
    color: FeedSurface.onMediaSoft,
  },
  pressed: { opacity: 0.7 },
});
