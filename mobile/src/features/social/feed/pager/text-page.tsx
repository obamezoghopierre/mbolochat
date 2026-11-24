import { router } from 'expo-router';
import { BadgeCheck, ChevronDown, Ellipsis, Eye, MapPin } from 'lucide-react-native';
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
  Spacing,
  Type,
} from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { formatCompactCount, formatRelativeTimestamp } from '@/lib/format';
import { useThemePreference } from '@/lib/theme-preference';
import type { FeedPost } from '@/lib/types';
import type { FeedActions, FeedActionState } from './action-rail';
import { feedText, useTextPostTones } from './feed-tokens';
import { LikedByLine } from '../liked-by-line';
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
  TEXT_CARD_ASPECT,
  TEXT_CARD_PADDING,
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

/** Écart vertical entre en-tête, visuel et pied. */
const COLUMN_GAP = Spacing.two;
/** En dessous, le visuel n'est plus lisible : on accepte de rogner le texte. */
const MIN_VISUAL_HEIGHT = 200;
/** Pied avant sa première mesure (actions + ligne de méta). */
const FOOTER_ESTIMATE = 118;
/** Points de pagination + écart au-dessus. */
const PAGE_DOTS_BLOCK = 6 + Spacing.two;
/** Ligne « Voir plus » sous un post long. */
const MORE_LINK_HEIGHT = 22;
/** Le badge « 2/5 » s'efface après ce délai sans changement de page. */
const PAGE_BADGE_VISIBLE_MS = 2500;

/**
 * Estimation bornée pour une page de carrousel : le rendu ne montre que
 * `MULTIPAGE_BODY_MAX_LINES` lignes — estimer au-delà sous-dimensionnerait
 * la police pour du texte que personne ne voit.
 */
const MULTIPAGE_BODY_ESTIMATE_CHARS = 480;
/** Lignes visibles par page : borne le bloc comme le fait le fit. */
const MULTIPAGE_BODY_MAX_LINES = 12;

