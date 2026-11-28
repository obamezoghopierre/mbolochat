import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { Play, Volume2, VolumeX } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedSurface, Radii, Spacing } from '@/constants/theme';
import { MediaFilterOverlay } from '@/features/media/media-filter';
import { fr } from '@/i18n/fr';
import type { FeedPost } from '@/lib/types';
import { FeedGestureLayer } from './feed-gestures';
import { primaryMedia, REELS_MAX_ASPECT } from './feed-media';
import { isLoadStalled, loadKeyFor, showsInitialSpinner, VIDEO_STALL_TIMEOUT_MS } from './load-guard';
import { videoPosterUrl, videoSourceUrl } from './video-source';
import { HeartBurstOverlay } from './heart-burst';
import { OverlayScrim } from './overlay-scrim';
import { ProgressBar } from './progress-bar';
import { usePlayerStatus } from './use-player-status';

/** Décor commun fourni par le pager (hauteur, activité, cœur, échelle du like). */
export interface FeedPageChrome {
  height: number;
  /** Hauteur de la barre du bas : les overlays remontent d'autant. */
  barInset: number;
  /**
   * Distance au bord bas de la ligne de progression : plaquée juste au-dessus
   * de la barre d'onglets (ou de la zone système sans barre). Par défaut,
   * `barInset`.
   */
  progressInset?: number;
  /**
   * La page est visible **et** l'écran est au premier plan : seule une page
   * active joue. Une page peut rester montée (préchargement) sans jouer.
   */
  isActive: boolean;
  /** Incrémenté à chaque double-tap : rejoue le cœur. */
  burstKey: number;
  /** Point du double-tap, pour faire naître le cœur sous le doigt. */
  burstPoint: { x: number; y: number } | null;
  likeScale: Animated.Value;
  /** Feuille de commentaires ouverte : le média s'affiche sans contrôles. */
  hideOverlays: boolean;
  /**
   * Fil d'accueil façon Instagram : la carte prend sa hauteur naturelle dans
   * une liste à défilement libre, au lieu d'occuper un écran entier.
   */
  flow?: boolean;
  /**
   * Visionneuse plein écran (grille Découvrir, écran de publication) : même
   * une photo ou un carrousel garde le rail vertical et la légende superposée
   * façon Reels, au lieu de la carte empilée du fil. `ImagePage` n'affiche
   * alors ni son en-tête ni son pied : `FeedPager` les remplace par
   * `PostInfoBlock` et `FeedActionRail`, comme il le fait déjà pour les
   * vidéos. Comme l'écran Explorer d'Instagram, qui ouvre toute publication
   * ainsi, photo ou vidéo, alors que son fil garde les cartes pour les photos.
   */
  fullScreen?: boolean;
}


/** Cadence des `timeUpdate` en lecture normale : la barre n'a pas besoin de plus. */
const TIME_UPDATE_INTERVAL_S = 0.25;
/** Cadence pendant un glissement sur la barre : le doigt veut du précis. */
const SCRUB_TIME_UPDATE_INTERVAL_S = 0.05;
/** Reprises automatiques avant d'afficher l'état d'erreur. */
const AUTO_RETRY_DELAYS_MS = [1200, 4000, 10000] as const;
/** Position en dessous de laquelle on ne « reprend » pas (début de vidéo). */
const RESUME_MIN_SECONDS = 3;

/**
 * Positions de lecture par publication : quitter une vidéo puis y revenir la
 * reprend là où elle en était. Mémoire module : elle survit au démontage de la
 * page (pager qui recycle les cellules) sans dépendre d'un store.
 */
const playbackPositions = new Map<string, number>();

/**
 * Page vidéo plein écran de type fil vertical : la vidéo couvre l'écran, tap pour
 * suspendre, double-tap pour réagir, appui long pour suspendre pendant le geste,
 * barre de progression scrubbable en bas.
 *
 * Un lecteur par page, créé par `useVideoPlayer` : React gère tout son cycle de
 * vie (montage, recyclage, libération), aucun `release()` manuel.
 *
 * Cette page n'est montée que pour la page **active** du pager : c'est la seule
 * `VideoView` vivante de l'application à un instant donné. Les voisines se
 * contentent d'un poster et d'un lecteur détaché (voir `VideoPrefetch`). Cette
 * unicité est ce qui empêche le conflit natif « The player has been notified of
 * disconnection from the player view, even though it's still connected ».
 *
 * Quitter la page réarme la lecture.
 */
