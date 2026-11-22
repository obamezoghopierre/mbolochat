import { Bookmark, Forward, Heart, MessageCircle, Repeat2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import type { FeedPost } from '@/lib/types';
import { compactCount } from './feed-media';
import { feedText, useTextPostTones } from './feed-tokens';

/** Taille des icônes, celle du pied de post Instagram. */
const ICON = 24;

/**
 * Barre d'actions d'une carte, comme Instagram : J'aime, commentaire,
 * republication et partage groupés à gauche, chacun avec son compteur à côté
 * (masqué à 0) ; Enregistrer seul à droite.
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
  onPickCollection,
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
  /** Appui long sur Enregistrer : choisir une collection. */
  onPickCollection?: (() => void) | null;
  onToggleRepost: () => void;
  onShare: () => void;
}) {
  const tones = useTextPostTones();

  /** Tap sur J'aime : « pouls » du cœur, comme le double-tap. */
  const handleLike = () => {
    if (likeScale) {
      Animated.sequence([
        Animated.spring(likeScale, { toValue: 1.3, useNativeDriver: true, friction: 3 }),
        Animated.spring(likeScale, { toValue: 1, useNativeDriver: true, friction: 3 }),
      ]).start();
    }
    onToggleLike();
  };

  const handleSave = () => {
    void Haptics.selectionAsync().catch(() => undefined);
    onToggleSave();
  };

  const likeIcon = (
    <Icon
      icon={Heart}
      size={ICON}
      color={reacted ? tones.action : tones.text}
      fill={reacted ? tones.action : 'none'}
    />
  );

  const count = (value: number) =>
    value > 0 ? (
      <ThemedText style={[styles.count, { color: tones.text }]}>{compactCount(value)}</ThemedText>
    ) : null;

  return (
    <View style={styles.bar}>
      <View style={styles.group}>
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
            <Animated.View style={{ transform: [{ scale: likeScale }] }}>{likeIcon}</Animated.View>
          ) : (
            likeIcon
          )}
          {count(post.counters.likes)}
        </Pressable>

        <Pressable
          onPress={onOpenComments}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${post.counters.comments} commentaires`}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Icon icon={MessageCircle} size={ICON} color={tones.text} />
          {count(post.counters.comments)}
        </Pressable>

        <Pressable
          onPress={onToggleRepost}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ selected: reposted }}
          accessibilityLabel={reposted ? fr.social.repostedLabel : fr.social.repostLabel}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Icon icon={Repeat2} size={ICON} color={reposted ? tones.action : tones.text} />
          {count(post.counters.reposts)}
        </Pressable>

        <Pressable
          onPress={onShare}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={fr.social.shareLabel}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Icon icon={Forward} size={ICON} color={tones.text} />
          {count(post.counters.shares ?? 0)}
        </Pressable>
      </View>

      <Pressable
        onPress={handleSave}
        onLongPress={onPickCollection ?? undefined}
        delayLongPress={320}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ selected: saved }}
        accessibilityLabel={saved ? fr.social.savedLabel : fr.social.saveLabel}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
        <Icon
          icon={Bookmark}
          size={ICON}
          color={saved ? tones.action : tones.text}
          fill={saved ? tones.action : 'none'}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.one,
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  action: {
    // Icône puis compteur sur la même ligne, comme Instagram.
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: 44,
  },
  count: {
    ...feedText.caption,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  pressed: { opacity: 0.6 },
});
