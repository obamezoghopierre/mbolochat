import { router } from 'expo-router';
import { Check, ChevronDown, Eye, Plus } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

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
import { HeartBurstOverlay } from './heart-burst';
import { PostActionBar } from './post-action-bar';
import { renderTokens } from './rich-text';
import { splitCaption } from './text-post';
import { TextPostReader } from './text-post-reader';
import type { FeedPageChrome } from './video-page';

/**
 * Au-delà de cette longueur, la carte s'arrête de grandir et propose
 * « Voir plus » : le texte complet s'ouvre alors dans le lecteur plein écran.
 */
const PREVIEW_MAX_CHARS = 320;

/** Espace réservé en haut (barre d'onglets) et en bas (auteur, son, nav). */
const CARD_TOP_RESERVED = 112;
const CARD_BOTTOM_RESERVED = 128;

/** Taille de l'avatar de l'en-tête, calquée sur une publication Instagram. */
const HEADER_AVATAR = 36;

/** Fenêtre de discrimination tap simple / double-tap (comme les carrousels). */
const DOUBLE_TAP_MS = 300;

/** Entrée de carte : fade + léger remontage, discrète sous l'animation de page. */
const ENTER_DURATION_MS = 220;

/**
 * Fond dégradé vertical en trois arrêts, dessiné en SVG. `react-native-svg`
 * est déjà embarqué (QR code, icônes) : pas de nouvelle dépendance native ni
 * de rebuild, contrairement à `expo-linear-gradient`. Une seule vue native
 * remplace les 20 bandes empilées de l'ancienne approximation.
 */
