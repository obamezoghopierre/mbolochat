import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Play, Volume2, VolumeX } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { extraMediaCount, primaryMedia } from './feed-media';
import { PostOverlay } from './post-overlay';
import type { FeedPost } from '@/lib/types';

/**
 * Page plein écran d'une publication vidéo, calquée sur le feed Mbolo :
 * vidéo couvrant l'écran, scrim bas, nom + description à gauche, colonne
 * d'actions à droite. Seule la page active joue ; les autres sont en pause.
 *
 * Adaptations assumées : pas de pager natif ni de dégradé natif (aucune
 * dépendance ajoutée), actions limitées à ce que l'API sait faire (réaction,
 * commentaire, abonnement) — pas de partage ni d'enregistrement simulés.
 */
export function VideoPage({
  post,
  height,
  isActive,
  onToggleLike,
  onOpenComments,
  onOpenProfile,
}: {
  post: FeedPost;
  height: number;
  isActive: boolean;
  onToggleLike: (post: FeedPost) => void;
  onOpenComments: () => void;
  onOpenProfile: () => void;
}) {
  const media = primaryMedia(post);
  const url = media?.url ?? null;

  const player = useVideoPlayer(url, (instance) => {
    instance.loop = true;
  });
  const { isPlaying } = useEvent(player, 'playingChange', {
    isPlaying: player.playing,
  });

  const [muted, setMuted] = useState(false);
  const [manuallyPaused, setManuallyPaused] = useState(false);

  useEffect(() => {
    // `muted` est une propriété impérative de l'API expo-video : la règle
    // d'immutabilité du React Compiler ne s'applique pas à un objet natif.
    // eslint-disable-next-line react-hooks/immutability
    player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    if (isActive && !manuallyPaused) {
      player.play();
    } else {
      player.pause();
    }
  }, [isActive, manuallyPaused, player]);

  const togglePlayback = useCallback(() => {
    setManuallyPaused((current) => !current);
  }, []);

  const extra = extraMediaCount(post);

  return (
    <View style={[styles.page, { height }]}>
      {url ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          pointerEvents="none"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback]}>
          <ActivityIndicator color="#ffffff" />
        </View>
      )}

      <Pressable
        onPress={togglePlayback}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Mettre en pause' : 'Lire la vidéo'}
        style={StyleSheet.absoluteFill}>
        {!isPlaying && isActive ? (
          <View style={styles.playBadge}>
            <Icon icon={Play} size={34} color="#ffffff" fill="#ffffff" />
          </View>
        ) : null}
      </Pressable>

      <View pointerEvents="none" style={styles.topScrim} />

      <View style={styles.topRight}>
        <Pressable
          onPress={() => setMuted((current) => !current)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={muted ? 'Activer le son' : 'Couper le son'}
          style={styles.roundButton}>
          <Icon icon={muted ? VolumeX : Volume2} size={18} color="#ffffff" />
        </Pressable>
        {extra > 0 ? (
          <View style={styles.counterPill}>
            <ThemedText type="small" style={styles.onVideoText}>
              +{extra}
            </ThemedText>
          </View>
        ) : null}
      </View>

      <PostOverlay
        post={post}
        onToggleLike={onToggleLike}
        onOpenComments={onOpenComments}
        onOpenProfile={onOpenProfile}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  onVideoText: {
    color: '#ffffff',
  },
  page: {
    backgroundColor: '#000000',
    justifyContent: 'flex-end',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 96,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },

  playBadge: {
    position: 'absolute',
    top: '45%',
    alignSelf: 'center',
    width: 74,
    height: 74,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },


  topRight: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  roundButton: {
    width: 36,
    height: 36,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterPill: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },













});
