import { ChevronLeft } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedTextPost, Radii, Spacing, Type } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import type { TextAlignKey, TextFontStyle } from '@/features/social/text-style';
import { useTextPostTones } from './feed-tokens';

/**
 * Lecteur d'un post texte long.
 *
 * Le titre et le bouton retour restent fixés en haut : seul le contenu défile,
 * ce qui permet de lire un texte de plusieurs milliers de caractères sans
 * perdre le fil. La modale couvre le pager (barre d'onglets et rail d'actions
 * inclus) et se ferme pour revenir exactement à la publication d'origine.
 */
export function TextPostReader({
  visible,
  title,
  body,
  textStyle,
  textSize,
  backgroundColor,
  onClose,
}: {
  visible: boolean;
  title: string;
  body: string;
  /** Police et alignement de la publication d'origine. */
  textStyle?: TextFontStyle & { textAlign?: TextAlignKey };
  /** Taille manuelle du corps (points) ; absente = taille fixe de lecture. */
  textSize?: number | null;
  /** Couleur de fond = dernier arrêt du dégradé de la carte (sombre ou clair). */
  backgroundColor?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const tones = useTextPostTones();

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
          <ThemedText
            numberOfLines={1}
            style={[
              styles.title,
              { color: tones.text },
              textStyle,
              textSize
                ? {
                    fontSize: Math.round((textSize * 4) / 3),
                    lineHeight: Math.round(textSize * 1.73),
                  }
                : null,
            ]}>
            {title}
          </ThemedText>
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={[
            styles.contentInner,
            { paddingBottom: insets.bottom + Spacing.five },
          ]}
          showsVerticalScrollIndicator>
          <ThemedText
            style={[
              styles.body,
              { color: tones.textSoft },
              textStyle,
              textSize
                ? { fontSize: textSize, lineHeight: Math.round(textSize * 1.53) }
                : null,
            ]}>
            {body}
          </ThemedText>
        </ScrollView>
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
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
  body: {
    // Même lecture que la carte : texte grand, centré, aéré.
    ...Type.body,
    fontSize: 19,
    lineHeight: 29,
    textAlign: 'center',
  },
});
