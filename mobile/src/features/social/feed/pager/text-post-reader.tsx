import { ChevronLeft } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedTextPost, Radii, Spacing, Type } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { useTextPostTones } from './feed-tokens';
import { renderTokens } from './rich-text';
import { splitCaption } from './text-post';

/**
 * Lecteur d'un post texte long.
 *
 * Le titre et le bouton retour restent fixés en haut : seul le contenu défile,
 * ce qui permet de lire un texte de plusieurs milliers de caractères sans
 * perdre le fil. La modale couvre le pager (barre d'onglets et rail d'actions
 * inclus) et se ferme pour revenir exactement à la publication d'origine.
 *
 * Post multi-pages (`pages` d'au moins deux éléments) : le lecteur devient un
 * carrousel horizontal, une page par écran, chacune défilant verticalement.
 * Il s'ouvre sur `initialPage` (la page affichée dans la carte) et remonte la
 * page courante via `onPageChange`, pour que la carte reprenne au même endroit.
 */
export function TextPostReader({
  visible,
  title,
  body,
  pages,
  initialPage = 0,
  onPageChange,
  interactive = false,
  backgroundColor,
  onClose,
}: {
  visible: boolean;
  title: string;
  body: string;
  /** Pages d'un post multi-cartes ; absent ou une seule = lecture continue. */
  pages?: string[];
  initialPage?: number;
  onPageChange?: (index: number) => void;
  /** Hashtags et mentions cliquables dans le lecteur. */
  interactive?: boolean;
  /** Couleur de fond = dernier arrêt du dégradé de la carte (sombre ou clair). */
  backgroundColor?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const tones = useTextPostTones();
  const { width } = useWindowDimensions();
  const multi = (pages?.length ?? 0) > 1;
  const total = pages?.length ?? 1;

  const clamp = (value: number) => Math.min(total - 1, Math.max(0, value));
  const [index, setIndex] = useState(() => clamp(initialPage));
  const scrollRef = useRef<ScrollView>(null);

  // À chaque ouverture, se placer sur la page de la carte, sans animation.
  useEffect(() => {
    if (!visible || !multi) {
      return;
    }
    const start = clamp(initialPage);
    setIndex(start);
    const frame = requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ x: start * width, animated: false }),
    );
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const goTo = (next: number) => {
    const target = clamp(next);
    scrollRef.current?.scrollTo({ x: target * width, animated: true });
    setIndex(target);
    onPageChange?.(target);
  };

  const tokenStyle = [styles.token, { color: tones.accent }];
  const headerTitle = multi ? splitCaption(pages![index]).title || title : title;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={[styles.screen, { backgroundColor: backgroundColor ?? FeedTextPost.backdrop.dark[2] }]}>
        <View style={[styles.header, { paddingTop: insets.top + Spacing.two, borderBottomColor: tones.cardBorder }]}>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={fr.social.back}
            style={({ pressed }) => [
              styles.back,
              { backgroundColor: tones.badge },
              pressed && styles.pressed,
            ]}>
            <Icon icon={ChevronLeft} size={24} color={tones.text} strokeWidth={2.5} />
          </Pressable>
          <ThemedText numberOfLines={1} style={[styles.title, { color: tones.text }]}>
            {headerTitle}
          </ThemedText>
          {multi ? (
            <View
              style={[styles.indicator, { backgroundColor: tones.badge }]}
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={fr.social.textPageA11y(index + 1, total)}>
              <ThemedText type="caption" style={[styles.indicatorText, { color: tones.text }]}>
                {fr.social.textPageIndicator(index + 1, total)}
              </ThemedText>
            </View>
          ) : null}
        </View>

        {multi ? (
          <>
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={styles.content}
              onMomentumScrollEnd={(event) => {
                const next = clamp(Math.round(event.nativeEvent.contentOffset.x / width));
                setIndex(next);
                onPageChange?.(next);
              }}>
              {pages!.map((page, pageIndex) => {
                const content = splitCaption(page);
                return (
                  <ScrollView
                    key={pageIndex}
                    style={{ width }}
                    contentContainerStyle={[styles.contentInner, styles.pageInner]}
                    showsVerticalScrollIndicator
                    accessibilityLabel={fr.social.textPageA11y(pageIndex + 1, total)}>
                    {content.title ? (
                      <ThemedText style={[styles.pageTitle, { color: tones.text }]}>
                        {renderTokens(content.title, tokenStyle, { interactive })}
                      </ThemedText>
                    ) : null}
                    {content.body ? (
                      <ThemedText style={[styles.body, { color: tones.textSoft }]}>
                        {renderTokens(content.body, tokenStyle, { interactive })}
                      </ThemedText>
                    ) : null}
                  </ScrollView>
                );
              })}
            </ScrollView>
            <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.three }]}>
              <Pressable
                onPress={() => goTo(index - 1)}
                disabled={index === 0}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={fr.social.textPagePrevious}
                accessibilityState={{ disabled: index === 0 }}
                style={[styles.navButton, index === 0 && styles.navDisabled]}>
                <ThemedText style={[styles.navLabel, { color: tones.text }]}>‹</ThemedText>
              </Pressable>
              <View style={styles.dots} importantForAccessibility="no-hide-descendants">
                {pages!.map((_, dotIndex) => (
                  <View
                    key={dotIndex}
                    style={[
                      styles.dot,
                      { backgroundColor: tones.textFaint },
                      dotIndex === index && { backgroundColor: tones.text },
                    ]}
                  />
                ))}
              </View>
              <Pressable
                onPress={() => goTo(index + 1)}
                disabled={index === total - 1}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={fr.social.textPageNext}
                accessibilityState={{ disabled: index === total - 1 }}
                style={[styles.navButton, index === total - 1 && styles.navDisabled]}>
                <ThemedText style={[styles.navLabel, { color: tones.text }]}>›</ThemedText>
              </Pressable>
            </View>
          </>
        ) : (
          <ScrollView
            style={styles.content}
            contentContainerStyle={[
              styles.contentInner,
              { paddingBottom: insets.bottom + Spacing.five },
            ]}
            showsVerticalScrollIndicator>
            <ThemedText style={[styles.body, { color: tones.textSoft }]}>
              {renderTokens(body, tokenStyle, { interactive })}
            </ThemedText>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    borderBottomWidth: 1,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  title: {
    ...Type.sectionTitle,
    fontSize: 19,
    fontWeight: '700',
    flexShrink: 1,
    flexGrow: 1,
  },
  indicator: {
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  indicatorText: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
  pageInner: {
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  pageTitle: {
    ...Type.sectionTitle,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    // Même lecture que la carte : texte grand, centré, aéré.
    ...Type.body,
    fontSize: 19,
    lineHeight: 29,
    textAlign: 'center',
  },
  token: { fontWeight: '700' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  navButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navDisabled: { opacity: 0.3 },
  navLabel: { fontSize: 32, lineHeight: 36, fontWeight: '600' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
