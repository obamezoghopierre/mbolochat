import {
  Bookmark,
  Ellipsis,
  Forward,
  Heart,
  MessageCircle,
  Plus,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { memo, useCallback } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { resolveMediaUrl } from '@/lib/media-url';
import { ThemedText } from '@/components/themed-text';
import { FeedMetrics, FeedSurface, PressScale, Spacing } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { compactCount } from './feed-media';
import { OnMediaShadow, feedText } from './feed-tokens';
import type { FeedPost } from '@/lib/types';

export interface FeedActions {
  onToggleLike: () => void;
  /** Appui long sur le cœur : ouvre le sélecteur de réaction. */
  onPickReaction?: (() => void) | null;
  onOpenComments: () => void;
  onToggleSave: () => void;
  /** Appui long sur Enregistrer : choisir une collection (Instagram). */
  onPickCollection?: (() => void) | null;
  onToggleRepost: () => void;
  onShare: () => void;
  /** ⋯ de l'en-tête : menu d'options de la publication. */
  onMore?: () => void;
  onOpenProfile: () => void;
  /** Abonnement : `null` quand c'est son propre contenu ou déjà abonné. */
  onFollow: (() => void) | null;
}

export interface FeedActionState {
  reacted: boolean;
  saved: boolean;
  reposted: boolean;
  following: boolean;
  /** Retour visuel bref après un repost (comme le toast de Mbolo). */
  toast: string | null;
}

/**
 * Rail d'actions vertical, à droite, calqué sur les fils vidéo : avatar de
 * l'auteur surmonté d'une pastille « + », puis réaction, commentaires,
 * enregistrement, republication et partage. Les options de modération
 * vivent dans la feuille Partager.
 *
 * Chaque action est câblée sur une capacité réelle de l'API ; aucune n'est
 * décorative. Les compteurs viennent du serveur (état optimiste côté écran).
 */
/** Avatar de l'auteur en tête du rail (TikTok). */
const RAIL_AVATAR = 44;

export const FeedActionRail = memo(function FeedActionRail({
  post,
  state,
  actions,
  likeScale,
}: {
  post: FeedPost;
  state: FeedActionState;
  actions: FeedActions;
  likeScale: Animated.Value;
}) {
  return (
    <View style={styles.rail} pointerEvents="box-none">
      {/* Auteur en tête du rail, comme TikTok : avatar rond et pastille « + »
          pour s'abonner, qui disparaît une fois abonné. */}
      <View style={styles.authorSlot}>
        <Pressable
          onPress={actions.onOpenProfile}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Voir le profil de ${post.author.displayName}`}
          style={({ pressed }) => pressed && styles.pressed}>
          <View style={styles.avatarRing}>
            <Avatar
              name={post.author.displayName}
              uri={resolveMediaUrl(post.author.avatarUrl)}
              size={RAIL_AVATAR}
            />
          </View>
        </Pressable>
        {actions.onFollow && !state.following ? (
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              actions.onFollow?.();
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Suivre ${post.author.displayName}`}
            style={({ pressed }) => [styles.followBadge, pressed && styles.pressed]}>
            <Icon icon={Plus} size={14} color="#000000" strokeWidth={3} />
          </Pressable>
        ) : null}
      </View>

      <RailAction
        icon={Heart}
        label={compactCount(post.counters.likes)}
        accessibilityLabel={
          state.reacted
            ? `${fr.social.unlikeAccessibility} (${post.counters.likes})`
            : `${fr.social.likeAccessibility} (${post.counters.likes})`
        }
        selected={state.reacted}
        color={state.reacted ? FeedSurface.like : FeedSurface.onMedia}
        fill={state.reacted ? FeedSurface.like : 'none'}
        onPress={actions.onToggleLike}
        onLongPress={actions.onPickReaction ?? undefined}
        scale={likeScale}
      />

      <RailAction
        icon={MessageCircle}
        label={compactCount(post.counters.comments)}
        accessibilityLabel={`${post.counters.comments} commentaires`}
        onPress={actions.onOpenComments}
      />

      {/* Partager, comme TikTok : la feuille porte aussi Republier, Copier le
          lien et les options (signaler, pas intéressé…). */}
      <RailAction
        icon={Forward}
        label={
          (post.counters.shares ?? 0) + post.counters.reposts > 0
            ? compactCount((post.counters.shares ?? 0) + post.counters.reposts)
            : fr.social.shareShort
        }
        accessibilityLabel={fr.social.shareLabel}
        selected={state.reposted}
        color={state.reposted ? FeedSurface.reposted : FeedSurface.onMedia}
        onPress={actions.onShare}
      />

      {/* Libellé = compteur : un mot complet (« Enregistrer »)
          ne tient pas dans 64 px dès que la police système est agrandie. */}
      <RailAction
        icon={Bookmark}
        label={compactCount(post.counters.saves)}
        accessibilityLabel={state.saved ? fr.social.savedLabel : fr.social.saveLabel}
        selected={state.saved}
        color={state.saved ? FeedSurface.save : FeedSurface.onMedia}
        fill={state.saved ? FeedSurface.save : 'none'}
        onPress={() => {
          void Haptics.selectionAsync().catch(() => undefined);
          actions.onToggleSave();
        }}
        onLongPress={actions.onPickCollection ?? undefined}
      />

      {/* « ⋯ » en fin de rail, comme Instagram : options de la publication
          (enregistrer dans une collection, lien, QR, modération…). */}
      {actions.onMore ? (
        <RailAction
          icon={Ellipsis}
          label=""
          accessibilityLabel={fr.social.shareMoreOptions}
          onPress={actions.onMore}
        />
      ) : null}
    </View>
  );
});