/** Posts déjà animés à l'entrée, bornés pour ne pas grossir sans fin. */
const seenTextPosts = new Set<string>();
const SEEN_TEXT_POSTS_MAX = 500;
function rememberSeenTextPost(id: string) {
  if (seenTextPosts.size >= SEEN_TEXT_POSTS_MAX) {
    const oldest = seenTextPosts.values().next().value;
    if (oldest !== undefined) {
      seenTextPosts.delete(oldest);
    }
  }
  seenTextPosts.add(id);
}

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
  preview: isPreview = false,
}: {
  post: FeedPost;
  chrome: FeedPageChrome;
  /** Actions et état du post : quand fournis, la carte porte son propre pied. */
  actions?: FeedActions;
  state?: FeedActionState;
  likeScale?: Animated.Value;
  /** Double-tap sur la carte : like + cœur animé, comme sur les pages média. */
  onDoubleTapLike?: () => void;
  /**
   * Aperçu du compositeur : rendu identique au fil (en-tête, visuel, barre
   * d'actions), mais rien n'est actionnable — pas de navigation, de like,
   * de suivi ni de menu — et sans les réserves des barres du fil.
   */
  preview?: boolean;
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
  // Page affichée, partagée entre la carte et le lecteur : on rouvre le
  // lecteur sur la page en cours et la carte reprend où le lecteur s'arrête.
  const [pageIndex, setPageIndex] = useState(0);
  const { width: windowWidth } = useWindowDimensions();

  // Entrée de carte : un fondu léger, seulement la première fois qu'un post
  // apparaît. Le pager démonte et remonte les pages : sans ce registre, chaque
  // retour en arrière refaisait le fondu et donnait un effet de clignotement.
  const alreadySeen = isPreview || seenTextPosts.has(post.id);
  const enter = useMemo(() => new Animated.Value(alreadySeen ? 1 : 0), [alreadySeen]);
  useEffect(() => {
    if (alreadySeen) {
      return;
    }
    rememberSeenTextPost(post.id);
    const animation = Animated.timing(enter, {
      toValue: 1,
      duration: ENTER_DURATION_MS,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [alreadySeen, enter, post.id]);

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
  // Le lecteur ne s'ouvre que pour un post simple long (pas de lecteur en
  // multi-pages, on glisse entre les pages) : il lit le corps seul.
  const readerBody = body ?? '';
  const hasLongBody = body !== null && body.length > PREVIEW_MAX_CHARS;
  const preview = hasLongBody ? `${body.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…` : body;
  // « Voir plus » et le tap→lecteur : posts simples longs uniquement.
  // Multi-pages : comme Instagram, on glisse entre les pages, pas de
  // lecteur.
  const isLongPost = hasLongBody || title.length > TEXT_POST_TITLE_MAX_CHARS;
  // Comme Instagram : « Voir plus » n'existe que sur un post simple long.
  // Un carrousel multi-pages n'en a jamais — on balaie les pages, il n'y a
  // rien de plus à lire au-delà.
  const showReader = isLongPost && !isMultiPage;
  // Le fond choisi par l'auteur s'applique toujours, comme dans le compositeur.
  const backgroundKey = post.textBackground ?? null;
  const paletteSet = textPostPaletteSet(backgroundKey);
  const openReader = () => setReaderOpen(true);
  const closeReader = () => setReaderOpen(false);

  const interactive = Boolean(actions && state) && !chrome.hideOverlays;
  // Liens, profil, suivi, menu et like : désactivés dans l'aperçu.
  const linksEnabled = interactive && !isPreview;
  // Fil libre (façon Instagram) : la liste réserve la place des barres, la
  // carte prend sa hauteur naturelle avec un petit écart.
  const flow = Boolean(chrome.flow) && !isPreview;
  const topReserved = isPreview ? Spacing.two : flow ? Spacing.two : CARD_TOP_RESERVED;
  const bottomReserved = isPreview ? Spacing.two : flow ? Spacing.four : CARD_BOTTOM_RESERVED;
  const author = post.author;

  // Format Instagram : en-tête au-dessus, visuel pleine largeur au ratio du
  // compositeur (TEXT_CARD_ASPECT = 4:5, ce qui est composé est ce qui est
  // lu), actions en dessous, sur le fond neutre du fil. L'en-tête et le pied
  // sont mesurés ; le visuel prend le 4:5 s'il tient, sinon la place restante.
  const [topHeight, setTopHeight] = useState<number | null>(null);
  const [footerHeight, setFooterHeight] = useState<number | null>(null);
  const measure =
    (setter: (value: number) => void, current: number | null) =>
    (value: number) => {
      if (current === null || Math.abs(current - value) > 1) {
        setter(Math.round(value));
      }
    };
  const onTopLayout = measure(setTopHeight, topHeight);
  const onFooterLayout = measure(setFooterHeight, footerHeight);

  const visualWidth = windowWidth;
  const estimatedTop =
    HEADER_AVATAR + (post.repostedBy ? 22 : 0) + (post.quoted ? 96 : 0);
  const available = flow
    ? Number.POSITIVE_INFINITY
    : chrome.height -
    topReserved -
    bottomReserved -
    (topHeight ?? estimatedTop) -
    (interactive ? (footerHeight ?? FOOTER_ESTIMATE) : 0) -
    (isMultiPage ? PAGE_DOTS_BLOCK : 0) -
    COLUMN_GAP * 2;
  const visualHeight = Math.round(
    Math.max(MIN_VISUAL_HEIGHT, Math.min(visualWidth / TEXT_CARD_ASPECT, available)),
  );
  // Largeur de texte : celle du visuel moins la marge du compositeur.
  const pageWidth = visualWidth - TEXT_CARD_PADDING * 2;
  const linkReserve = post.linkPreview ? FeedTextPost.linkThumb + Spacing.two : 0;

  // Typographie : la taille manuelle de l'auteur est un plafond — le texte
  // s'ajuste en dessous pour tenir dans le visuel au lieu d'être coupé.
  // Sans taille manuelle, la police remplit le visuel comme sur Instagram.
  // Multi-pages : chaque page a sa propre police/alignement/taille, le
  // calcul est donc refait par page dans `TextPages`.
  const feedFit = (() => {
    if (isMultiPage) {
      return null;
    }
    const contentHeight = Math.max(
      120,
      visualHeight -
        TEXT_CARD_PADDING * 2 -
        linkReserve -
        (showReader ? MORE_LINK_HEIGHT + Spacing.two : 0) -
        (title && preview ? Spacing.two : 0),
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

  // Double-tap sur le visuel = like. Les zones interactives (en-tête,
  // actions, « Voir plus ») sont des Pressable enfants : elles captent leur
  // propre toucher, seul le reste du visuel arrive ici.
  const lastTapAt = useRef(0);
  const handleCardPress = () => {
    const now = Date.now();
    if (now - lastTapAt.current < DOUBLE_TAP_MS) {
      lastTapAt.current = 0;
      if (linksEnabled) {
        onDoubleTapLike?.();
      }
      return;
    }
    // Comme sur Instagram, un tap simple sur le visuel ne fait rien : le
    // lecteur s'ouvre par « Voir plus ». Plus d'attente de 300 ms pour
    // distinguer un tap d'un double-tap, le like part dès le second tap.
    lastTapAt.current = now;
  };

  return (
    <View
      style={[
        styles.page,
        {
          height: flow ? undefined : chrome.height,
          backgroundColor: tones.surface,
          paddingTop: topReserved,
          paddingBottom: bottomReserved,
        },
      ]}>
      <Animated.View
        style={[
          styles.column,
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
        {/* Bloc du haut mesuré : republication, en-tête, citation. */}
        <View style={styles.top} onLayout={(event) => onTopLayout(event.nativeEvent.layout.height)}>
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

          {/* En-tête Instagram : avatar rond, nom + badge vérifié + date sur
              une ligne, lieu dessous ; « Suivre » en texte et menu ⋯ à droite. */}
          <View style={styles.header}>
            <Pressable
              onPress={actions?.onOpenProfile}
              disabled={!actions || isPreview}
              accessibilityRole="button"
              accessibilityLabel={`Voir le profil de ${author.displayName}${
                author.verified ? `, ${fr.social.verifiedAccount}` : ''
              }`}
              style={({ pressed }) => [styles.authorRow, pressed && styles.pressed]}>
              <Avatar
                name={author.displayName}
                uri={author.avatarUrl}
                size={HEADER_AVATAR}
                shape="circle"
              />
              <View style={styles.authorText}>
                <View style={styles.authorLine}>
                  <ThemedText
                    numberOfLines={1}
                    style={[styles.authorName, { color: tones.text }]}>
                    {author.displayName}
                  </ThemedText>
                  {author.verified ? (
                    <Icon icon={BadgeCheck} size={15} color={tones.verified} strokeWidth={2.4} />
                  ) : null}
                  <ThemedText
                    numberOfLines={1}
                    style={[styles.authorMeta, { color: tones.textSoft }]}>
                    · {formatRelativeTimestamp(post.createdAt)}
                    {post.editedAt ? ` · ${fr.social.postEdited}` : ''}
                  </ThemedText>
                </View>
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
            </Pressable>

            <View style={styles.headerActions}>
              {actions?.onFollow && !isPreview ? (
                <Pressable
                  onPress={actions.onFollow}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Suivre ${author.displayName}`}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedText style={[styles.followText, { color: tones.accent }]}>
                    {fr.social.follow}
                  </ThemedText>
                </Pressable>
              ) : null}
              {actions && !isPreview ? (
                // Options (signaler, masquer…) : elles vivent dans la feuille
                // Partager, ouverte ici comme le ⋯ d'Instagram.
                <Pressable
                  onPress={actions.onMore ?? actions.onShare}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={fr.social.shareMoreOptions}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <Icon icon={Ellipsis} size={20} color={tones.text} />
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Citation : mini-carte de la publication d'origine, comme un
              post intégré (auteur, pseudo, début du texte). */}
          {post.quoted ? (
            <Pressable
              onPress={() => router.push(`/post/${post.quoted!.id}`)}
              disabled={isPreview}
              accessibilityRole="button"
              accessibilityLabel={`Voir la publication de ${post.quoted.authorDisplayName}`}
              style={({ pressed }) => [
                styles.quotedCard,
                { borderColor: tones.cardBorder, backgroundColor: tones.glass },
                pressed && styles.pressed,
              ]}>
              <View style={styles.quotedHeader}>
                <Avatar name={post.quoted.authorDisplayName} uri={null} size={20} shape="circle" />
                <ThemedText
                  numberOfLines={1}
                  style={[styles.quotedAuthor, { color: tones.text }]}>
                  {post.quoted.authorDisplayName}
                </ThemedText>
                <ThemedText
                  numberOfLines={1}
                  style={[styles.quotedHandle, { color: tones.textSoft }]}>
                  @{post.quoted.authorUsername}
                </ThemedText>
              </View>
              {post.quoted.caption ? (
                <ThemedText
                  numberOfLines={3}
                  style={[feedText.caption, styles.quotedCaption, { color: tones.textSoft }]}>
                  {post.quoted.caption}
                </ThemedText>
              ) : (
                <ThemedText style={[feedText.caption, { color: tones.textSoft }]}>
                  {fr.social.quotedFrom(post.quoted.authorDisplayName)}
                </ThemedText>
              )}
            </Pressable>
          ) : null}
        </View>

        {/* Visuel : pleine largeur, fond choisi par l'auteur, texte centré.
            Tap = lecteur (post long), double-tap = like. */}
        {isMultiPage ? (
          <TextPages
            pages={pages}
            pageStyles={post.pageStyles}
            width={visualWidth}
            height={visualHeight}
            fitHeight={Math.max(120, visualHeight - TEXT_CARD_PADDING * 2)}
            baseBackground={backgroundKey}
            baseFont={post.textFont}
            baseAlign={post.textAlign}
            baseColor={chosenColor ?? null}
            baseSize={manualSize}
            onPress={handleCardPress}
            interactive={linksEnabled}
            index={pageIndex}
            onIndexChange={setPageIndex}
          />
        ) : (
          <Pressable
            onPress={handleCardPress}
            // Le lecteur d'écran lit le texte du visuel ; « Voir plus » reste
            // le bouton qui ouvre le lecteur plein écran.
            accessible={false}
            style={[styles.visual, { width: visualWidth, height: visualHeight }]}>
            <TextPostBackdrop backgroundKey={backgroundKey} />
            <View style={styles.visualInner}>
              <ThemedText
                style={[
                  styles.title,
                  { color: tones.text },
                  textStyle,
                  titleFontSize ? { fontSize: titleFontSize, lineHeight: titleLineHeight } : null,
                ]}
                numberOfLines={5}>
                {renderTokens(title, [styles.token, { color: tones.accent }], {
                  interactive: linksEnabled,
                  linkStyle: [styles.token, { color: tones.accent, textDecorationLine: 'underline' }],
                })}
              </ThemedText>

              {preview ? (
                <ThemedText
                  style={[
                    styles.body,
                    { color: tones.textSoft },
                    textStyle,
                    // Couleur choisie : titre plein, corps légèrement adouci,
                    // pour garder la hiérarchie titre / texte.
                    chosenColor ? styles.bodyOnChosenColor : null,
                    bodyFontSize
                      ? { fontSize: bodyFontSize, lineHeight: bodyLineHeight }
                      : null,
                  ]}
                  numberOfLines={hasLongBody ? 8 : 16}>
                  {renderTokens(preview, [styles.token, { color: tones.accent }], {
                    interactive: linksEnabled,
                    linkStyle: [styles.token, { color: tones.accent, textDecorationLine: 'underline' }],
                  })}
                </ThemedText>
              ) : null}

              {/* Carte du premier lien : métadonnées lues côté serveur à la
                  publication, le lecteur n'interroge jamais le site lié. */}
              {post.linkPreview ? (
                <Pressable
                  onPress={() => void Linking.openURL(post.linkPreview!.url).catch(() => undefined)}
                disabled={isPreview}
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
          </Pressable>
        )}

        {/* Pied Instagram : actions et compteurs, puis « Voir les N
            commentaires » (seulement s'il y en a) et les vues. Masqué quand
            la feuille de commentaires est ouverte (hideOverlays). */}
        {interactive && actions && state ? (
          <View
            style={styles.footer}
            // Aperçu : la barre est montrée telle quelle mais inerte.
            pointerEvents={isPreview ? 'none' : 'auto'}
            importantForAccessibility={isPreview ? 'no-hide-descendants' : 'auto'}
            accessibilityElementsHidden={isPreview}
            onLayout={(event) => onFooterLayout(event.nativeEvent.layout.height)}>
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
                onPickCollection={actions.onPickCollection}
              onToggleRepost={actions.onToggleRepost}
              onShare={actions.onShare}
            />
            {/* « Aimé par X et N autres » : un compte suivi s'il y en a un,
                sinon le nombre de J'aime seul — la ligne d'Instagram. */}
            <LikedByLine post={post} color={tones.text} interactive={!isPreview} />
            <View style={styles.metaRow}>
              {post.counters.comments > 0 ? (
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
              ) : (
                <View />
              )}
              {/* Œil + compteur, sans le mot « vues » — comme IG. */}
              <View
                style={styles.metaViews}
                accessible
                accessibilityLabel={`${formatCompactCount(post.counters.views)} ${fr.social.viewsUnit}`}>
                <Icon icon={Eye} size={13} color={tones.textSoft} />
                <ThemedText style={[styles.metaViewsCount, { color: tones.textSoft }]}>
                  {formatCompactCount(post.counters.views)}
                </ThemedText>
              </View>
            </View>
          </View>
        ) : null}
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
        pages={isMultiPage ? pages : undefined}
        initialPage={pageIndex}
        onPageChange={setPageIndex}
        interactive={interactive}
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
  baseBackground = null,
  baseFont = null,
  baseAlign = null,
  baseColor = null,
  baseSize = null,
  onPress,
  interactive = false,
  index,
  onIndexChange,
}: {
  pages: string[];
  /** Style propre à chaque page, `null` = défaut du post. */
  pageStyles?: ({ background?: string; color?: string; font?: string; align?: string; size?: number } | null)[] | null;
  width: number;
  height: number;
  /** Hauteur utile pour l'auto-fit de chaque page. */
  fitHeight: number;
  /** Fond du post, pour les pages sans fond propre. */
  baseBackground?: string | null;
  /** Style de repli du post (police, alignement, couleur, taille). */
  baseFont?: string | null;
  baseAlign?: string | null;
  baseColor?: string | null;
  baseSize?: number | null;
  onPress: () => void;
  /** Hashtags et mentions cliquables (désactivé sous les overlays masqués). */
  interactive?: boolean;
  /** Page affichée (contrôlée par la carte, partagée avec le lecteur). */
  index: number;
  onIndexChange: (index: number) => void;
}) {
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
          // Même marge de texte que le compositeur (TEXT_CARD_PADDING).
          width - TEXT_CARD_PADDING * 2,
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
        runOnJS(onIndexChange)(target);
      }
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  /** Change de page (lecteur d'écran) avec le même ressort que le swipe. */
  const goTo = (next: number) => {
    const target = Math.min(lastIndex, Math.max(0, next));
    if (target === index) {
      return;
    }
    // Mutation volontaire d'une shared value dans un handler JS : le
    // compilateur la prend pour une valeur React, d'où la règle levée.
    // eslint-disable-next-line react-hooks/immutability
    translateX.value = withSpring(-target * width, PAGE_SPRING);
    onIndexChange(target);
  };

  // La largeur est mesurée après le premier rendu : on recale la rangée sur
  // la page courante, sinon elle resterait décalée de l'ancienne largeur.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    translateX.value = -index * width;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  // Badge « 2/5 » façon Instagram : visible au changement de page, puis il
  // s'efface pour ne pas masquer le texte.
  const [badgeOpacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const animation = Animated.sequence([
      Animated.timing(badgeOpacity, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.delay(PAGE_BADGE_VISIBLE_MS),
      Animated.timing(badgeOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [badgeOpacity, index]);

  return (
    <View style={styles.pagesWrap}>
      <View style={{ height, width, overflow: 'hidden' }}>
        <GestureDetector gesture={pan}>
          <Reanimated.View style={[styles.pagesRow, { height }, rowStyle]}>
            {pages.map((page, pageIndex) => {
              // Chaque carte est indépendante : fond et couleur choisis pour
              // cette page, quelle que soit la longueur de son texte.
              const style = pageStyles?.[pageIndex] ?? null;
              const pageBg = style?.background ?? baseBackground;
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
                  <TextPostBackdrop backgroundKey={pageBg} />
                  <Pressable
                    onPress={onPress}
                    style={{
                      flex: 1,
                      justifyContent: 'center',
                      // Même marge que le compositeur : un texte justifié ne
                      // colle pas les bords du visuel (comme sur IG).
                      padding: TEXT_CARD_PADDING,
                    }}>
                    <ThemedText
                      style={[
                        styles.body,
                        { color: tones.textSoft },
                        slideTextStyle,
                        fit ? { fontSize: fit.bodySize, lineHeight: fit.bodyLineHeight } : null,
                      ]}
                      numberOfLines={MULTIPAGE_BODY_MAX_LINES}>
                      {renderTokens(page, [styles.token, { color: tones.accent }], {
                        interactive,
                        linkStyle: [styles.token, { color: tones.accent, textDecorationLine: 'underline' }],
                      })}
                    </ThemedText>
                  </Pressable>
                </View>
              );
            })}
          </Reanimated.View>
        </GestureDetector>
        {/* Badge « 2/5 » dans le coin du carrousel, en retrait des bords. */}
        <Animated.View
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          style={[styles.pageIndicator, { backgroundColor: tones.badge, opacity: badgeOpacity }]}>
          <ThemedText type="caption" style={[styles.pageIndicatorText, { color: tones.text }]}>
            {fr.social.textPageIndicator(index + 1, pages.length)}
          </ThemedText>
        </Animated.View>
      </View>
      {/* Points seuls sous le carrousel (plus de chevron) ; pour le lecteur
          d'écran, c'est un contrôle « ajustable » qui change de page. */}

      <View
        style={styles.pageDots}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={fr.social.textPageA11y(index + 1, pages.length)}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          goTo(event.nativeEvent.actionName === 'increment' ? index + 1 : index - 1)
        }>
        {pages.map((_, dotIndex) => (
          <View
            key={dotIndex}
            accessible
            accessibilityLabel={fr.social.textPageDotLabel(dotIndex + 1, pages.length)}
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
  pageIndicator: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  pageIndicatorText: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  page: {
    overflow: 'hidden',
    justifyContent: 'center',
  },
  column: {
    alignSelf: 'stretch',
    gap: COLUMN_GAP,
  },
  visual: {
    overflow: 'hidden',
  },
  visualInner: {
    flex: 1,
    padding: TEXT_CARD_PADDING,
    justifyContent: 'center',
    gap: Spacing.two,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  authorLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
  },
  followText: {
    ...Type.body,
    fontWeight: '700',
  },
  token: {
    // Hashtags et mentions : l'accent du feed, identifiable dans le texte.
    color: FeedSurface.accent,
    fontWeight: '700',
  },
  top: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
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
    flexShrink: 1,
  },
  authorMeta: {
    ...Type.caption,
    color: FeedSurface.onMediaSoft,
    opacity: 0.8,
  },
  repostedBy: {
    fontWeight: '600',
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
  quotedCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    padding: Spacing.two,
    gap: Spacing.one,
  },
  quotedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  quotedAuthor: {
    ...Type.caption,
    fontWeight: '700',
    flexShrink: 1,
  },
  quotedHandle: {
    ...Type.caption,
    flexShrink: 1,
  },
  quotedCaption: {
    opacity: 0.9,
  },
  bodyOnChosenColor: {
    opacity: 0.88,
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
    paddingHorizontal: Spacing.three,
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
  pageDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.pageDot,
  },
  pageDot: {
    width: Spacing.pageDot,
    height: Spacing.pageDot,
    borderRadius: Radii.dot,
    backgroundColor: FeedSurface.onMediaFaint,
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.75,
  },
});
