import { Pencil } from 'lucide-react-native';
import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Radii, Scrim, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import type { UserProfile } from '@/lib/types';

interface ProfileHeaderProps {
  profile: UserProfile;
  /** Boutons d'action (modifier, écrire, appeler…). */
  actions?: ReactNode;
  /** Icône de crayon à côté du nom complet (accès à l'édition du profil). */
  onPressEdit?: () => void;
  /** Masqué sur son propre profil : le @pseudo se consulte et se copie dans les paramètres. */
  showUsername?: boolean;
  onPressAvatar?: () => void;
  /** Affiche un voile pendant un changement de photo. */
  avatarBusy?: boolean;
}

/** En-tête partagé : avatar, identité, informations et actions. */
export function ProfileHeader({
  profile,
  actions,
  onPressEdit,
  showUsername = true,
  onPressAvatar,
  avatarBusy = false,
}: ProfileHeaderProps) {
  const theme = useTheme();
  const meta =
    profile.city && profile.age !== null
      ? fr.profile.cityAge(profile.city, profile.age)
      : profile.city
        ? profile.city
        : profile.age !== null
          ? fr.profile.ageOnly(profile.age)
          : null;

  return (
    <View style={styles.header}>
      <Pressable onPress={onPressAvatar} disabled={!onPressAvatar} accessibilityRole="imagebutton">
        <View>
          <Avatar
            name={profile.displayName}
            uri={profile.avatarUrl}
            size={86}
            gender={profile.gender}
          />
          {avatarBusy ? (
            <View style={[styles.avatarOverlay, { borderRadius: Radii.full }]}>
              <ActivityIndicator color={theme.onAccent} />
            </View>
          ) : null}
        </View>
      </Pressable>

      <View style={styles.identity}>
        <View style={styles.nameRow}>
          <ThemedText style={styles.name} numberOfLines={1}>
            {profile.displayName}
          </ThemedText>
          {onPressEdit ? (
            <Pressable
              onPress={onPressEdit}
              hitSlop={Spacing.one}
              accessibilityRole="button"
              accessibilityLabel={fr.profile.edit}>
              <Pencil size={20} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
        {showUsername ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            @{profile.username}
          </ThemedText>
        ) : null}
        {meta ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {meta}
          </ThemedText>
        ) : null}
        {profile.bio ? (
          <ThemedText themeColor="textSecondary" style={styles.bio} numberOfLines={3}>
            {profile.bio}
          </ThemedText>
        ) : null}
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
    </View>
  );
}

export function ProfileStats({
  followers,
  following,
  publications,
  onPressFollowers,
  onPressFollowing,
}: {
  followers: number;
  following: number;
  publications: number;
  onPressFollowers?: () => void;
  onPressFollowing?: () => void;
}) {
  return (
    <View style={styles.stats} accessibilityRole="summary">
      <Stat label={fr.social.followers} value={followers} onPress={onPressFollowers} />
      <Stat label={fr.social.following} value={following} onPress={onPressFollowing} />
      <Stat label={fr.social.publications} value={publications} />
    </View>
  );
}

function Stat({ label, value, onPress }: { label: string; value: number; onPress?: () => void }) {
  const content = (
    <>
      <ThemedText style={styles.statValue}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
      style={({ pressed }) => [styles.stat, pressed && { opacity: 0.7 }]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={styles.stat}>{content}</View>
  );
}

interface ProfileActionProps {
  label: string;
  onPress: () => void;
  /** Style « plein » pour l'action principale. */
  primary?: boolean;
  /** Style « destructif » (bloquer un compte). */
  danger?: boolean;
  loading?: boolean;
}

/** Bouton d'action compact, rayon md, hauteur tactile conservée. */
export function ProfileAction({
  label,
  onPress,
  primary = false,
  danger = false,
  loading = false,
}: ProfileActionProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: primary ? theme.accent : theme.backgroundElement,
          opacity: pressed || loading ? 0.6 : 1,
        },
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={primary ? theme.onAccent : theme.text} />
      ) : (
        <ThemedText
          style={[
            styles.actionLabel,
            { color: primary ? theme.onAccent : danger ? theme.danger : theme.text },
          ]}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.four,
    paddingTop: Spacing.two,
  },
  identity: { flex: 1, alignItems: 'flex-start', gap: Spacing.half, minWidth: 0 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.two,
    maxWidth: '100%',
  },
  name: { ...Type.screenTitle, flexShrink: 1 },
  bio: { ...Type.body, marginTop: Spacing.one },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  action: {
    minHeight: Spacing.five + Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { ...Type.caption },
  avatarOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Scrim,
  },
  stats: { flexDirection: 'row', gap: Spacing.three },
  stat: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.half, minHeight: Spacing.five },
  statValue: { ...Type.sectionTitle },
});