function RailAction({
  icon,
  label,
  accessibilityLabel,
  onPress,
  onLongPress,
  color = FeedSurface.onMedia,
  fill = 'none',
  selected = false,
  scale,
}: {
  icon: LucideIcon;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  onLongPress?: () => void;
  color?: string;
  fill?: string;
  selected?: boolean;
  scale?: Animated.Value;
}) {
  const handlePress = useCallback(() => onPress(), [onPress]);
  const content = (
    <Icon icon={icon} size={FeedMetrics.actionIcon} color={color} fill={fill} />
  );

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={onLongPress}
      delayLongPress={320}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.action,
        pressed && { transform: [{ scale: PressScale }] },
      ]}>
      {scale ? <Animated.View style={{ transform: [{ scale }] }}>{content}</Animated.View> : content}
      {label ? (
        <ThemedText numberOfLines={1} style={[styles.actionLabel, OnMediaShadow]}>
          {label}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Le rail participe au flux (pas `position: absolute`) : il partage ainsi la
  // même ancre basse que le bloc infos posé à sa gauche, au lieu de descendre
  // jusqu'au bas de la page.
  authorSlot: {
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  avatarRing: {
    borderRadius: RAIL_AVATAR,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  // Pastille « + » à cheval sur le bas de l'avatar, jaune de la marque.
  followBadge: {
    position: 'absolute',
    bottom: -9,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FeedSurface.follow,
  },
  rail: {
    width: FeedMetrics.railWidth,
    alignItems: 'center',
    gap: FeedMetrics.actionGap,
  },
  pressed: {
    opacity: 0.7,
  },
  // Zone tactile réduite mais toujours confortable (>= 44 pt recommandé sur
  // iOS pour les priorisées) : les icônes font 26 px, le libellé tient sur une
  // ligne, et `hitSlop` élargit la cible sans élargir le dessin.
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 42,
  },
  // Borné à la largeur du rail : avec la mise à l'échelle système des polices,
  // un libellé long (« Enregistrer ») ne doit jamais déborder de l'écran.
  actionLabel: {
    ...feedText.actionLabel,
    marginTop: Spacing.half,
    textAlign: 'center',
    maxWidth: FeedMetrics.railWidth - Spacing.one,
  },
});