function Backdrop({
  palette,
  id,
}: {
  palette: readonly [string, string, string];
  id: string;
}) {
  const [top, middle, bottom] = palette;
  const gradientId = `text-backdrop-${id}`;
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      pointerEvents="none"
      accessible={false}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={top} />
          <Stop offset="0.5" stopColor={middle} />
          <Stop offset="1" stopColor={bottom} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

/** Ensemble de palettes (sombre + clair) d'un post texte, défaut = dark. */
function paletteSetFor(post: FeedPost) {
  return post.textBackground && post.textBackground in FeedTextPost.backgrounds
    ? FeedTextPost.backgrounds[
        post.textBackground as keyof typeof FeedTextPost.backgrounds
      ]
    : FeedTextPost.backdrop;
}

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
  const paletteSet = paletteSetFor(post);
  const palette = paletteSet[scheme === 'light' ? 'light' : 'dark'];
  const [readerOpen, setReaderOpen] = useState(false);
  // Page affichée, partagée entre la carte et le lecteur : on rouvre le
  // lecteur sur la page en cours et la carte reprend où le lecteur s'arrête.
  const [pageIndex, setPageIndex] = useState(0);
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

  const { title, body } = splitCaption(post.caption);
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
  // Multi-pages : le lecteur affiche les pages une par une (carrousel) ;
  // `readerBody` ne sert qu'à la lecture continue d'un post classique.
  const readerBody = body ?? '';
  const hasLongBody = body !== null && body.length > PREVIEW_MAX_CHARS;
  const preview = hasLongBody ? `${body.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…` : body;
  // « Voir plus » ouvre aussi le lecteur quand le titre seul est très long :
  // il est alors tronqué à quelques lignes dans la carte. Le multi-pages
  // l'affiche toujours : chaque page est bornée dans la carte.
  const showReader = hasLongBody || title.length > 160 || isMultiPage;
  const openReader = () => setReaderOpen(true);
  const closeReader = () => setReaderOpen(false);

  const interactive = Boolean(actions && state) && !chrome.hideOverlays;
  const author = post.author;

  // Géométrie du carrousel de pages : largeur = fenêtre moins marges de la
  // page (Spacing.two) et de la carte (Spacing.three) ; hauteur bornée pour
  // que les points de page restent visibles sous le texte.
  const pageWidth = windowWidth - Spacing.two * 2 - Spacing.three * 2;
  const pagerHeight = Math.max(200, chrome.height - 480);

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
      <Backdrop palette={palette} id={post.id} />

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
                  <ThemedText style={[styles.verified, { color: tones.verified }]}> ✓</ThemedText>
                ) : null}
              </ThemedText>
              <ThemedText
                numberOfLines={1}
                style={[styles.authorMeta, { color: tones.textSoft }]}>
                · {formatRelativeTimestamp(post.createdAt)}
              </ThemedText>
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
              width={pageWidth}
              height={pagerHeight}
              onPress={handleCardPress}
              interactive={interactive}
              index={pageIndex}
              onIndexChange={setPageIndex}
            />
          ) : (
            <>
              <ThemedText style={[styles.title, { color: tones.text }]} numberOfLines={5}>
                {renderTokens(title, [styles.token, { color: tones.accent }], { interactive })}
              </ThemedText>

              {preview ? (
                <ThemedText style={[styles.body, { color: tones.textSoft }]} numberOfLines={hasLongBody ? 8 : 16}>
                  {renderTokens(preview, [styles.token, { color: tones.accent }], { interactive })}
                </ThemedText>
              ) : null}
            </>
          )}

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
        pages={isMultiPage ? pages : undefined}
        initialPage={pageIndex}
        onPageChange={setPageIndex}
        interactive={interactive}
        backgroundColor={palette[2]}
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
  width,
  height,
  onPress,
  interactive = false,
  index,
  onIndexChange,
}: {
  pages: string[];
  width: number;
  height: number;
  onPress: () => void;
  /** Hashtags et mentions cliquables (désactivé sous les overlays masqués). */
  interactive?: boolean;
  /** Page affichée (contrôlée par la carte, partagée avec le lecteur). */
  index: number;
  onIndexChange: (index: number) => void;
}) {
  const tones = useTextPostTones();
  const scrollRef = useRef<ScrollView>(null);
  // Le lecteur a pu changer de page : on recale le carrousel sans animation.
  const shownIndex = useRef(index);
  useEffect(() => {
    if (shownIndex.current !== index) {
      shownIndex.current = index;
      scrollRef.current?.scrollTo({ x: index * width, animated: false });
    }
  }, [index, width]);

  return (
    <View style={styles.pagesWrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: index * width, y: 0 }}
        onMomentumScrollEnd={(event) => {
          const next = Math.min(
            pages.length - 1,
            Math.max(0, Math.round(event.nativeEvent.contentOffset.x / width)),
          );
          shownIndex.current = next;
          onIndexChange(next);
        }}
        style={{ height }}>
        {pages.map((page, pageIndex) => {
          const content = splitCaption(page);
          return (
            <Pressable
              key={pageIndex}
              onPress={onPress}
              style={{ width, gap: Spacing.two }}>
              {content.title ? (
                <ThemedText style={[styles.title, { color: tones.text }]} numberOfLines={3}>
                  {renderTokens(content.title, [styles.token, { color: tones.accent }], { interactive })}
                </ThemedText>
              ) : null}
              {content.body ? (
                <ThemedText style={[styles.body, { color: tones.textSoft }]} numberOfLines={10}>
                  {renderTokens(content.body, [styles.token, { color: tones.accent }], { interactive })}
                </ThemedText>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
      <View
        style={styles.pageDots}
        accessible
        accessibilityLabel={fr.social.textPageA11y(index + 1, pages.length)}>
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
      {/* Indicateur « 2/5 » façon Instagram, en haut à droite du carrousel. */}
      <View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        style={[styles.pageIndicator, { backgroundColor: tones.textFaint }]}>
        <ThemedText type="caption" style={[styles.pageIndicatorText, { color: tones.text }]}>
          {fr.social.textPageIndicator(index + 1, pages.length)}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pageIndicator: {
    position: 'absolute',
    top: 0,
    right: 0,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  pageIndicatorText: { fontWeight: '700', fontVariant: ['tabular-nums'] },
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
    shadowColor: 'rgba(0,0,0,0.45)',
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
  verified: {
    color: '#5AA9FF',
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
    color: '#000000',
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
