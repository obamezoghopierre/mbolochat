import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';

/** Délai sous lequel deux taps comptent comme un double-tap (repère iOS). */
export const DOUBLE_TAP_DELAY = 280;

/**
 * Gestes du feed plein écran :
 *
 * - **deux taps rapides** → réaction (jamais retirée par un double-tap) ;
 * - **un seul tap** → lecture / pause ou flip du carrousel, après confirmation
 *   que ce n'était pas un double-tap ;
 * - **appui long** → pause tant que le doigt reste posé.
 *
 * Le tap simple est différé de `DOUBLE_TAP_DELAY` : c'est le prix à payer pour
 * ne jamais mettre en pause au moment où l'utilisateur double-tape — la référence fait
 * la même chose, reporter le simple tap d'une fraction de seconde est invisible.
 */
export function FeedGestureLayer({
  onDoubleTap,
  onTap,
  onLongPressStart,
  onLongPressEnd,
  accessibilityLabel,
}: {
  /** Reçoit le point du double-tap (coordonnées relatives au média). */
  onDoubleTap: (point: { x: number; y: number } | null) => void;
  onTap: () => void;
  onLongPressStart: () => void;
  onLongPressEnd: () => void;
  accessibilityLabel: string;
}) {
  const lastTap = useRef(0);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);

  const clearTimers = useCallback(() => {
    if (singleTapTimer.current) {
      clearTimeout(singleTapTimer.current);
      singleTapTimer.current = undefined;
    }
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = undefined;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const handlePressIn = useCallback((event?: { nativeEvent?: { locationX?: number; locationY?: number } }) => {
    const x = event?.nativeEvent?.locationX;
    const y = event?.nativeEvent?.locationY;
    lastPoint.current = typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
    longPressed.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressed.current = true;
      onLongPressStart();
    }, 450);
  }, [onLongPressStart]);

  const handlePressOut = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = undefined;
    }
    if (longPressed.current) {
      longPressed.current = false;
      onLongPressEnd();
      return;
    }

    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_DELAY) {
      lastTap.current = 0;
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = undefined;
      }
      onDoubleTap(lastPoint.current);
      return;
    }
    lastTap.current = now;
    singleTapTimer.current = setTimeout(() => {
      singleTapTimer.current = undefined;
      lastTap.current = 0;
      onTap();
    }, DOUBLE_TAP_DELAY);
  }, [onDoubleTap, onLongPressEnd, onTap]);

  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="imagebutton"
      accessibilityLabel={accessibilityLabel}
    />
  );
}
