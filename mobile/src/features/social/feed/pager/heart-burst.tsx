import { Heart } from 'lucide-react-native';
import { useEffect } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { FeedMetrics, FeedSurface } from '@/constants/theme';
import { useHeartBurst } from './use-heart-burst';

/**
 * Cœur du double-tap : dessiné au centre du média, jamais interactif.
 *
 * Le déclencheur est le geste de la page (`FeedGestureLayer`) ; cette surcouche
 * ne reçoit que le compteur de déclenchements pour rejouer l'animation. Un
 * compteur plutôt qu'un booléen permet deux double-taps consécutifs sans
 * attendre la fin de l'animation.
 */
export function HeartBurstOverlay({
  burstKey,
  point,
}: {
  burstKey: number;
  /** Point du double-tap : le cœur naît sous le doigt, comme sur TikTok. */
  point?: { x: number; y: number } | null;
}) {
  const { burst, opacity, scale, translateY } = useHeartBurst();

  // `burstKey` change uniquement sur un double-tap : l'effet rejoue l'animation.
  // Aucune valeur passée à un hook n'est mutée ici (règle du React Compiler).
  useEffect(() => {
    if (burstKey > 0) {
      burst();
    }
  }, [burst, burstKey]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        point ? styles.atPoint : styles.center,
        point
          ? {
              left: point.x - FeedMetrics.heart / 2,
              top: point.y - FeedMetrics.heart / 2,
            }
          : null,
        { opacity, transform: [{ translateY }, { scale }] },
      ]}>
      <View style={styles.glow}>
        <Icon
          icon={Heart}
          size={FeedMetrics.heart}
          color={FeedSurface.like}
          fill={FeedSurface.like}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  atPoint: {
    position: 'absolute',
  },
  glow: {
    shadowColor: FeedSurface.like,
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
});
