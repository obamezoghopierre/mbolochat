import { BadgeCheck, CalendarDays, Lock, MapPin, UserRound } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { BottomSheet } from '@/components/bottom-sheet';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { api } from '@/lib/api';
import { resolveMediaUrl } from '@/lib/media-url';
import type { UserProfile } from '@/lib/types';

/** « mars 2025 » : mois et année d'inscription, comme Instagram. */
function joinedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/**
 * « À propos de ce compte », comme Instagram : photo, nom, badge, date
 * d'inscription, lieu (si l'utilisateur le partage) et confidentialité.
 * Lit le profil public déjà servi par l'API ; rien de privé n'est ajouté.
 */
export function AboutAccountSheet({
  token,
  userId,
  onClose,
}: {
  token: string;
  /** `null` = feuille fermée. */
  userId: string | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!userId) {
      return;
    }
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfile(null);
    setFailed(false);
    api
      .getUserProfile(token, userId)
      .then((value) => alive && setProfile(value))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [token, userId]);

  const place = profile ? [profile.city, profile.country].filter(Boolean).join(', ') : '';

  return (
    <BottomSheet visible={userId !== null} onClose={onClose} title={fr.social.aboutAccount}>
      {!profile ? (
        <View style={styles.center}>
          {failed ? (
            <ThemedText type="small" themeColor="textSecondary">
              {fr.social.aboutUnavailable}
            </ThemedText>
          ) : (
            <ActivityIndicator color={theme.accent} />
          )}
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.identity}>
            <Avatar
              name={profile.displayName}
              uri={resolveMediaUrl(profile.avatarUrl)}
              size={76}
            />
            <View style={styles.nameRow}>
              <ThemedText style={styles.name}>{profile.displayName}</ThemedText>
              {profile.social?.verified ? (
                <Icon icon={BadgeCheck} size={18} color={theme.accent} strokeWidth={2.4} />
              ) : null}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              @{profile.username}
            </ThemedText>
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.intro}>
            {fr.social.aboutIntro}
          </ThemedText>

          <Row
            icon={CalendarDays}
            title={fr.social.aboutJoined}
            value={joinedLabel(profile.createdAt)}
          />
          {place ? <Row icon={MapPin} title={fr.social.aboutPlace} value={place} /> : null}
          {profile.social?.verified ? (
            <Row icon={BadgeCheck} title={fr.social.aboutVerified} value={fr.social.aboutVerifiedValue} />
          ) : null}
          <Row
            icon={profile.social?.privateAccount ? Lock : UserRound}
            title={fr.social.aboutPrivacy}
            value={
              profile.social?.privateAccount ? fr.social.aboutPrivate : fr.social.aboutPublic
            }
          />
        </View>
      )}
    </BottomSheet>
  );
}

function Row({ icon, title, value }: { icon: typeof MapPin; title: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Icon icon={icon} size={22} color={theme.text} />
      <View style={styles.rowText}>
        <ThemedText style={styles.rowTitle}>{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {value}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { padding: Spacing.five, alignItems: 'center' },
  body: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.three },
  identity: { alignItems: 'center', gap: Spacing.one, paddingTop: Spacing.two },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.two },
  name: { fontSize: 18, fontWeight: '700' },
  intro: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontWeight: '600' },
});
