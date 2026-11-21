import { router } from 'expo-router';
import { Check, ChevronDown, ChevronRight, Eye, MapPin, Plus } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  Animated,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import {
  FeedSurface,
  FeedTextPost,
  Radii,
  Scrim,
  Spacing,
  Type,
} from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { formatCompactCount, formatRelativeTimestamp } from '@/lib/format';
import { useThemePreference } from '@/lib/theme-preference';
import type { FeedPost } from '@/lib/types';
import type { FeedActions, FeedActionState } from './action-rail';
import { feedText, useTextPostTones } from './feed-tokens';
import { HeartBurstOverlay } from './heart-burst';
import { PostActionBar } from './post-action-bar';
import { renderTokens } from './rich-text';
import { TextPostBackdrop, textPostPaletteSet } from './text-backdrop';
import {
  TEXT_POST_BODY_MAX_CHARS,
  TEXT_POST_TITLE_MAX_CHARS,
  splitCaption,
} from './text-post';
import { TextPostReader } from './text-post-reader';
import {
  CHAR_RATIO,
  FEED_TEXT_FONT,
  fitFeedTypography,
} from '@/features/social/create/text-card';
import {
  textAlignValue,
  textColorByKey,
  textFontByKey,
  textFontStyle,
} from '@/features/social/text-style';
import type { FeedPageChrome } from './video-page';

/**
 * Au-delà de cette longueur, la carte s'arrête de grandir et propose
 * « Voir plus » : le texte complet s'ouvre alors dans le lecteur plein écran.
 */
const PREVIEW_MAX_CHARS = TEXT_POST_BODY_MAX_CHARS;

/** Espace réservé en haut (barre d'onglets) et en bas (auteur, son, nav). */
const CARD_TOP_RESERVED = 112;
const CARD_BOTTOM_RESERVED = 128;

/** Taille de l'avatar de l'en-tête, calquée sur une publication Instagram. */
const HEADER_AVATAR = 36;

/**
 * Estimation bornée pour une page de carrousel : le rendu ne montre que
 * `MULTIPAGE_BODY_MAX_LINES` lignes — estimer au-delà sous-dimensionnerait
 * la police pour du texte que personne ne voit.
 */
const MULTIPAGE_BODY_ESTIMATE_CHARS = 480;
/** Lignes visibles par page : borne le bloc comme le fait le fit. */
const MULTIPAGE_BODY_MAX_LINES = 12;

/** Fenêtre de discrimination tap simple / double-tap (comme les carrousels). */
const DOUBLE_TAP_MS = 300;

/** Ressort du pager de pages texte : glissement sec, calage franc. */
const PAGE_SPRING = { damping: 30, stiffness: 240, mass: 0.9 } as const;

/** Entrée de carte : fade + léger remontage, discrète sous l'animation de page. */
const ENTER_DURATION_MS = 220;

/**
 * Page d'une publication sans média, en carte façon Instagram : en-tête
 * auteur (avatar, nom, date, suivi), contenu texte, puis barre d'actions
 * horizontale en bas — plus de rail vertical réservé sur la droite.
 *
 * Le fond coloré statique reste pour que le pager garde sa cohérence
 * visuelle avec les pages vidéo/photo.
 */
