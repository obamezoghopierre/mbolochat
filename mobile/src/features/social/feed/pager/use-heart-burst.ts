import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

import { Motion } from '@/constants/theme';

/**
 * Animation du cœur au double-tap, façon TikTok : le cœur apparaît gros,
 * remonte brièvement puis s'efface. Une seule `Animated.Value` par page, donc
 * aucun rendu React par image.
 *
 * Retourne l'opacité, l'échelle et la fonction à appeler au double-tap.
 */
export function useHeartBurst() {
  // `useState` et non `useRef` : la valeur est lue au rendu (interpolations),
  // ce que la règle `react-hooks/refs` interdit pour une ref.
  const [progress] = useState(() => new Animated.Value(0));
  const running = useRef<Animated.CompositeAnimation | null>(null);

  const burst = useCallback(() => {
    running.current?.stop();
    progress.setValue(0);
    running.current = Animated.sequence([
      Animated.timing(progress, {
        toValue: 1,
        duration: Motion.base,
        easing: Easing.out(Easing.back(1.7)),
        useNativeDriver: true,
      }),
      Animated.delay(260),
      Animated.timing(progress, {
        toValue: 0,
        duration: Motion.screen,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    running.current.start();
  }, [progress]);

  useEffect(
    () => () => {
      const animation = running.current;
      animation?.stop();
    },
    [],
  );

  const { opacity, scale, translateY } = useMemo(
    () => ({
      opacity: progress.interpolate({
        inputRange: [0, 0.12, 0.76, 1],
        outputRange: [0, 1, 1, 0],
      }),
      scale: progress.interpolate({
        inputRange: [0, 0.42, 1],
        outputRange: [0.45, 1, 0.9],
      }),
      translateY: progress.interpolate({
        inputRange: [0, 0.42, 1],
        outputRange: [0, -12, -48],
      }),
    }),
    [progress],
  );

  return { burst, opacity, scale, translateY };
}
