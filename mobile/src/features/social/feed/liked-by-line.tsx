import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Spacing, Type } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { formatCompactCount } from '@/lib/format';
import type { FeedPost } from '@/lib/types';
import { OnMediaShadow } from './pager/feed-tokens';

/** Avatar de la ligne « Aimé par ». */
const LIKED_BY_AVATAR = 18;

/**
 * Ligne « Aimé par X et N autres personnes » d'Instagram, partagée par le fil
 * (posts texte et média) et le détail d'une publication.
 *
 * - Un compte suivi a aimé (`post.likedBy`) : son avatar et son nom, cliquable.
 * - Sinon, « N J'aime », sauf avec `requireLikedBy` (quand le nombre est déjà
 *   affiché ailleurs, par exemple sur le rail d'actions ou le pied de carte).
 * - Aucun J'aime : rien.
 */
export function LikedByLine({
  post,
  color,
  onMedia = false,
  interactive = true,
  requireLikedBy = false,
}: {
  post: FeedPost;
  /** Couleur du texte (le nom est en gras dans la même teinte). */
  color: string;
  /** Posé sur une photo ou une vidéo : ombre portée pour rester lisible. */
  onMedia?: boolean;
  /** Le nom ouvre le profil ; désactivé dans l'aperçu du compositeur. */
  interactive?: boolean;
  /** N'afficher la ligne que si un compte suivi a aimé. */
  requireLikedBy?: boolean;
}) {
  const likes = post.counters.likes;
  const likedBy = post.likedBy ?? null;
  if (likes <= 0 || (requireLikedBy && !likedBy)) {
    return null;
  }
  const others = likes - 1;
  const textStyle = [styles.text, { color }, onMedia ? OnMediaShadow : null];

  return (
    <View style={styles.row}>
      {likedBy ? (
        <Avatar
          name={likedBy.displayName}
          uri={likedBy.avatarUrl}
          size={LIKED_BY_AVATAR}
          shape="circle"
        />
      ) : null}
      <ThemedText
        numberOfLines={1}
        style={textStyle}
        accessibilityLabel={
          likedBy ? fr.social.likedByA11y(likedBy.displayName, others) : undefined
        }>
        {likedBy ? (
          <>
            {fr.social.likedByPrefix}
            <ThemedText
              style={[...textStyle, styles.strong]}
              onPress={interactive ? () => router.push(`/user/${likedBy.id}`) : undefined}
              suppressHighlighting>
              {likedBy.displayName}
            </ThemedText>
            {others > 0 ? fr.social.likedByOthers(others, formatCompactCount(others)) : ''}
          </>
        ) : (
          fr.social.likesCount(likes, formatCompactCount(likes))
        )}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    maxWidth: '100%',
  },
  text: {
    ...Type.caption,
    flexShrink: 1,
  },
  strong: {
    fontWeight: '700',
  },
});