export function VideoPage({
  post,
  chrome,
  onDoubleTapLike,
  onToggleSound,
  onScrubStateChange,
  scrubbing,
  muted,
  preferLowQuality = false,
}: {
  post: FeedPost;
  chrome: FeedPageChrome;
  /** Réseau mobile : servir la variante basse qualité quand elle existe. */
  preferLowQuality?: boolean;
  onDoubleTapLike: (point: { x: number; y: number } | null) => void;
  /** Le son est global au fil : le pager décide, la page applique. */
  onToggleSound: () => void;
  /** Vrai dès que le doigt glisse sur la barre : le feed fige son scroll. */
  onScrubStateChange: (scrubbing: boolean) => void;
  /** Vrai pendant un glissement : la cadence de progression s'affine. */
  scrubbing: boolean;
  muted: boolean;
}) {
  // Même résolution que le préchargement détaché : sans cela, deux URL
  // différentes (donc deux entrées de cache) pour la même vidéo.
  const url = videoSourceUrl(post, preferLowQuality);
  const posterUrl = videoPosterUrl(post);
  const insets = useSafeAreaInsets();
  // Cadrage façon Reels : une vidéo portrait (9:16, 3:4, 4:5) ou carrée remplit
  // l'écran (`cover`), rognée sur les bords — c'est ce que fait Instagram. Seule
  // une vidéo paysage est montrée entière (`contain`), centrée sur fond noir.
  const media = primaryMedia(post);
  const videoAspect =
    media?.width && media?.height ? media.width / media.height : null;
  const letterboxed = videoAspect !== null && videoAspect > REELS_MAX_ASPECT;
  const [userPaused, setUserPaused] = useState(false);
  // Source dont la première image a été décodée : le poster reste affiché page
  // par page tant que ce n'est pas le cas, pour éviter le flash noir.
  const [firstFrameSource, setFirstFrameSource] = useState<string | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Flash d'icône à chaque changement de son (tap sur la vidéo ou pastille).
  const [soundFlash, setSoundFlash] = useState(0);
  const [knownMuted, setKnownMuted] = useState(muted);
  if (knownMuted !== muted) {
    setKnownMuted(muted);
    setSoundFlash((value) => value + 1);
  }
  useEffect(() => {
    if (soundFlash === 0) {
      return;
    }
    const timer = setTimeout(() => setSoundFlash(0), 650);
    return () => clearTimeout(timer);
  }, [soundFlash]);
  // Reprises automatiques déjà tentées sur cette source en erreur.
  const [autoRetries, setAutoRetries] = useState(0);
  // Numéro de la tentative de chargement en cours : reprise manuelle comprise.
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Le cache disque est activé sur la source (`useCaching`) : revenir sur une
  // vidéo déjà vue relit le cache local au lieu de re-télécharger. Le plafond de
  // ce cache est fixé par le pager (`setVideoCacheSizeAsync`).
  const source = url ? { uri: url, useCaching: true } : null;
  const player = useVideoPlayer(source, (instance) => {
    // Boucle native : la tête revient au début sans état « terminé ».
    instance.loop = true;
    instance.timeUpdateEventInterval = TIME_UPDATE_INTERVAL_S;
  });

  // Identité du lecteur : `expo-video` peut en recréer un (par exemple quand un
  // `replaceAsync` échoue). Dans ce cas la `VideoView` doit être **remontée** :
  // affecter la prop `player` d'une vue déjà montée lève
  // « The player has been notified of disconnection from the player view »
  // côté natif. On suit donc le lecteur pour changer la clé de la vue.
  const [viewEpoch, setViewEpoch] = useState(0);
  const [knownPlayer, setKnownPlayer] = useState(player);
  if (knownPlayer !== player) {
    setKnownPlayer(player);
    setViewEpoch(viewEpoch + 1);
  }

  // `status` sert de déclencheur de reprise : un lecteur recyclé peut être
  // encore `loading` au moment où sa page redevient active, et `play()` appelé
  // trop tôt est perdu. On relance donc aussi quand il devient `readyToPlay`.
  const { status, error } = usePlayerStatus(player);

  // Garde-fou du chargement : un flux peut rester en `loading` sans jamais
  // rendre d'image (décodeur bloqué, serveur muet). Sans cela, le poster reste
  // affiché indéfiniment et l'utilisateur n'a aucun moyen d'agir.
  const loadKey = loadKeyFor(url, loadAttempt);
  const [stalledKey, setStalledKey] = useState<string | null>(null);
  const stalled = isLoadStalled(status, stalledKey, loadKey);
  // Une lecture qui démarre réarme le garde-fou : un rebuffering ultérieur doit
  // pouvoir attendre à nouveau le délai complet. Fait pendant le rendu (pattern
  // « derived state »), comme `userPaused` plus bas.
  if (status === 'readyToPlay' && stalledKey !== null) {
    setStalledKey(null);
  }
  // `muted` et la cadence de progression sont des propriétés impératives de
  // l'API expo-video : la règle d'immutabilité du React Compiler ne s'applique
  // pas à un objet natif.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    const interval = scrubbing ? SCRUB_TIME_UPDATE_INTERVAL_S : TIME_UPDATE_INTERVAL_S;
    // eslint-disable-next-line react-hooks/immutability
    player.timeUpdateEventInterval = interval;
  }, [player, scrubbing]);

  // Mémorise la position de lecture pour la reprise au retour sur la page.
  // `useEventListener` maintient le dernier listener : pas de closure périmée.
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    // Uniquement en lecture effective : pendant un `replaceAsync` (bascule
    // de qualité), les `timeUpdate` à ~0 écraseraient la position à reprendre.
    if (chrome.isActive && player.status === 'readyToPlay') {
      // Plafond : la map survit à tout le fil, on n'en garde que les plus
      // récentes (itération dans l'ordre d'insertion de la Map).
      if (playbackPositions.size >= 200) {
        const oldest = playbackPositions.keys().next().value;
        if (oldest !== undefined) {
          playbackPositions.delete(oldest);
        }
      }
      playbackPositions.set(post.id, currentTime);
    }
  });

  // Au premier `readyToPlay` de chaque source, reprend où la vidéo
  // s'était arrêtée. La clé est l'URL : un `replaceAsync` (bascule
  // basse qualité à vitesse augmentée) garde le même lecteur mais doit
  // déclencher une nouvelle reprise.
  const resumedUrl = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'readyToPlay' || resumedUrl.current === url) {
      return;
    }
    resumedUrl.current = url;
    const saved = playbackPositions.get(post.id) ?? 0;
    const duration = player.duration;
    const tooCloseToEnd =
      Number.isFinite(duration) && duration > 0 && saved > duration - 2;
    if (saved >= RESUME_MIN_SECONDS && !tooCloseToEnd) {
      seekExactly(player, saved);
    }
  }, [player, post.id, status, url]);

  // Le spinner centré ne sert qu'au tout premier chargement : passé le
  // premier `readyToPlay`, le buffering s'anime sur la barre de progression.
  // Le drapeau est par lecteur : un lecteur recréé repasse par le spinner.
  // Ajusté pendant le rendu (pattern « derived state »), comme `userPaused`.
  const [readyPlayer, setReadyPlayer] = useState<VideoPlayer | null>(null);
  if (status === 'readyToPlay' && readyPlayer !== player) {
    setReadyPlayer(player);
  }
  const buffering = status === 'loading' && readyPlayer === player;

  // Devenir la page active réarme la lecture : une pause volontaire ne doit pas
  // survivre à la sortie de l'écran : dès que la page devient inactive, le
  // drapeau retombe. C'est fait pendant le rendu (pas dans un effet) parce que
  // la règle `set-state-in-effect` l'interdit et qu'on veut la valeur à jour
  // avant l'effet de lecture ci-dessous.
  if (!chrome.isActive && userPaused) {
    setUserPaused(false);
  }

  const failed = status === 'error';
  useEffect(() => {
    // La feuille de commentaires couvre la page : la vidéo se met en pause,
    // comme sur Instagram, au lieu de continuer à jouer derrière elle.
    if (!chrome.isActive || chrome.hideOverlays || userPaused || failed) {
      player.pause();
      return;
    }
    // `status` est dans les dépendances : un lecteur recyclé encore `loading`
    // ignore `play()` appelé trop tôt, il faut relancer quand il est prêt.
    player.play();
  }, [chrome.hideOverlays, chrome.isActive, userPaused, failed, player, status]);

  /** Source unique pour les deux icônes : pause volontaire sur la page active. */
  const isPaused = userPaused && chrome.isActive;
  // L'appui long met en pause **pendant** le geste et rend ensuite la lecture
  // dans l'état où elle était : relancer une vidéo que l'utilisateur avait mise
  // en pause lui-même serait un contresens.
  const pausedByLongPress = useRef(false);
  const pauseForLongPress = useCallback(() => {
    if (!userPaused) {
      pausedByLongPress.current = true;
      setUserPaused(true);
    }
  }, [userPaused]);
  const resumeAfterLongPress = useCallback(() => {
    if (pausedByLongPress.current) {
      pausedByLongPress.current = false;
      setUserPaused(false);
    }
  }, []);
  // Un tap met en pause ou reprend, comme sur Instagram et TikTok. Le son vit
  // sur sa pastille : le tap ne doit pas couper le son de toute la page.
  const togglePause = useCallback(() => setUserPaused((value) => !value), []);

  // Le lecteur est figé pendant le glissement et ne repart qu'au relâchement,
  // et seulement s'il jouait avant : une pause volontaire reste une pause.
  // Les icônes restent pilotées par `isPaused`, jamais par le scrub.
  const handleSeekStart = useCallback(() => player.pause(), [player]);
  const handleSeekEnd = useCallback(
    (seconds: number) => {
      // Seek précis : la position finale doit être exacte, pas tolérante.
      seekExactly(player, seconds);
      // La reprise attend que le seek natif soit appliqué : jouer juste après
      // l'affectation de `currentTime` relance parfois la lecture à l'ancienne
      // position pendant une frame. Le timer est mémorisé pour être annulé si la
      // page est démontée entre-temps (lecteur déjà libéré).
      if (resumeTimer.current) {
        clearTimeout(resumeTimer.current);
      }
      if (chrome.isActive && !userPaused) {
        resumeTimer.current = setTimeout(() => {
          resumeTimer.current = null;
          player.play();
        }, RESUME_AFTER_SEEK_MS);
      }
    },
    [chrome.isActive, player, userPaused],
  );

  useEffect(
    () => () => {
      if (resumeTimer.current) {
        clearTimeout(resumeTimer.current);
        resumeTimer.current = null;
      }
    },
    [],
  );

  // Volontairement non mémoïsé : le React Compiler s'en charge, et une
  // `useCallback` ici faisait échouer la préservation de la mémoïsation
  // (`preserve-manual-memoization`).
  const retry = () => {
    if (!url) {
      return;
    }
    setFirstFrameSource(null);
    setAutoRetries(0);
    setLoadAttempt((attempt) => attempt + 1);
    void player.replaceAsync({ uri: url, useCaching: true }).catch(() => undefined);
  };

  // Le chargement bloqué n'est pas une erreur du lecteur : il attend toujours.
  // Seul un délai sans image permet de le distinguer d'un démarrage lent, et
  // d'offrir « Réessayer » plutôt qu'un poster figé.
  useEffect(() => {
    if (status !== 'loading' || !url) {
      return;
    }
    const timer = setTimeout(() => setStalledKey(loadKey), VIDEO_STALL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status, loadKey, url]);

  // Backoff automatique : une coupure réseau passagère ne doit pas imposer un
  // appui sur « Réessayer ». Les délais croissent, l'état d'erreur n'apparaît
  // qu'après épuisement — entre-temps le spinner de chargement reste visible.
  useEffect(() => {
    if (!failed || !url || autoRetries >= AUTO_RETRY_DELAYS_MS.length) {
      return;
    }
    const delay = AUTO_RETRY_DELAYS_MS[autoRetries];
    const timer = setTimeout(() => {
      setAutoRetries((count) => count + 1);
      setFirstFrameSource(null);
      setLoadAttempt((attempt) => attempt + 1);
      void player.replaceAsync({ uri: url, useCaching: true }).catch(() => undefined);
    }, delay);
    return () => clearTimeout(timer);
  }, [failed, url, autoRetries, player]);

  const exhausted = failed && autoRetries >= AUTO_RETRY_DELAYS_MS.length;

  // Le poster reste affiché tant que la première image n'est pas décodée :
  // sans lui, chaque changement de vidéo laisserait voir un flash noir le
  // temps que le lecteur se prépare. Il sert aussi de repli pendant une erreur.
  const showPoster = posterUrl !== null && firstFrameSource !== url;
  // Témoin du premier chargement : le poster seul ne dit pas si ça progresse.
  const loading =
    showsInitialSpinner(status, firstFrameSource === url, stalled) &&
    chrome.isActive &&
    !exhausted &&
    url !== null;
  // Aucune lecture possible : erreur épuisée, flux bloqué, ou pas de source.
  const unplayable = exhausted || stalled || !url;

  return (
    <View style={[styles.page, { height: chrome.height }]}>
      <VideoView
        // Une clé par (publication, lecteur) : la vue native n'est jamais
        // réutilisée pour un autre lecteur.
        key={`${post.id}-${viewEpoch}`}
        player={player}
        style={styles.surface}
        // `surfaceType="textureView"` : sur Android, une `SurfaceView` est
        // composée dans une couche native séparée. Quand la liste recycle les
        // cellules pendant le scroll, cette couche garde l'ancienne position
        // et la vidéo « flotte » hors de sa page — le défaut visible au
        // scroll. Une `TextureView` est un vrai View, découpé et positionné
        // comme le reste de la hiérarchie.
        surfaceType="textureView"
        contentFit={letterboxed ? 'contain' : 'cover'}
        nativeControls={false}
        pointerEvents="none"
        onFirstFrameRender={() => setFirstFrameSource(url)}
      />

      {showPoster && posterUrl ? (
        <Image
          source={{ uri: posterUrl }}
          style={styles.surface}
          // Même cadrage que la vidéo : sinon le poster (cover, plein écran)
          // saute vers la bande letterbox (contain) au démarrage de la lecture.
          resizeMode={letterboxed ? 'contain' : 'cover'}
          pointerEvents="none"
        />
      ) : null}

      {/* Filtre choisi à la publication : calques colorés par-dessus la vidéo. */}
      <MediaFilterOverlay filterKey={post.mediaFilter} />

      {loading ? (
        <View pointerEvents="none" style={styles.loadingHint}>
          <View style={styles.hintCard}>
            <ActivityIndicator size="small" color={FeedSurface.onMedia} />
            <ThemedText style={styles.loadingText}>{fr.social.videoLoading}</ThemedText>
          </View>
        </View>
      ) : null}

      {unplayable ? (
        <View style={styles.errorSurface}>
          <View style={styles.hintCard}>
            <ThemedText style={styles.errorTitle}>
              {!url
                ? fr.social.videoUnavailable
                : stalled
                  ? fr.social.videoStalledTitle
                  : fr.social.videoErrorTitle}
            </ThemedText>
            {url ? (
              <>
                <ThemedText style={styles.errorBody}>
                  {stalled ? fr.social.videoStalledBody : fr.social.videoErrorBody}
                </ThemedText>
                <Pressable
                  onPress={retry}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={fr.social.videoRetry}
                  style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
                  <ThemedText style={styles.retryText}>{fr.social.videoRetry}</ThemedText>
                </Pressable>
              </>
            ) : null}
            {error?.message ? (
              <ThemedText style={styles.errorDetail} numberOfLines={2}>
                {error.message}
              </ThemedText>
            ) : null}
          </View>
        </View>
      ) : (
        // Un tap met en pause ou reprend ; le double-tap aime, où qu'il tombe
        // (comme sur Instagram, aucune zone de saut sur les bords) ; l'appui
        // long suspend tant que le doigt reste posé.
        <FeedGestureLayer
          accessibilityLabel={fr.social.reelGestureA11y}
          onDoubleTap={onDoubleTapLike}
          onTap={togglePause}
          onLongPressStart={pauseForLongPress}
          onLongPressEnd={resumeAfterLongPress}
        />
      )}

      {/* Le poster couvre le chargement ; le témoin au-dessus dit qu'il
          progresse, et le rebuffering s'anime sur la barre de progression. */}

      <HeartBurstOverlay burstKey={chrome.burstKey} point={chrome.burstPoint} />

      {/* Contrôles masqués quand la feuille est ouverte,
          seul le média réduit reste visible au-dessus de la feuille. */}
      {!chrome.hideOverlays ? (
        <>
          {/* Voile de lisibilité sous les infos : rendu AVANT la ligne de
              progression, qui reste donc d'un blanc franc. */}
          <OverlayScrim inset={chrome.progressInset ?? chrome.barInset} />

          {isPaused ? (
            <View pointerEvents="none" style={styles.centerLayer}>
              <View style={styles.playBadge}>
                <Icon
                  icon={Play}
                  size={34}
                  color={FeedSurface.onMedia}
                  fill={FeedSurface.onMedia}
                />
              </View>
            </View>
          ) : null}

          {/* Son : pastille toujours visible, comme sur les Reels. Un tap sur la
              vidéo fait la même chose ; un flash confirme le changement. */}
          <Pressable
            onPress={onToggleSound}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{ selected: muted }}
            accessibilityLabel={muted ? fr.social.soundOn : fr.social.soundOff}
            style={({ pressed }) => [
              styles.roundButton,
              styles.soundButton,
              { top: insets.top + Spacing.six },
              pressed && styles.pressed,
            ]}>
            <Icon icon={muted ? VolumeX : Volume2} size={16} color={FeedSurface.onMedia} />
          </Pressable>
          {soundFlash ? (
            <View key={soundFlash} pointerEvents="none" style={styles.centerLayer}>
              <View style={styles.playBadge}>
                <Icon icon={muted ? VolumeX : Volume2} size={30} color={FeedSurface.onMedia} />
              </View>
            </View>
          ) : null}

          <ProgressBar
            player={player}
            // Plaquée juste au-dessus de la barre d'onglets (opaque) : la
            // zone tactile ne chevauche jamais la barre, et la ligne est
            // toujours visible, avec ou sans inset système.
            bottomInset={chrome.progressInset ?? chrome.barInset}
            active={chrome.isActive && !failed}
            buffering={buffering && chrome.isActive}
            onSeekStart={handleSeekStart}
            onSeekEnd={handleSeekEnd}
            onScrubStateChange={onScrubStateChange}
          />
        </>
      ) : null}
    </View>
  );
}