export function TextPage({
  post,
  chrome,
  actions,
  state,
  likeScale,
  onDoubleTapLike,
}: {
  post: FeedPost;
  chrome: FeedPageChrome;
  /** Actions et état du post : quand fournis, la carte porte son propre pied. */
  actions?: FeedActions;
  state?: FeedActionState;
  likeScale?: Animated.Value;
  /** Double-tap sur la carte : like + cœur animé, comme sur les pages média. */
  onDoubleTapLike?: () => void;
}) {
  // Fond choisi par l'auteur : clé de palette, `null`/inconnu = dark.
  // Chaque fond a un rendu sombre et un rendu clair (thème de l'app).
  const { scheme } = useThemePreference();
  const tones = useTextPostTones();
  // Police, alignement et couleur choisis à la publication (post texte).
  // La couleur ne porte que si l'auteur en a choisi une : sinon les tons
  // du thème s'appliquent (`textStyle` passe après la couleur de repli).
  const fontSpec = textFontByKey(post.textFont);
  const chosenColor = textColorByKey(post.textColor)?.color;
  const textStyle = {
    ...textFontStyle(fontSpec, Platform.OS),
    textAlign: textAlignValue(post.textAlign),
    ...(chosenColor ? { color: chosenColor } : {}),
  };
  // Taille manuelle choisie par l'auteur (points du corps) : le titre garde
  // son rapport 4:3 et les interlignes suivent la taille, comme l'auto-fit
  // du compositeur. Absente = tailles fixes historiques (24 / 18).
  const manualSize = typeof post.textSize === 'number' ? post.textSize : null;
  const [readerOpen, setReaderOpen] = useState(false);
  const { width: windowWidth } = useWindowDimensions();

  // Entrée de carte : un fondu léger au montage de la page.
  const enter = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    const animation = Animated.timing(enter, {
      toValue: 1,
      duration: ENTER_DURATION_MS,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [enter]);

  // Titre dédié (`textTitle`) prioritaire ; sinon convention « première
  // ligne » pour les publications plus anciennes sans champ titre.
  const dedicatedTitle = post.textTitle?.trim() ? post.textTitle.trim() : null;
  const split = splitCaption(post.caption);
  const title = dedicatedTitle ?? split.title;
  const body = dedicatedTitle
    ? post.caption?.trim()
      ? post.caption.trim()
      : null
    : split.body;
  // Post multi-cartes : l'API ne persiste `pages` qu'à partir de deux pages
  // non vides ; `caption` reflète alors la première (recherche, extraits).
  const pages = useMemo(
    () =>
      (post.pages ?? [])
        .map((page) => page.trim())
        .filter((page) => page.length > 0),
    [post.pages],
  );
  const isMultiPage = pages.length > 1;
  // Le corps du lecteur rassemble toutes les pages, séparées par un filet.
  const readerBody = isMultiPage
    ? [body, ...pages.slice(1)]
        .filter((part): part is string => Boolean(part && part.length > 0))
        .join('\n\n———\n\n')
    : (body ?? '');
  const hasLongBody = body !== null && body.length > PREVIEW_MAX_CHARS;
  const preview = hasLongBody ? `${body.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…` : body;
  // « Voir plus » et le tap→lecteur : posts simples longs uniquement.
  // Multi-pages : comme Instagram, on glisse entre les pages, pas de
  // lecteur. Le fond normal s'applique dès que le post est long OU
  // multi-pages — les fonds colorés restent réservés aux posts courts.
  const isLongPost = hasLongBody || title.length > TEXT_POST_TITLE_MAX_CHARS;
  // Comme Instagram : « Voir plus » n'existe que sur un post simple long.
  // Un carrousel multi-pages n'en a jamais — on balaie les pages, il n'y a
  // rien de plus à lire au-delà.
  const showReader = isLongPost && !isMultiPage;
  const backgroundKey = isLongPost || isMultiPage ? null : post.textBackground;
  const paletteSet = textPostPaletteSet(backgroundKey);
  const openReader = () => setReaderOpen(true);
  const closeReader = () => setReaderOpen(false);

  const interactive = Boolean(actions && state) && !chrome.hideOverlays;
  const author = post.author;

  // Géométrie du carrousel de pages : largeur = fenêtre moins marges de la
  // page (Spacing.two) et de la carte (Spacing.three) ; hauteur bornée pour
  // que les points de page restent visibles sous le texte.
  const pageWidth = windowWidth - Spacing.two * 2 - Spacing.three * 2;
  const pagerHeight = Math.max(200, chrome.height - 480);

  // Typographie : la taille manuelle de l'auteur est un plafond — le texte
  // s'ajuste en dessous pour tenir dans la carte au lieu d'être coupé.
  // Sans taille manuelle, la police remplit la carte comme sur Instagram.
  // Multi-pages : chaque carte a sa propre police/alignement/taille, le
  // calcul est donc refait par page dans `TextPages`.
  const feedFit = (() => {
    if (isMultiPage) {
      return null;
    }
    const rowsHeight = post.linkPreview ? 104 : 0;
    const contentHeight = Math.max(
      120,
      chrome.height -
        CARD_TOP_RESERVED -
        CARD_BOTTOM_RESERVED -
        96 -
        (interactive ? 104 : 0) -
        rowsHeight,
    );
    return fitFeedTypography(
      [{ title, body: preview }],
      pageWidth,
      contentHeight,
      fontSpec?.charRatio ?? CHAR_RATIO,
      manualSize ?? FEED_TEXT_FONT.max,
    );
  })();
  const bodyFontSize = feedFit?.bodySize;
  const titleFontSize = feedFit?.titleSize;
  const bodyLineHeight = feedFit?.bodyLineHeight;
  const titleLineHeight = feedFit?.titleLineHeight;

  // Tap sur la carte : un tap ouvre le lecteur, un double-tap like — la même
  // convention que les carrousels. Les zones interactives (en-tête, actions)
  // sont des Pressable enfants : elles captent leur propre toucher, seul le
  // reste de la carte arrive ici.
  const lastTapAt = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (tapTimer.current) {
        clearTimeout(tapTimer.current);
      }
    },
    [],
  );
  const handleCardPress = () => {
    const now = Date.now();
    if (now - lastTapAt.current < DOUBLE_TAP_MS) {
      if (tapTimer.current) {
        clearTimeout(tapTimer.current);
        tapTimer.current = null;
      }
      lastTapAt.current = 0;
      if (interactive) {
        onDoubleTapLike?.();
      }
      return;
    }
    lastTapAt.current = now;
    // Pas assez de texte pour un lecteur : le tap simple ne fait rien,
    // seul le double-tap (like) reste utile sur une carte courte.
    if (!showReader) {
      return;
    }
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      openReader();
    }, DOUBLE_TAP_MS);
  };

  return (
    <View style={[styles.page, { height: chrome.height }]}>
      <TextPostBackdrop backgroundKey={backgroundKey} />

      <Animated.View
        style={[
          styles.cardEnter,
          {
            opacity: enter,
            transform: [
              {
                translateY: enter.interpolate({
                  inputRange: [0, 1],
                  outputRange: [14, 0],
                }),
              },
            ],
          },
        ]}>
        <Pressable
          onPress={handleCardPress}
          accessibilityRole={showReader ? 'button' : undefined}
          accessibilityLabel={
            showReader ? fr.social.readPublication(author.displayName) : undefined
          }
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: tones.card, borderColor: tones.cardBorder },
            {
              maxHeight: Math.max(
                160,
                chrome.height - CARD_TOP_RESERVED - CARD_BOTTOM_RESERVED,
              ),
            },
            pressed && styles.cardPressed,
          ]}>
        {/* « X a republié » au-dessus de l'en-tête, comme sur Instagram. */}
        {post.repostedBy ? (
          <Pressable
            onPress={() => router.push(`/user/${post.repostedBy!.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`Voir le profil de ${post.repostedBy.displayName}`}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText style={[feedText.caption, styles.repostedBy, { color: tones.textSoft }]}>
              {fr.social.republishedBy(post.repostedBy.displayName)}
            </ThemedText>
          </Pressable>
        ) : null}

        {/* En-tête de publication : avatar + nom vérifié + date, pastille
            Suivre à droite — le gabarit d'un post Instagram. */}
        <View style={styles.header}>
          <Pressable
            onPress={actions?.onOpenProfile}
            disabled={!actions}
            accessibilityRole="button"
            accessibilityLabel={`Voir le profil de ${author.displayName}`}
            style={({ pressed }) => [styles.authorRow, pressed && styles.pressed]}>
            <Avatar
              name={author.displayName}
              uri={author.avatarUrl}
              size={HEADER_AVATAR}
              shape="rounded"
            />
            <View style={styles.authorText}>
              <ThemedText numberOfLines={1} style={[styles.authorName, { color: tones.text }]}>
                {author.displayName}
                {author.verified ? (
                  <ThemedText style={{ color: tones.verified }}> ✓</ThemedText>
                ) : null}
              </ThemedText>
              {/* Date et lieu sur la même ligne, même taille — comme IG. */}
              <View style={styles.authorMetaRow}>
                <ThemedText
                  numberOfLines={1}
                  style={[styles.authorMeta, { color: tones.textSoft }]}>
                  · {formatRelativeTimestamp(post.createdAt)}
                </ThemedText>
                {post.location ? (
                  <View style={styles.locationInline}>
                    <Icon icon={MapPin} size={11} color={tones.textSoft} />
                    <ThemedText
                      numberOfLines={1}
                      style={[styles.authorMeta, styles.locationText, { color: tones.textSoft }]}>
                      {post.location}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>

          {actions?.onFollow ? (
            <Pressable
              onPress={actions.onFollow}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Suivre ${author.displayName}`}
              style={({ pressed }) => [
                styles.followChip,
                { backgroundColor: tones.follow },
                pressed && styles.pressed,
              ]}>
              <Icon icon={Plus} size={12} color={tones.onFollow} strokeWidth={3} />
              <ThemedText style={[styles.followChipText, { color: tones.onFollow }]}>
                {fr.social.follow}
              </ThemedText>
            </Pressable>
          ) : state?.following ? (
            <View style={[styles.followChipMuted, { backgroundColor: tones.glass }]}>
              <Icon icon={Check} size={12} color={tones.text} strokeWidth={3} />
            </View>
          ) : null}
        </View>

        {post.quoted ? (
          <Pressable
            onPress={() => router.push(`/post/${post.quoted!.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`Voir la publication de ${post.quoted.authorDisplayName}`}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText
              style={[feedText.caption, styles.quotedFrom, { color: tones.textSoft }]}>
              {fr.social.quotedFrom(post.quoted.authorDisplayName)}
            </ThemedText>
            {post.quoted.caption ? (
              <ThemedText
                numberOfLines={2}
                style={[feedText.caption, styles.quotedCaption, { color: tones.textSoft }]}>
                {post.quoted.caption}
              </ThemedText>
            ) : null}
          </Pressable>
        ) : null}

        {/* Contenu compressible : si la carte atteint son maxHeight, c'est
            le texte qui se réduit — le pied de carte (actions, likes) reste
            toujours à l'intérieur du fond arrondi. */}
        <View style={styles.content}>
          {isMultiPage ? (
            <TextPages
              pages={pages}
              pageStyles={post.pageStyles}
              width={pageWidth}
              height={pagerHeight}
              fitHeight={Math.max(160, pagerHeight - 24)}
              baseFont={post.textFont}
              baseAlign={post.textAlign}
              baseColor={chosenColor ?? null}
              baseSize={manualSize}
              onPress={handleCardPress}
            />
          ) : (
            <>
              <ThemedText
                style={[
                  styles.title,
                  { color: tones.text },
                  textStyle,
                  titleFontSize ? { fontSize: titleFontSize, lineHeight: titleLineHeight } : null,
                ]}
                numberOfLines={5}>
                {renderTokens(title, [styles.token, { color: tones.accent }], [styles.token, { color: tones.accent, textDecorationLine: 'underline' }])}
              </ThemedText>

              {preview ? (
                <ThemedText
                  style={[
                    styles.body,
                    { color: tones.textSoft },
                    textStyle,
                    bodyFontSize
                      ? { fontSize: bodyFontSize, lineHeight: bodyLineHeight }
                      : null,
                  ]}
                  numberOfLines={hasLongBody ? 8 : 16}>
                  {renderTokens(preview, [styles.token, { color: tones.accent }], [styles.token, { color: tones.accent, textDecorationLine: 'underline' }])}
                </ThemedText>
              ) : null}
            </>
          )}

          {/* Carte du premier lien : métadonnées lues côté serveur à la
              publication, le lecteur n'interroge jamais le site lié. */}
          {post.linkPreview ? (
            <Pressable
              onPress={() => void Linking.openURL(post.linkPreview!.url).catch(() => undefined)}
              accessibilityRole="link"
              accessibilityLabel={post.linkPreview.title}
              style={({ pressed }) => [
                styles.linkCard,
                { borderColor: tones.cardBorder, backgroundColor: tones.glass },
                pressed && styles.pressed,
              ]}>
              {post.linkPreview.imageUrl ? (
                <Image
                  source={{ uri: post.linkPreview.imageUrl }}
                  style={styles.linkImage}
                  resizeMode="cover"
                />
              ) : null}
              <View style={styles.linkText}>
                <ThemedText numberOfLines={2} style={[styles.linkTitle, { color: tones.text }]}>
                  {post.linkPreview.title}
                </ThemedText>
                {post.linkPreview.description ? (
                  <ThemedText
                    numberOfLines={2}
                    style={[styles.linkDescription, { color: tones.textSoft }]}>
                    {post.linkPreview.description}
                  </ThemedText>
                ) : null}
                <ThemedText numberOfLines={1} style={[styles.linkHost, { color: tones.textSoft }]}>
                  {post.linkPreview.host}
                </ThemedText>
              </View>
            </Pressable>
          ) : null}

          {showReader ? (
            <Pressable
              onPress={openReader}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={fr.social.seeFullPost}
              style={({ pressed }) => [styles.more, pressed && styles.morePressed]}>
              <ThemedText style={[styles.moreText, { color: tones.accent }]}>
                {fr.social.seeFullPost}
              </ThemedText>
              <Icon icon={ChevronDown} size={14} color={tones.accent} />
            </Pressable>
          ) : null}
        </View>

        {/* Pied de carte : barre d'actions horizontale + compteur de likes,
            le « footer » d'une publication Instagram. Masqué quand la
            feuille de commentaires est ouverte (hideOverlays). */}
        {interactive && actions && state ? (
          <View style={styles.footer}>
            {/* Filet de séparation contenu / actions, comme sur Instagram. */}
            <View style={[styles.footerDivider, { backgroundColor: tones.textFaint }]} />
            <PostActionBar
              post={post}
              reacted={state.reacted}
              saved={state.saved}
              reposted={state.reposted}
              likeScale={likeScale}
              onToggleLike={actions.onToggleLike}
              onPickReaction={actions.onPickReaction}
              onOpenComments={actions.onOpenComments}
              onToggleSave={actions.onToggleSave}
              onToggleRepost={actions.onToggleRepost}
              onShare={actions.onShare}
            />
            {/* Pied de carte façon Instagram : « Voir les commentaires » à
                gauche, compteur de vues à droite. */}
            <View style={styles.metaRow}>
              <Pressable
                onPress={actions.onOpenComments}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={fr.social.viewComments(post.counters.comments)}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText style={[styles.metaLink, { color: tones.textSoft }]}>
                  {fr.social.viewComments(post.counters.comments)}
                </ThemedText>
              </Pressable>
              {/* Œil + compteur, sans le mot « vues » — comme IG. */}
              <View
                style={styles.metaViews}
                accessible
                accessibilityLabel={`${formatCompactCount(post.counters.views)} ${fr.social.viewsUnit}`}>
                <Icon icon={Eye} size={13} color={tones.textFaint} />
                <ThemedText style={[styles.metaViewsCount, { color: tones.textFaint }]}>
                  {formatCompactCount(post.counters.views)}
                </ThemedText>
              </View>
            </View>
          </View>
        ) : null}
        </Pressable>
      </Animated.View>

      <HeartBurstOverlay
        burstKey={chrome.burstKey}
        point={chrome.burstPoint}
        color={tones.action}
      />

      <TextPostReader
        visible={readerOpen}
        title={title}
        body={readerBody}
        textStyle={textStyle}
        textSize={manualSize}
        backgroundColor={paletteSet[scheme === 'light' ? 'light' : 'dark'][2]}
        onClose={closeReader}
      />
    </View>
  );
}

/**
 * Pages d'un post texte multi-cartes : défilement horizontal à page entière,
 * chaque page gardant le découpage titre/contenu de `splitCaption`. Les points
 * de pagination restent visibles sous le texte ; un tap sur une page remonte
 * au même geste que la carte (lecteur ou double-tap like).
 */
function TextPages({
  pages,
  pageStyles,
  width,
  height,
  fitHeight,
  baseFont = null,
  baseAlign = null,
  baseColor = null,
  baseSize = null,
  onPress,
}: {
  pages: string[];
  /** Style propre à chaque page, `null` = défaut du post. */
  pageStyles?: ({ background?: string; color?: string; font?: string; align?: string; size?: number } | null)[] | null;
  width: number;
  height: number;
  /** Hauteur utile pour l'auto-fit de chaque page. */
  fitHeight: number;
  /** Style de repli du post (police, alignement, couleur, taille). */
  baseFont?: string | null;
  baseAlign?: string | null;
  baseColor?: string | null;
  baseSize?: number | null;
  onPress: () => void;
}) {
  const [index, setIndex] = useState(0);
  const tones = useTextPostTones();
  // Une typographie par page : chaque carte peut avoir sa propre police,
  // son alignement et sa taille ; les valeurs absentes retombent sur le
  // style global du post (posts anciens sans `pageStyles`). Comme sur
  // Instagram, chaque page est un bloc de texte uniforme — pas de découpe
  // titre/corps — dimensionné pour remplir la carte.
  const fits = useMemo(
    () =>
      pages.map((page, pageIndex) => {
        const style = pageStyles?.[pageIndex] ?? null;
        const fontKey =
          style?.font && textFontByKey(style.font) ? style.font : baseFont;
        const spec = textFontByKey(fontKey);
        const manual = typeof style?.size === 'number' ? style.size : baseSize;
        return fitFeedTypography(
          [
            {
              title: '',
              body: page.slice(0, MULTIPAGE_BODY_ESTIMATE_CHARS),
            },
          ],
          width,
          fitHeight,
          spec?.charRatio ?? CHAR_RATIO,
          manual ?? FEED_TEXT_FONT.max,
        );
      }),
    [baseFont, baseSize, fitHeight, pageStyles, pages, width],
  );
  const lastIndex = pages.length - 1;
  // Pager horizontal maison : un ScrollView imbriqué perdrait le swipe face
  // au pager horizontal des onglets ; le Pan RNGH prend le relais et
  // neutralise l'interception des scrollviews parentes une fois activé.
  const translateX = useSharedValue(0);
  const dragStart = useSharedValue(0);
  const dragOrigin = useSharedValue(0);

  const pan = Gesture.Pan()
    // Seuil bas : le contenu épouse le doigt dès les premiers pixels,
    // sans temps mort perceptible au début du swipe.
    .activeOffsetX([-5, 5])
    .failOffsetY([-30, 30])
    .onStart((event) => {
      // translationX est cumulée depuis le toucher, pas depuis
      // l'activation : sans cette origine, les pixels déjà parcourus
      // avant le seuil sont comptés deux fois et le contenu saute.
      dragStart.value = translateX.value;
      dragOrigin.value = event.translationX;
    })
    .onUpdate((event) => {
      const next = dragStart.value + (event.translationX - dragOrigin.value);
      const min = -lastIndex * width;
      // Butée aux bords : léger resistance au lieu d'un blocage sec.
      translateX.value =
        next > 0 ? next * 0.35 : next < min ? min + (next - min) * 0.35 : next;
    })
    .onEnd((event) => {
      // Vélocité projetée : un flick change de page même sans avoir
      // dépassé la moitié — le geste « suit » jusqu'au bout, comme IG.
      const fling = event.velocityX * 0.18;
      const target = Math.min(
        lastIndex,
        Math.max(0, Math.round(-(translateX.value + fling) / width)),
      );
      // La vélocité du geste amorce le ressort : le lâcher prolonge
      // naturellement le mouvement au lieu de repartir de zéro.
      translateX.value = withSpring(-target * width, {
        ...PAGE_SPRING,
        velocity: event.velocityX,
      });
      if (target !== index) {
        runOnJS(setIndex)(target);
      }
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  /** Page suivante au tap sur le chevron, comme un mini-swipe. */
  const goNext = () => {
    const target = Math.min(lastIndex, index + 1);
    if (target === index) {
      return;
    }
    // Mutation volontaire d'une shared value dans un handler JS : le
    // compilateur la prend pour une valeur React, d'où la règle levée.
    // eslint-disable-next-line react-hooks/immutability
    translateX.value = withSpring(-target * width, PAGE_SPRING);
    setIndex(target);
  };

  return (
    <View style={styles.pagesWrap}>
      <View style={{ height, width, overflow: 'hidden' }}>
        <GestureDetector gesture={pan}>
          <Reanimated.View style={[styles.pagesRow, { height }, rowStyle]}>
            {pages.map((page, pageIndex) => {
              // Chaque carte est indépendante : fond et couleur choisis pour
              // cette page. Comme pour un post simple, le fond coloré ne
              // s'applique que si le texte de la page reste court.
              const style = pageStyles?.[pageIndex] ?? null;
              const pageBg =
                style?.background && page.trim().length <= TEXT_POST_BODY_MAX_CHARS
                  ? style.background
                  : null;
              const pageFontKey =
                style?.font && textFontByKey(style.font) ? style.font : baseFont;
              const pageFontSpec = textFontByKey(pageFontKey);
              const pageAlign =
                style?.align === 'left' ||
                style?.align === 'center' ||
                style?.align === 'right' ||
                style?.align === 'justify'
                  ? style.align
                  : textAlignValue(baseAlign);
              const pageColor =
                (style?.color ? textColorByKey(style.color)?.color : undefined) ??
                baseColor ??
                undefined;
              const slideTextStyle = {
                ...textFontStyle(pageFontSpec, Platform.OS),
                textAlign: pageAlign,
                ...(pageColor ? { color: pageColor } : {}),
              };
              const fit = fits[pageIndex];
              return (
                <View
                  key={pageIndex}
                  style={{ width, height, overflow: 'hidden' }}>
                  {pageBg ? <TextPostBackdrop backgroundKey={pageBg} /> : null}
                  <Pressable
                    onPress={onPress}
                    style={{
                      flex: 1,
                      justifyContent: 'center',
                      // Marge de texte : sans elle, un texte justifié colle
                      // les deux bords de la carte (comme sur IG).
                      paddingHorizontal: Spacing.three,
                    }}>
                    <ThemedText
                      style={[
                        styles.body,
                        { color: tones.textSoft },
                        slideTextStyle,
                        fit ? { fontSize: fit.bodySize, lineHeight: fit.bodyLineHeight } : null,
                      ]}
                      numberOfLines={MULTIPAGE_BODY_MAX_LINES}>
                      {renderTokens(page, [styles.token, { color: tones.accent }], [styles.token, { color: tones.accent, textDecorationLine: 'underline' }])}
                    </ThemedText>
                  </Pressable>
                </View>
              );
            })}
          </Reanimated.View>
        </GestureDetector>
        {/* Invite au swipe : chevron discret au bord droit, masqué sur la
            dernière page. Le tap avance aussi, pour qui n'ose pas glisser. */}
        {index < lastIndex ? (
          <View style={styles.nextPageZone} pointerEvents="box-none">
            <Pressable
              onPress={goNext}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={fr.social.nextPage}
              style={({ pressed }) => [
                styles.nextPageBadge,
                { backgroundColor: tones.glass },
                pressed && styles.pressed,
              ]}>
              <Icon icon={ChevronRight} size={18} color={tones.text} />
            </Pressable>
          </View>
        ) : null}
      </View>
      <View style={styles.pageDots}>
        {pages.map((_, dotIndex) => (
          <View
            key={dotIndex}
            style={[
              styles.pageDot,
              { backgroundColor: tones.textFaint },
              dotIndex === index && { backgroundColor: tones.text, opacity: 1 },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  cardEnter: {
    alignSelf: 'stretch',
  },
  card: {
    // Pleine largeur : plus de rail vertical sur la droite pour les posts
    // texte, la carte porte ses propres actions en pied.
    alignSelf: 'stretch',
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: FeedTextPost.cardBorder,
    backgroundColor: FeedTextPost.card,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    gap: Spacing.two,
    // Ombre portée discrète : la carte se détache du dégradé de fond.
    shadowColor: Scrim,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  cardPressed: {
    opacity: 0.92,
  },
  token: {
    // Hashtags et mentions : l'accent du feed, identifiable dans le texte.
    color: FeedSurface.accent,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  authorText: {
    flexShrink: 1,
  },
  authorName: {
    ...Type.body,
    fontWeight: '700',
    color: FeedSurface.onMedia,
  },
  authorMeta: {
    ...Type.caption,
    color: FeedSurface.onMediaSoft,
    opacity: 0.8,
  },
  followChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radii.full,
    backgroundColor: FeedSurface.follow,
  },
  followChipText: {
    ...Type.caption,
    fontWeight: '700',
  },
  followChipMuted: {
    width: 26,
    height: 26,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FeedSurface.glass,
  },
  repostedBy: {
    fontWeight: '600',
  },
  authorMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  locationInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    flexShrink: 1,
  },
  locationText: {
    flexShrink: 1,
  },
  quotedFrom: {
    fontWeight: '600',
  },
  quotedCaption: {
    opacity: 0.85,
  },
  content: {
    flexShrink: 1,
    minHeight: 0,
    gap: Spacing.two,
    overflow: 'hidden',
    // Marge de texte supplémentaire : un texte justifié ne colle plus les
    // bords de la carte, le rendu reste aéré comme sur Instagram.
    paddingHorizontal: Spacing.three,
  },
  title: {
    // « Text post » Instagram : grand titre gras, centré sur le dégradé.
    ...Type.sectionTitle,
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '800',
    color: FeedSurface.onMedia,
    textAlign: 'center',
  },
  body: {
    // Corps centré lui aussi : le texte forme un seul bloc, comme chez IG.
    ...Type.body,
    fontSize: 18,
    lineHeight: 27,
    color: FeedSurface.onMediaSoft,
    textAlign: 'center',
  },
  linkCard: {
    flexDirection: 'row',
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  linkImage: {
    width: FeedTextPost.linkThumb,
    minHeight: FeedTextPost.linkThumb,
    backgroundColor: FeedSurface.glass,
  },
  linkText: {
    flex: 1,
    padding: Spacing.two,
    gap: Spacing.half,
    justifyContent: 'center',
  },
  linkTitle: { ...Type.body, fontWeight: '700' },
  linkDescription: { ...Type.caption },
  linkHost: { ...Type.micro, fontWeight: '600', textTransform: 'uppercase' },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: Spacing.half,
    paddingVertical: Spacing.half,
  },
  morePressed: {
    opacity: 0.7,
  },
  moreText: {
    ...Type.caption,
    fontWeight: '700',
    color: FeedSurface.accent,
  },
  footer: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
  },
  footerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: FeedSurface.onMediaFaint,
    opacity: 0.4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.half,
  },
  metaLink: {
    ...Type.caption,
    fontWeight: '600',
    color: FeedSurface.onMediaSoft,
  },
  metaViews: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  metaViewsCount: {
    ...Type.caption,
    color: FeedSurface.onMediaFaint,
  },
  pagesWrap: {
    gap: Spacing.two,
  },
  pagesRow: {
    flexDirection: 'row',
  },
  nextPageZone: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: Spacing.two,
  },
  nextPageBadge: {
    width: 36,
    height: 36,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  pageDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: FeedSurface.onMediaFaint,
    opacity: 0.5,
  },
  pageDotActive: {
    backgroundColor: FeedSurface.onMedia,
    opacity: 1,
  },
  pressed: {
    opacity: 0.75,
  },
});
