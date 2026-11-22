import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  type CameraType,
  type FlashMode,
} from 'expo-camera';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MediaSurface, Radii, Spacing } from '@/constants/theme';
import { MAX_PLAINTEXT_BYTES } from '@/features/e2ee/media';
import { MediaFilterOverlay } from '@/features/media/media-filter';
import {
  isRejectedMedia,
  normalizeLocalMedia,
  pickLibraryMedia,
  type PickedAttachment,
} from '@/features/media/pickMedia';
import { MAX_PUBLICATION_MEDIA } from '@/features/media/mediaLimits';
import { FilterStrip } from '@/features/social/create/filter-strip';
import { fr } from '@/i18n/fr';
import { setPendingCreation } from '@/lib/pending-creation';

/**
 * Caméra de publication, plein écran façon TikTok/Instagram : aperçu en
 * direct avec filtre sélectionnable, bascule vidéo/photo, flash, caméra
 * avant/arrière et accès galerie. La capture part vers l'écran de
 * publication (`/create/preview`) avec le filtre choisi.
 */

const MAX_VIDEO_DURATION_S = 60;
const FLASH_MODES = ['off', 'auto', 'on'] as const satisfies readonly FlashMode[];
type CaptureFlash = (typeof FLASH_MODES)[number];
const FLASH_ICONS = {
  off: 'flash-off-outline',
  auto: 'flash-outline',
  on: 'flash-outline',
} as const satisfies Record<CaptureFlash, string>;

