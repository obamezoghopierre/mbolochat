import { Check, Music2, Plus } from 'lucide-react-native';
import { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedMetrics, FeedSurface, Radii, Spacing } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { OnMediaShadow, feedText } from './feed-tokens';
import type { FeedPost } from '@/lib/types';

/** Longueur de légende affichée avant « voir plus ». */
const CAPTION_PREVIEW = 80;

/** Mot-clé (`#`) ou mention (`@`) : coloré dans la légende, comme Mbolo. */
const TOKEN_PATTERN = /(#[\w\u00C0-\u024F]+|@[\w\u00C0-\u024F]+)/g;

/**
 * Bloc d'informations posé sur le média, à gauche : auteur, légende dépliable,
 * hashtags mis en avant, lieu et ligne « son ».
 *
 * Tous les textes sont blancs avec ombre portée : la lisibilité ne dépend ni du
 * thème clair/sombre, ni de la luminosité de la photo. Aucun fond opaque qui
 * cacherait le média.
 */
export const PostInfoBlock = memo(function PostInfoBlock({
  post,
  following,
  followState,
  onFollow,
  onOpenProfile,
}: {
  post: FeedPost;
  following: boolean;
  followState: 'idle' | 'pending';
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
      <Pressable
        onPress={onOpenProfile}
        accessibilityRole="button"
        accessibilityLabel={`Voir le profil de ${post.author.displayName}`}
        style={styles.authorRow}>
        <ThemedText numberOfLines={1} style={[feedText.authorName, OnMediaShadow]}>
          {post.author.displayName}
          {post.author.verified ? (
            <ThemedText style={[feedText.authorName, styles.verified]}> ✓</ThemedText>
          ) : null}
        </ThemedText>
        {following ? (
          <View style={[styles.chip, styles.chipMuted]}>
            <Icon icon={Check} size={12} color="#FFFFFF" strokeWidth={3} />
          </View>
        ) : followState === 'pending' ? (
          <View style={[styles.chip, styles.chipMuted]}>
            <ThemedText style={[feedText.pill, styles.chipMutedText]}>
              {fr.social.requested}
            </ThemedText>
          </View>
        ) : (
          <Pressable
            onPress={onFollow}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Suivre ${post.author.displayName}`}
            style={({ pressed }) => [styles.chip, styles.chipAccent, pressed && styles.pressed]}>
            <Icon icon={Plus} size={12} color="#000000" strokeWidth={3} />
            <ThemedText style={[feedText.pill, styles.chipAccentText]}>
              {fr.social.follow}
            </ThemedText>
          </Pressable>
        )}
      </Pressable>

      {caption.length > 0 ? (
        <Pressable onPress={toggleCaption} accessibilityRole="button">
          <ThemedText style={[feedText.caption, OnMediaShadow]}>
            {renderTokens(shown)}
            {isLong ? (
              <ThemedText style={feedText.captionToggle}>
                {expanded ? ` ${fr.social.seeLess}` : ` ${fr.social.seeMore}`}
              </ThemedText>
            ) : null}
          </ThemedText>
        </Pressable>
      ) : null}

      <View style={styles.soundRow}>
        <Icon icon={Music2} size={13} color="#FFFFFF" />
        <ThemedText numberOfLines={1} style={[feedText.sound, OnMediaShadow, styles.soundText]}>
          {fr.social.originalSound} · {post.author.displayName}
        </ThemedText>
      </View>
    </View>
  );
});

/** Colorie les `#hashtags` et `@mentions` sans casser le reste du texte. */
function renderTokens(text: string) {
  return text.split(TOKEN_PATTERN).map((part, index) =>
    part.startsWith('#') || part.startsWith('@') ? (
      <ThemedText key={`${part}-${index}`} style={[feedText.caption, styles.token]}>
        {part}
      </ThemedText>
    ) : (
      part
    ),
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
  verified: {
    ...feedText.authorName,
    color: '#5AA9FF',
    fontSize: FeedMetrics.avatar / 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radii.full,
  },
  chipAccent: {
    backgroundColor: FeedSurface.follow,
  },
  chipAccentText: {
    color: '#000000',
  },
  chipMuted: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  chipMutedText: {
    color: '#FFFFFF',
  },
  token: {
    ...feedText.caption,
    fontWeight: '700',
  },
  soundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    maxWidth: '100%',
  },
  soundText: {
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.75,
  },
});
