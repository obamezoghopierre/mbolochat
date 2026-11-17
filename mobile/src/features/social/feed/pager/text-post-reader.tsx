import { ChevronLeft } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedSurface, FeedTextPost, Radii, Spacing, Type } from '@/constants/theme';
import { fr } from '@/i18n/fr';

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
  onClose,
}: {
  visible: boolean;
  title: string;
  body: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.screen}>
        <View style={[styles.header, { paddingTop: insets.top + Spacing.two }]}>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={fr.social.back}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
            <Icon icon={ChevronLeft} size={24} color={FeedSurface.onMedia} strokeWidth={2.5} />
          </Pressable>
          <ThemedText numberOfLines={1} style={styles.title}>
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
          <ThemedText style={styles.body}>{body}</ThemedText>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: FeedTextPost.backdrop[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: FeedTextPost.cardBorder,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FeedTextPost.badge,
  },
  pressed: {
    opacity: 0.7,
  },
  title: {
    ...Type.sectionTitle,
    fontSize: 19,
    fontWeight: '700',
    color: FeedSurface.onMedia,
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
    ...Type.body,
    fontSize: 17,
    lineHeight: 26,
    color: FeedSurface.onMediaSoft,
  },
});