export default function CreateCameraScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string }>();
  const cameraRef = useRef<CameraView | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();

  const [mode, setMode] = useState<'video' | 'photo'>(
    params.mode === 'photo' ? 'photo' : 'video',
  );
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<CaptureFlash>('off');
  const [filter, setFilter] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsedS, setElapsedS] = useState(0);
  const recordingRef = useRef(false);
  const startedAtRef = useRef(0);
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!cameraPermission) {
      void requestCameraPermission();
    }
  }, [cameraPermission, requestCameraPermission]);

  useEffect(
    () => () => {
      if (elapsedTimer.current) {
        clearInterval(elapsedTimer.current);
      }
      if (recordingRef.current) {
        cameraRef.current?.stopRecording();
      }
    },
    [],
  );

  const stopElapsedTimer = useCallback(() => {
    if (elapsedTimer.current) {
      clearInterval(elapsedTimer.current);
      elapsedTimer.current = null;
    }
  }, []);

  const ensureMicrophone = useCallback(async (): Promise<boolean> => {
    if (microphonePermission?.granted) return true;
    const result = await requestMicrophonePermission();
    if (result.granted) return true;
    Alert.alert(fr.chat.camera.microphoneTitle, fr.chat.camera.microphoneBody);
    return false;
  }, [microphonePermission?.granted, requestMicrophonePermission]);

  const deliver = useCallback(
    (asset: PickedAttachment) => {
      setPendingCreation({ assets: [asset], filter });
      // `replace` : retour depuis l'aperçu = hub, pas retour caméra.
      router.replace('/create/preview');
    },
    [filter],
  );

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || busy || recordingRef.current) return;
    setBusy(true);
    try {
      const picture = await cameraRef.current.takePictureAsync({
        quality: 1,
        exif: false,
        shutterSound: true,
      });
      const asset = normalizeLocalMedia({
        uri: picture.uri,
        kind: 'image',
        mime: picture.format === 'png' ? 'image/png' : 'image/jpeg',
        name: `photo-${Date.now()}.${picture.format}`,
        width: picture.width,
        height: picture.height,
      });
      if (isRejectedMedia(asset)) {
        Alert.alert(fr.chat.camera.failedTitle, asset.reason);
        return;
      }
      deliver(asset);
    } catch {
      Alert.alert(fr.chat.camera.failedTitle, fr.chat.camera.failedBody);
    } finally {
      setBusy(false);
    }
  }, [busy, deliver]);

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || busy || recordingRef.current) return;
    if (!(await ensureMicrophone())) return;
    setBusy(true);
    recordingRef.current = true;
    startedAtRef.current = Date.now();
    setElapsedS(0);
    setRecording(true);
    elapsedTimer.current = setInterval(() => {
      setElapsedS(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    try {
      const result = await cameraRef.current.recordAsync({
        maxDuration: MAX_VIDEO_DURATION_S,
        maxFileSize: MAX_PLAINTEXT_BYTES.video,
        progressUpdateInterval: 0.5,
      });
      stopElapsedTimer();
      if (!result) return;
      const elapsed = Date.now() - startedAtRef.current;
      const asset = normalizeLocalMedia({
        uri: result.uri,
        kind: 'video',
        durationMs: elapsed,
      });
      if (isRejectedMedia(asset)) {
        Alert.alert(fr.chat.camera.failedTitle, asset.reason);
        return;
      }
      deliver(asset);
    } catch {
      Alert.alert(fr.chat.camera.failedTitle, fr.chat.camera.failedBody);
    } finally {
      recordingRef.current = false;
      stopElapsedTimer();
      setRecording(false);
      setBusy(false);
    }
  }, [busy, deliver, ensureMicrophone, stopElapsedTimer]);

  const stopRecording = useCallback(() => {
    stopElapsedTimer();
    recordingRef.current = false;
    setRecording(false);
    setBusy(false);
    try {
      cameraRef.current?.stopRecording();
    } catch {
      // L'arrêt peut échouer si l'enregistrement vient de se terminer seul.
    }
  }, [stopElapsedTimer]);

  const onShutter = useCallback(() => {
    if (recording) {
      stopRecording();
      return;
    }
    if (mode === 'video') {
      void startRecording();
      return;
    }
    void takePhoto();
  }, [mode, recording, startRecording, stopRecording, takePhoto]);

  const changeMode = useCallback(
    (next: 'video' | 'photo') => {
      if (recording || busy) return;
      setMode(next);
    },
    [busy, recording],
  );

  const cycleFlash = useCallback(() => {
    const index = FLASH_MODES.indexOf(flash);
    setFlash(FLASH_MODES[(index + 1) % FLASH_MODES.length]);
  }, [flash]);

  /** Galerie rapide : même validation que le hub, vers l'aperçu. */
  const pickFromGallery = useCallback(async () => {
    if (recording || busy) return;
    const result = await pickLibraryMedia(MAX_PUBLICATION_MEDIA);
    if (!result) return;
    // Photos et vidéos peuvent se mélanger dans un carrousel (10 max).
    const assets = result.files.filter(
      (asset) => asset.kind === 'image' || asset.kind === 'video',
    );
    if (assets.length === 0) {
      Alert.alert(fr.social.createMediaErrorTitle, fr.social.createMediaErrorBody);
      return;
    }
    setPendingCreation({ assets, filter });
    router.replace('/create/preview');
  }, [busy, filter, recording]);

  const permissionGranted = cameraPermission?.granted === true;
  const elapsedLabel = `${Math.floor(elapsedS / 60)}:${String(elapsedS % 60).padStart(2, '0')}`;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false, statusBarStyle: 'light' }} />
      {permissionGranted ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          flash={flash}
          mode={mode === 'photo' ? 'picture' : 'video'}
          onCameraReady={() => setReady(true)}
          onMountError={() => {
            Alert.alert(fr.chat.camera.failedTitle, fr.chat.camera.failedBody);
          }}
        />
      ) : null}

      {/* Filtre en direct : mêmes calques que le rendu publié. */}
      <MediaFilterOverlay filterKey={filter} />

      {/* Barre du haut : fermer, flash, retourner la caméra. */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.two }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={fr.social.back}
          style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}>
          <Ionicons name="close" size={25} color={MediaSurface.onSurface} />
        </Pressable>
        {permissionGranted ? (
          <View style={styles.headerActions}>
            <Pressable
              onPress={cycleFlash}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={fr.social.createFlash}
              style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}>
              <Ionicons name={FLASH_ICONS[flash]} size={21} color={MediaSurface.onSurface} />
            </Pressable>
            <Pressable
              onPress={() => setFacing((current) => (current === 'back' ? 'front' : 'back'))}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={fr.social.createFlipCamera}
              style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}>
              <Ionicons name="camera-reverse-outline" size={23} color={MediaSurface.onSurface} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {!permissionGranted ? (
        <View style={styles.permissionPane}>
          <View style={styles.permissionIcon}>
            <Ionicons name="camera-outline" size={30} color={MediaSurface.onSurface} />
          </View>
          <ThemedText type="sectionTitle" style={styles.onSurface}>
            {fr.chat.camera.permissionTitle}
          </ThemedText>
          <ThemedText type="small" style={styles.onSurfaceSoftCenter}>
            {fr.chat.camera.permissionBody}
          </ThemedText>
          <Pressable
            onPress={() => void Linking.openSettings()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.permissionAction, pressed && styles.pressed]}>
            <ThemedText type="smallBold" style={styles.onSurface}>
              {fr.common.openSettings}
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <View
          style={[
            styles.footer,
            { paddingBottom: Math.max(insets.bottom, Spacing.four) },
          ]}>
          {recording ? (
            <View style={styles.recordingBadge}>
              <View style={styles.recordingDot} />
              <ThemedText type="micro" style={styles.onSurface}>
                {elapsedLabel}
              </ThemedText>
            </View>
          ) : null}

          <FilterStrip value={filter} onChange={setFilter} disabled={recording || busy} />

          <View style={styles.shutterRow}>
            <Pressable
              onPress={() => void pickFromGallery()}
              disabled={recording || busy}
              accessibilityRole="button"
              accessibilityLabel={fr.social.createGallery}
              style={({ pressed }) => [styles.sideButton, pressed && styles.pressed]}>
              <Ionicons name="images-outline" size={26} color={MediaSurface.onSurface} />
            </Pressable>

            {/* Bascule vidéo/photo, façon TikTok. */}
            <View style={styles.modeSwitch}>
              {(['video', 'photo'] as const).map((value) => {
                const active = mode === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => changeMode(value)}
                    disabled={recording || busy}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.modeButton, active && styles.modeButtonActive]}>
                    <ThemedText
                      type="smallBold"
                      style={active ? styles.onSurface : styles.onSurfaceSoft}>
                      {value === 'photo' ? fr.social.createPhoto : fr.social.createVideo}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.shutterSideEnd}>
              <Pressable
                onPress={onShutter}
                disabled={!ready && !recording}
                accessibilityRole="button"
                accessibilityLabel={
                  recording
                    ? fr.chat.camera.stopVideo
                    : mode === 'video'
                      ? fr.chat.camera.startVideo
                      : fr.chat.camera.capturePhoto
                }
                accessibilityState={{ disabled: !ready && !recording, busy }}
                style={({ pressed }) => [
                  styles.shutter,
                  recording && styles.shutterRecording,
                  pressed && styles.shutterPressed,
                ]}>
                {busy && !recording ? (
                  <ActivityIndicator color={MediaSurface.onSurface} />
                ) : recording ? (
                  <View style={styles.stopMark} />
                ) : (
                  <View style={styles.shutterCore} />
                )}
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MediaSurface.background },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    backgroundColor: MediaSurface.overlay,
  },
  headerActions: { flexDirection: 'row', gap: Spacing.two },
  roundButton: {
    width: 42,
    height: 42,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: MediaSurface.glass,
  },
  permissionPane: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.five,
  },
  permissionIcon: {
    width: 64,
    height: 64,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: MediaSurface.glass,
  },
  permissionAction: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Radii.full,
    backgroundColor: MediaSurface.glassStrong,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: Spacing.two,
    paddingTop: Spacing.three,
    paddingHorizontal: Spacing.two,
    backgroundColor: MediaSurface.overlay,
  },
  recordingBadge: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radii.full,
    backgroundColor: MediaSurface.overlay,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: Radii.full,
    backgroundColor: MediaSurface.recording,
  },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shutterSideEnd: { flex: 1, alignItems: 'flex-end' },
  sideButton: {
    width: 46,
    height: 46,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: MediaSurface.glass,
  },
  modeSwitch: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: Radii.full,
    backgroundColor: MediaSurface.glass,
  },
  modeButton: {
    minWidth: 64,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.full,
  },
  modeButtonActive: { backgroundColor: MediaSurface.glassStrong },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: MediaSurface.onSurface,
    backgroundColor: MediaSurface.glassStrong,
  },
  shutterRecording: { borderColor: MediaSurface.recording },
  shutterPressed: { transform: [{ scale: 0.94 }] },
  shutterCore: {
    width: 58,
    height: 58,
    borderRadius: Radii.full,
    backgroundColor: MediaSurface.onSurface,
  },
  stopMark: {
    width: 28,
    height: 28,
    borderRadius: Radii.sm,
    backgroundColor: MediaSurface.recording,
  },
  onSurface: { color: MediaSurface.onSurface },
  onSurfaceSoft: { color: MediaSurface.onSurfaceSoft },
  onSurfaceSoftCenter: { color: MediaSurface.onSurfaceSoft, textAlign: 'center' },
  pressed: { opacity: 0.72 },
});