/** Seek frame-accurate hors rendu (helper libre : `player` est un objet natif). */
function seekExactly(player: VideoPlayer, seconds: number) {
  player.seekTolerance = { toleranceBefore: 0, toleranceAfter: 0 };
  player.currentTime = seconds;
}

/** Délai laissé au lecteur pour appliquer un seek avant de reprendre. */
const RESUME_AFTER_SEEK_MS = 60;

const styles = StyleSheet.create({
  page: {
    backgroundColor: FeedSurface.background,
    justifyContent: 'flex-end',
  },
  // Bornes explicites : sans elles, la surface native peut conserver la taille
  // de la page recyclée précédente et laisser apparaître une bande noire.
  surface: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  errorSurface: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.five,
  },
  // Fond sombre sous le message : un poster clair rendrait le texte blanc
  // illisible, et le voile du feed ne suffit pas.
  hintCard: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    borderRadius: Radii.lg,
    backgroundColor: 'rgba(0,0,0,0.62)',
    maxWidth: '100%',
  },
  // Témoin du premier chargement, centré sur le poster : il rassure sans
  // masquer l'image, contrairement à un écran plein.
  loadingHint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  loadingText: {
    color: FeedSurface.onMediaSoft,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorTitle: {
    color: FeedSurface.onMedia,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorBody: {
    color: FeedSurface.onMediaSoft,
    textAlign: 'center',
  },
  errorDetail: {
    color: FeedSurface.onMediaFaint,
    fontSize: 11,
    textAlign: 'center',
  },
  retry: {
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radii.full,
    backgroundColor: FeedSurface.onMedia,
  },
  retryText: {
    color: '#000000',
    fontWeight: '700',
  },
  // Calque plein écran qui centre son enfant : le badge de pause et le flash de
  // son tombent ainsi exactement au milieu, quelle que soit la taille.
  centerLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    width: 74,
    height: 74,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Posée en absolu sur la page : la pastille son flotte au-dessus de la vidéo.
  soundButton: {
    position: 'absolute',
    right: Spacing.three,
  },
  roundButton: {
    width: 36,
    height: 36,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
