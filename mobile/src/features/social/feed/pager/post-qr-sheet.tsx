import QRCode from 'react-native-qrcode-svg';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { postShareLink } from '@/lib/deep-link';
import type { FeedPost } from '@/lib/types';

/**
 * Partage rapide par QR code : le code encode le lien profond de la
 * publication, scannable depuis un appareil photo ou l'app MboloChat.
 */
export function PostQrSheet({
  post,
  onClose,
}: {
  post: FeedPost | null;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      visible={post !== null}
      onClose={onClose}
      title={fr.social.shareLabel}
      subtitle={post ? `Publication de ${post.author.displayName}` : undefined}>
      {post ? (
        <View style={styles.body}>
          <View
            style={styles.qrWrap}
            accessible
            accessibilityLabel={fr.social.qrCodeLabel}>
            <QRCode
              value={postShareLink(post.id)}
              size={200}
              backgroundColor="#ffffff"
              color="#0B1428"
            />
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            {fr.social.qrCodeHint}
          </ThemedText>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  qrWrap: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    backgroundColor: '#ffffff',
  },
  hint: { textAlign: 'center' },
});
