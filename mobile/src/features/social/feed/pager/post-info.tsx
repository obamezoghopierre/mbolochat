import { router } from 'expo-router';
import { BadgeCheck, Music2 } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedMetrics, FeedSurface, Radii, Spacing, Type } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { formatCompactCount } from '@/lib/format';
import { resolveMediaUrl } from '@/lib/media-url';
import { OnMediaShadow, feedText } from './feed-tokens';
import { renderTokens } from './rich-text';
import { LikedByLine } from '../liked-by-line';
import type { FeedPost } from '@/lib/types';

/** Longueur de légende affichée avant « voir plus ». */
const CAPTION_PREVIEW = 80;

/** Avatar de l'auteur, posé sur la vidéo. */
const AUTHOR_AVATAR = FeedMetrics.authorAvatar;

/** Rotation d'un tour du disque « son original ». */
const DISC_PERIOD_MS = 3200;

/**
 * Bloc d'informations posé sur le média, à gauche : auteur, légende dépliable,
 * hashtags mis en avant et ligne « son » avec disque tournant.
 *
 * Tous les textes sont blancs avec ombre portée : la lisibilité ne dépend ni du
 * thème clair/sombre, ni de la luminosité de la photo. Aucun fond opaque qui
 * cacherait le média.
 */
export const PostInfoBlock = memo(function PostInfoBlock({
  post,
  following,
  followState,
  showCaption = true,
  railHasAuthor = false,
  onFollow,
  onOpenProfile,
}: {
  post: FeedPost;
  following: boolean;
  followState: 'idle' | 'pending';
  /** Les posts texte affichent déjà leur contenu dans la carte du pager. */
  showCaption?: boolean;
  /**
   * Le rail porte déjà l'avatar et le « + » (TikTok) : ici, seulement le nom,
   * pour ne pas répéter l'avatar ni le bouton Suivre.
   */
  railHasAuthor?: boolean;
  onFollow: () => void;
  onOpenProfile: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const caption = (post.caption ?? '').trim();
  const isLong = caption.length > CAPTION_PREVIEW;
  const shown = expanded || !isLong ? caption : `${caption.slice(0, CAPTION_PREVIEW).trimEnd()}…`;

  const toggleCaption = useCallback(() => setExpanded((value) => !value), []);

  return (
    <View style={styles.root}>
      {/* Auteur façon Reels : avatar rond, nom, badge vérifié, puis
          « Suivre » encadré (rien quand on suit déjà). */}
      <View style={styles.authorRow}>
        <Pressable
          onPress={onOpenProfile}
          accessibilityRole="button"
          accessibilityLabel={`Voir le profil de ${post.author.displayName}${
            post.author.verified ? `, ${fr.social.verifiedAccount}` : ''
          }`}
          style={({ pressed }) => [styles.authorIdentity, pressed && styles.pressed]}>
          {railHasAuthor ? null : (
            <Avatar
              name={post.author.displayName}
              uri={resolveMediaUrl(post.author.avatarUrl)}
              size={AUTHOR_AVATAR}
            />
          )}
          <ThemedText numberOfLines={1} style={[styles.authorName, OnMediaShadow]}>
            {post.author.displayName}
          </ThemedText>
          {post.author.verified ? (
            <Icon icon={BadgeCheck} size={15} color={FeedSurface.verified} strokeWidth={2.4} />
          ) : null}
        </Pressable>
        {following || railHasAuthor ? null : followState === 'pending' ? (
          <View style={styles.followOutline}>
            <ThemedText style={[feedText.pill, styles.followText]}>{fr.social.requested}</ThemedText>
          </View>
        ) : (
          <Pressable
            onPress={onFollow}
            hitSlop={Spacing.four}
            accessibilityRole="button"
            accessibilityLabel={`Suivre ${post.author.displayName}`}
            style={({ pressed }) => [styles.followTextButton, pressed && styles.pressed]}>
            <ThemedText style={[feedText.pill, { color: FeedSurface.follow }]}>
              {fr.social.follow}
            </ThemedText>
          </Pressable>
        )}
      </View>

      {/* « Aimé par X » : seulement si un compte suivi a aimé (le nombre de
          J'aime est déjà sur le rail d'actions). */}
      <LikedByLine post={post} color={FeedSurface.onMedia} onMedia requireLikedBy />

      {/* Republication dans le fil Abonnements : « X a republié »,
          comme Instagram — le tap mène au profil du reposter. */}
      {post.repostedBy ? (
        <Pressable
          onPress={() => router.push(`/user/${post.repostedBy!.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Voir le profil de ${post.repostedBy.displayName}`}>
          <ThemedText style={[feedText.caption, OnMediaShadow, styles.quotedFrom]}>
            {fr.social.republishedBy(post.repostedBy.displayName)}
          </ThemedText>
        </Pressable>
      ) : null}

      {/* Citation : le média vient de la publication d'origine, la ligne
          mène à l'originale. */}
      {post.quoted ? (
        <Pressable
          onPress={() => router.push(`/post/${post.quoted!.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Voir la publication de ${post.quoted.authorDisplayName}`}>
          <ThemedText style={[feedText.caption, OnMediaShadow, styles.quotedFrom]}>
            {fr.social.quotedFrom(post.quoted.authorDisplayName)}
          </ThemedText>
          {post.quoted.caption ? (
            <ThemedText numberOfLines={2} style={[feedText.caption, OnMediaShadow, styles.quotedCaption]}>
              {post.quoted.caption}
            </ThemedText>
          ) : null}
        </Pressable>
      ) : null}

      {caption.length > 0 && showCaption ? (
        <Pressable
          onPress={toggleCaption}
          accessibilityRole="button"
          accessibilityLabel={isLong ? (expanded ? fr.social.seeLess : fr.social.seeMore) : undefined}
          accessibilityState={{ expanded }}>
          <ThemedText style={[feedText.caption, OnMediaShadow]}>
            {renderTokens(shown, [feedText.caption, styles.token])}
            {isLong ? (
              <ThemedText style={feedText.captionToggle}>
                {expanded ? ` ${fr.social.seeLess}` : ` ${fr.social.seeMore}`}
              </ThemedText>
            ) : null}
          </ThemedText>
        </Pressable>
      ) : null}

      <View style={styles.soundRow}>
        <SpinningDisc />
        <ThemedText numberOfLines={1} style={[feedText.sound, OnMediaShadow, styles.soundText]}>
          {fr.social.originalSound} · {post.author.displayName}
        </ThemedText>
        {post.counters.views > 0 ? (
          <ThemedText style={[feedText.sound, OnMediaShadow, styles.viewsText]}>
            {formatCompactCount(post.counters.views)} {fr.social.viewsUnit}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
});

/** Petit disque qui tourne, signature visuelle de la ligne « son ». */
function SpinningDisc() {
  const spin = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: DISC_PERIOD_MS,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotation = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View style={[styles.disc, { transform: [{ rotate: rotation }] }]}>
      <Icon icon={Music2} size={11} color={FeedSurface.onMedia} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  authorIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  authorName: {
    ...Type.body,
    fontWeight: '700',
    color: FeedSurface.onMedia,
    flexShrink: 1,
  },
  // « Suivre » des Reels : texte blanc dans un cadre fin, sans fond.
  followOutline: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: FeedSurface.onMediaSoft,
  },
  followText: {
    color: FeedSurface.onMedia,
  },
  // « Suivre » actif : texte jaune de la marque, comme les suggestions.
  followTextButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  token: {
    ...feedText.caption,
    fontWeight: '700',
  },
  soundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    maxWidth: '100%',
  },
  disc: {
    width: FeedMetrics.soundDisc,
    height: FeedMetrics.soundDisc,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FeedSurface.glassStrong,
    borderWidth: 1,
    borderColor: FeedSurface.onMediaFaint,
  },
  soundText: {
    flexShrink: 1,
  },
  viewsText: {
    flexShrink: 0,
    opacity: 0.85,
  },
  pressed: {
    opacity: 0.75,
  },
  quotedFrom: {
    fontWeight: '600',
  },
  quotedCaption: {
    opacity: 0.85,
  },
});
