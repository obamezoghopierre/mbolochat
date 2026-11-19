import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatMediaDuration } from './mediaLayout';
import { ImageSharePanel } from './ImageSharePanel';
import { Radii } from '@/constants/theme';

export interface MediaViewerItem {
  type: 'image' | 'video';
  uri: string;
  durationMs?: number;
}

interface ImageViewerProps {
  urls: string[];
  initialIndex: number;
  onClose: () => void;
}

const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;

function ZoomableImagePage({
  uri,
  index,
  onToggleChrome,
  onZoomChange,
  onRequestClose,
}: {
  uri: string;
  index: number;
  onToggleChrome: () => void;
  onZoomChange: (index: number, zoomed: boolean) => void;
  onRequestClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const dismissY = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);

  const reportZoom = useCallback(
    (isZoomed: boolean) => {
      setZoomed(isZoomed);
      onZoomChange(index, isZoomed);
    },
    [index, onZoomChange],
  );

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      'worklet';
      scale.value = Math.min(MAX_ZOOM, Math.max(1, savedScale.value * event.scale));
    })
    .onEnd(() => {
      'worklet';
      savedScale.value = scale.value;
      if (scale.value <= 1.02) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withSpring(0);
        ty.value = withSpring(0);
        savedTx.value = 0;
        savedTy.value = 0;
        runOnJS(reportZoom)(false);
      } else {
        runOnJS(reportZoom)(true);
      }
    });

  const panZoom = Gesture.Pan()
    .enabled(zoomed)
    .onUpdate((event) => {
      'worklet';
      const s = scale.value;
      const maxX = (width * (s - 1)) / 2 + 60;
      const maxY = (height * (s - 1)) / 2 + 60;
      tx.value = Math.min(maxX, Math.max(-maxX, savedTx.value + event.translationX));
      ty.value = Math.min(maxY, Math.max(-maxY, savedTy.value + event.translationY));
    })
    .onEnd(() => {
      'worklet';
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const panDismiss = Gesture.Pan()
    .enabled(!zoomed)
    .activeOffsetY([-12, 12])
    .failOffsetX([-40, 40])
    .onUpdate((event) => {
      'worklet';
      dismissY.value = event.translationY;
    })
    .onEnd((event) => {
      'worklet';
      if (Math.abs(dismissY.value) > 120 || Math.abs(event.velocityY) > 900) {
        runOnJS(onRequestClose)();
      } else {
        dismissY.value = withSpring(0, { damping: 24, stiffness: 240 });
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      'worklet';
      if (scale.value > 1.05) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withSpring(0);
        ty.value = withSpring(0);
        savedTx.value = 0;
        savedTy.value = 0;
        runOnJS(reportZoom)(false);
      } else {
        scale.value = withTiming(DOUBLE_TAP_ZOOM);
        savedScale.value = DOUBLE_TAP_ZOOM;
        runOnJS(reportZoom)(true);
      }
    });

  const singleTap = Gesture.Tap()
    .onEnd(() => {
      'worklet';
      runOnJS(onToggleChrome)();
    });

  const gesture = Gesture.Simultaneous(
    pinch,
    panZoom,
    panDismiss,
    Gesture.Exclusive(doubleTap, singleTap),
  );

  const pageStyle = useAnimatedStyle(() => {
    const isZoomed = scale.value > 1.02;
    return {
      opacity: 1 - Math.min(0.55, Math.abs(dismissY.value) / 480),
      transform: [
        { translateX: isZoomed ? tx.value : 0 },
        { translateY: (isZoomed ? ty.value : 0) + dismissY.value },
        { scale: scale.value },
      ],
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.page, { width, height }, pageStyle]}>
        <Image source={{ uri }} style={styles.image} contentFit="contain" />
      </Animated.View>
    </GestureDetector>
  );
}

function EdgeScrim({ height, top }: { height: number; top: boolean }) {
  const id = top ? 'scrimTop' : 'scrimBottom';
  return (
    <Svg style={{ height, width: '100%' }} pointerEvents="none">
      <Defs>
        <LinearGradient
          id={id}
          x1="0%"
          y1={top ? '0%' : '100%'}
          x2="0%"
          y2={top ? '100%' : '0%'}>
          <Stop offset="0" stopColor="#000000" stopOpacity={top ? 0.55 : 0} />
          <Stop offset="1" stopColor="#000000" stopOpacity={top ? 0 : 0.55} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

export function ImageViewer({ urls, initialIndex, onClose }: ImageViewerProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(initialIndex);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const zoomedRef = useRef(new Set<number>());
  const [zoomed, setZoomed] = useState(false);
  const listRef = useRef<FlatList<string>>(null);

  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: initialIndex * width, animated: false });
  }, [initialIndex, width]);

  const handleZoomChange = useCallback((index: number, isZoomed: boolean) => {
    const set = zoomedRef.current;
    if (isZoomed) set.add(index);
    else set.delete(index);
    setZoomed(set.size > 0);
  }, []);

  const toggleChrome = useCallback(() => setChromeVisible((value) => !value), []);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.backdrop}>
        <FlatList
          ref={listRef}
          data={urls}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          keyExtractor={(_, index) => String(index)}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          initialScrollIndex={initialIndex}
          onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
            setCurrent(Math.round(event.nativeEvent.contentOffset.x / width));
          }}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <ZoomableImagePage
              uri={item}
              index={index}
              onToggleChrome={toggleChrome}
              onZoomChange={handleZoomChange}
              onRequestClose={onClose}
            />
          )}
        />
        <EdgeScrim height={insets.top + 72} top />
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }} pointerEvents="none">
          <EdgeScrim height={insets.bottom + 96} top={false} />
        </View>
        <View
          pointerEvents={chromeVisible ? 'auto' : 'none'}
          style={[styles.chrome, { top: insets.top + 8, opacity: chromeVisible ? 1 : 0 }]}>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Fermer la visionneuse"
            style={styles.chromeButton}>
            <Ionicons name="close" size={24} color="#ffffff" />
          </Pressable>
          <Pressable
            onPress={() => setShareOpen(true)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Partager la photo"
            style={styles.chromeButton}>
            <Ionicons name="send-outline" size={22} color="#ffffff" />
          </Pressable>
        </View>
        {urls.length > 1 && chromeVisible ? (
          <View style={[styles.counter, { bottom: insets.bottom + 16 }]}>
            <Text style={styles.counterText}>
              {current + 1} / {urls.length}
            </Text>
          </View>
        ) : null}
        {shareOpen && urls[current] ? (
          <ImageSharePanel
            imageUrl={urls[current]}
            onClose={() => setShareOpen(false)}
            onSent={onClose}
          />
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

interface VideoViewerProps {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
}

function VideoPlayerScreen({ uri, onClose }: { uri: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(uri, (instance) => {
    instance.play();
  });

  return (
    <View style={styles.backdrop}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls
      />
      <Pressable
        onPress={onClose}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Fermer le lecteur vidéo"
        style={[styles.close, { top: insets.top + 8 }]}>
        <Ionicons name="close" size={28} color="#ffffff" />
      </Pressable>
    </View>
  );
}

export function VideoViewer({ visible, uri, onClose }: VideoViewerProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {visible && uri ? <VideoPlayerScreen uri={uri} onClose={onClose} /> : null}
    </Modal>
  );
}

function AlbumVideoPage({ item }: { item: MediaViewerItem }) {
  const player = useVideoPlayer(item.uri, (instance) => {
    instance.play();
  });
  return (
    <VideoView
      player={player}
      style={styles.albumVideo}
      contentFit="contain"
      nativeControls
    />
  );
}

function AlbumPage({ item, active }: { item: MediaViewerItem; active: boolean }) {
  if (item.type === 'image') {
    return <Image source={{ uri: item.uri }} style={styles.image} contentFit="contain" />;
  }
  if (active) {
    return <AlbumVideoPage item={item} />;
  }
  const duration = formatMediaDuration(item.durationMs);
  return (
    <View style={styles.albumVideoPlaceholder}>
      <View style={styles.albumPlayCircle}>
        <Ionicons name="play" size={30} color="#ffffff" />
      </View>
      {duration ? (
        <View style={styles.videoDurationPill}>
          <Text style={styles.counterText}>{duration}</Text>
        </View>
      ) : null}
    </View>
  );
}

interface AlbumViewerProps {
  items: MediaViewerItem[];
  initialIndex: number;
  onClose: () => void;
}

/** Visionneuse d'un album : photos et vidéos paginées dans le même geste. */
export function AlbumViewer({ items, initialIndex, onClose }: AlbumViewerProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(initialIndex);
  const listRef = useRef<FlatList<MediaViewerItem>>(null);

  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: initialIndex * width, animated: false });
  }, [initialIndex, width]);

  const updateCurrent = useCallback(
    (offset: number) => {
      const next = Math.max(0, Math.min(items.length - 1, Math.round(offset / width)));
      setCurrent(next);
    },
    [items.length, width],
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <FlatList
          ref={listRef}
          data={items}
          horizontal
          pagingEnabled
          keyExtractor={(item, index) => `${index}-${item.uri}`}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          initialScrollIndex={initialIndex}
          onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) =>
            updateCurrent(event.nativeEvent.contentOffset.x)
          }
          showsHorizontalScrollIndicator={false}
          windowSize={3}
          renderItem={({ item, index }) => (
            <View style={[styles.page, { width, height }]}>
              <AlbumPage item={item} active={index === current} />
            </View>
          )}
        />
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Fermer l’album"
          style={[styles.close, { top: insets.top + 8 }]}>
          <Ionicons name="close" size={28} color="#ffffff" />
        </Pressable>
        <View style={[styles.counter, { bottom: insets.bottom + 16 }]}>
          <Text style={styles.counterText}>
            {current + 1} / {items.length}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000000',
  },
  page: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  chrome: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chromeButton: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  close: {
    position: 'absolute',
    left: 16,
    width: 42,
    height: 42,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  counter: {
    position: 'absolute',
    alignSelf: 'center',
    borderRadius: Radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  counterText: {
    color: '#ffffff',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  video: {
    flex: 1,
  },
  albumVideo: {
    flex: 1,
    width: '100%',
  },
  albumVideoPlaceholder: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  albumPlayCircle: {
    width: 64,
    height: 64,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  videoDurationPill: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    borderRadius: Radii.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
});
