import { router } from 'expo-router';
import {
  ArrowLeft,
  BadgeCheck,
  Hash,
  Image as ImageIcon,
  MessageCircle,
  MessageSquareText,
  Play,
  Users,
} from 'lucide-react-native';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DiscoverMetrics, Radii, Spacing, Type } from '@/constants/theme';
import type { DiscoverPublication, DiscoverResponse, DiscoverSectionKey } from '@/features/social/discover/discover-api';
import { useTheme } from '@/hooks/use-theme';
import { discoverFr } from '@/i18n/discover-fr';
import { fr } from '@/i18n/fr';
import { formatCompactCount, formatListTimestamp } from '@/lib/format';
import { resolveMediaUrl } from '@/lib/media-url';
import type { FollowState } from '@/lib/types';

const publicationSectionKeys = ['nearbyFriends', 'popular', 'successful'] as const;
type PublicationSectionKey = (typeof publicationSectionKeys)[number];

interface DiscoverRailsProps {
  data: DiscoverResponse;
  followStates: Record<string, FollowState>;
  busyFollowIds: ReadonlySet<string>;
  onFollow: (userId: string) => void;
  onSelectHashtag: (tag: string) => void;
}

export function DiscoverRails({
  data,
  followStates,
  busyFollowIds,
  onFollow,
  onSelectHashtag,
}: DiscoverRailsProps) {
  const theme = useTheme();
  const [activeSection, setActiveSection] = useState<DiscoverSectionKey | null>(null);

  const titleFor = (key: DiscoverSectionKey) => discoverFr.sectionTitles[key];
  const publicationsFor = (key: PublicationSectionKey) => data.sections[key];

  if (activeSection) {
    const title = titleFor(activeSection);
    return (
      <View style={styles.expanded}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={discoverFr.back}
          onPress={() => setActiveSection(null)}
          style={styles.backButton}>
          <Icon icon={ArrowLeft} size={Spacing.four} color={theme.text} />
          <ThemedText type="smallBold">{discoverFr.back}</ThemedText>
        </Pressable>
        <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
        {activeSection === 'trendingHashtags' ? (
          data.sections.trendingHashtags.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {discoverFr.emptyHashtags}
            </ThemedText>
          ) : (
            data.sections.trendingHashtags.map((item) => (
              <HashtagRow
                key={item.id}
                tag={item.tag}
                usageCount={item.usageCount}
                onPress={() => onSelectHashtag(item.tag)}
              />
            ))
          )
        ) : null}
        {activeSection === 'suggestedAccounts' ? (
          data.sections.suggestedAccounts.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {discoverFr.emptyAccounts}
            </ThemedText>
          ) : (
            data.sections.suggestedAccounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                followState={followStates[account.id]}
                busy={busyFollowIds.has(account.id)}
                onFollow={() => onFollow(account.id)}
              />
            ))
          )
        ) : null}
        {publicationSectionKeys.includes(activeSection as PublicationSectionKey) ? (
          publicationsFor(activeSection as PublicationSectionKey).length === 0 ? (
            <EmptyPublicationSection section={activeSection as PublicationSectionKey} cityKnown={data.cityKnown} />
          ) : (
            publicationsFor(activeSection as PublicationSectionKey).map((publication) => (
              <PublicationRow key={publication.id} publication={publication} />
            ))
          )
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.rails}>
      {publicationSectionKeys.map((key) => (
        <PublicationRail
          key={key}
          section={key}
          publications={publicationsFor(key)}
          cityKnown={data.cityKnown}
          onSeeAll={() => setActiveSection(key)}
        />
      ))}
      <View style={styles.section}>
        <SectionHeader
          title={titleFor('trendingHashtags')}
          onSeeAll={() => setActiveSection('trendingHashtags')}
        />
        {data.sections.trendingHashtags.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {discoverFr.emptyHashtags}
          </ThemedText>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {data.sections.trendingHashtags.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${discoverFr.openHashtag} ${item.tag}`}
                onPress={() => onSelectHashtag(item.tag)}
                style={[styles.hashtagCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <View style={[styles.hashtagMark, { backgroundColor: theme.accentSoft }]}>
                  <Icon icon={Hash} size={Spacing.four} color={theme.accent} />
                </View>
                <ThemedText style={styles.hashtagTitle} numberOfLines={1}>#{item.tag}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {discoverFr.uses(formatCompactCount(item.usageCount))}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
      <View style={styles.section}>
        <SectionHeader
          title={titleFor('suggestedAccounts')}
          onSeeAll={() => setActiveSection('suggestedAccounts')}
        />
        {data.sections.suggestedAccounts.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {discoverFr.emptyAccounts}
          </ThemedText>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {data.sections.suggestedAccounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                followState={followStates[account.id]}
                busy={busyFollowIds.has(account.id)}
                onFollow={() => onFollow(account.id)}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function SectionHeader({ title, onSeeAll }: { title: string; onSeeAll: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={discoverFr.seeSection(title)}
        onPress={onSeeAll}
        style={styles.seeAllButton}>
        <ThemedText type="smallBold" style={{ color: theme.accent }}>{discoverFr.seeAll}</ThemedText>
      </Pressable>
    </View>
  );
}

function PublicationRail({
  section,
  publications,
  cityKnown,
  onSeeAll,
}: {
  section: PublicationSectionKey;
  publications: DiscoverPublication[];
  cityKnown: boolean;
  onSeeAll: () => void;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader title={discoverFr.sectionTitles[section]} onSeeAll={onSeeAll} />
      {publications.length === 0 ? (
        <EmptyPublicationSection section={section} cityKnown={cityKnown} />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
          {publications.map((publication) => (
            <PublicationCard key={publication.id} publication={publication} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function EmptyPublicationSection({ section, cityKnown }: { section: PublicationSectionKey; cityKnown: boolean }) {
  const message = section === 'nearbyFriends' && !cityKnown
    ? discoverFr.cityUnknown
    : section === 'nearbyFriends'
      ? discoverFr.emptyNearby
      : section === 'popular'
        ? discoverFr.emptyPopular
        : discoverFr.emptySuccessful;
  return <ThemedText type="small" themeColor="textSecondary">{message}</ThemedText>;
}

function PublicationCard({ publication }: { publication: DiscoverPublication }) {
  const theme = useTheme();
  const cover = publication.media[0];
  const imageUrl = cover?.posterUrl ?? cover?.url;
  const imageUri = imageUrl ? resolveMediaUrl(imageUrl) : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fr.social.readPublication(publication.author.displayName)}
      onPress={() => router.push(`/post/${publication.id}`)}
      style={[styles.publicationCard, { width: DiscoverMetrics.publicationCardWidth, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={[styles.publicationMedia, { height: DiscoverMetrics.publicationMediaHeight, backgroundColor: theme.backgroundSelected }]}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={styles.mediaFallback}>
            <Icon icon={publication.format === 'text' ? MessageSquareText : ImageIcon} size={Spacing.five} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">{discoverFr.cardText}</ThemedText>
          </View>
        )}
        {publication.kind === 'reel' || cover?.kind === 'video' ? (
          <View style={[styles.videoBadge, { backgroundColor: theme.backgroundElement }]}>
            <Icon icon={Play} size={Spacing.three} color={theme.text} />
          </View>
        ) : null}
      </View>
      <View style={styles.publicationBody}>
        <View style={styles.authorRow}>
          <Avatar name={publication.author.displayName} uri={publication.author.avatarUrl} size={DiscoverMetrics.accountAvatar / 2} />
          <View style={styles.authorDetails}>
            <View style={styles.authorNameRow}>
              <ThemedText type="smallBold" numberOfLines={1} style={styles.flex}>{publication.author.displayName}</ThemedText>
              {publication.author.verified ? <Icon icon={BadgeCheck} size={Spacing.three} color={theme.accent} /> : null}
            </View>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              @{publication.author.username} · {formatListTimestamp(publication.createdAt)}
            </ThemedText>
          </View>
        </View>
        {publication.caption ? (
          <ThemedText type="small" numberOfLines={2}>{publication.caption}</ThemedText>
        ) : null}
        <View style={styles.statsRow}>
          <Icon icon={MessageCircle} size={Spacing.three} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary">
            {discoverFr.publicationStats(formatCompactCount(publication.counters.likes), formatCompactCount(publication.counters.comments))}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

function PublicationRow({ publication }: { publication: DiscoverPublication }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fr.social.readPublication(publication.author.displayName)}
      onPress={() => router.push(`/post/${publication.id}`)}
      style={[styles.publicationRow, { borderBottomColor: theme.border }]}>
      <Avatar name={publication.author.displayName} uri={publication.author.avatarUrl} size={DiscoverMetrics.accountAvatar} />
      <View style={styles.publicationRowBody}>
        <ThemedText type="smallBold" numberOfLines={1}>{publication.author.displayName}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          @{publication.author.username} · {formatListTimestamp(publication.createdAt)}
        </ThemedText>
        {publication.caption ? <ThemedText type="small" numberOfLines={2}>{publication.caption}</ThemedText> : null}
      </View>
    </Pressable>
  );
}

function HashtagRow({ tag, usageCount, onPress }: { tag: string; usageCount: number; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${discoverFr.openHashtag} ${tag}`}
      onPress={onPress}
      style={[styles.hashtagRow, { borderBottomColor: theme.border }]}>
      <View style={[styles.hashtagMark, { backgroundColor: theme.accentSoft }]}>
        <Icon icon={Hash} size={Spacing.four} color={theme.accent} />
      </View>
      <View style={styles.publicationRowBody}>
        <ThemedText type="smallBold">#{tag}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {discoverFr.uses(formatCompactCount(usageCount))}
        </ThemedText>
      </View>
    </Pressable>
  );
}

function AccountCard({
  account,
  followState,
  busy,
  onFollow,
}: {
  account: DiscoverResponse['sections']['suggestedAccounts'][number];
  followState?: FollowState;
  busy: boolean;
  onFollow: () => void;
}) {
  const theme = useTheme();
  const status = followState?.status ?? 'none';
  const label = status === 'accepted' ? discoverFr.following : status === 'pending' ? fr.social.requested : discoverFr.follow;
  return (
    <ThemedView style={[styles.accountCard, { width: DiscoverMetrics.accountCardWidth, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fr.social.viewProfile}
        onPress={() => router.push(`/user/${account.id}`)}
        style={styles.accountIdentity}>
        <Avatar name={account.displayName} uri={account.avatarUrl} size={DiscoverMetrics.accountAvatar} />
        <View style={styles.accountNameRow}>
          <ThemedText type="smallBold" numberOfLines={1}>{account.displayName}</ThemedText>
          {account.verified ? <Icon icon={BadgeCheck} size={Spacing.three} color={theme.accent} /> : null}
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>@{account.username}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {discoverFr.followers(formatCompactCount(account.followerCount))}
        </ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || status !== 'none' }}
        disabled={busy || status !== 'none'}
        onPress={onFollow}
        style={[styles.followButton, { backgroundColor: status === 'none' ? theme.accent : theme.backgroundSelected }]}>
        <ThemedText type="smallBold" style={{ color: status === 'none' ? theme.onAccent : theme.textSecondary }}>
          {busy ? discoverFr.following : label}
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
}

function AccountRow({
  account,
  followState,
  busy,
  onFollow,
}: {
  account: DiscoverResponse['sections']['suggestedAccounts'][number];
  followState?: FollowState;
  busy: boolean;
  onFollow: () => void;
}) {
  const theme = useTheme();
  const status = followState?.status ?? 'none';
  const label = status === 'accepted' ? discoverFr.following : status === 'pending' ? fr.social.requested : discoverFr.follow;
  return (
    <View style={[styles.accountRow, { borderBottomColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fr.social.viewProfile}
        onPress={() => router.push(`/user/${account.id}`)}
        style={styles.accountRowIdentity}>
        <Avatar name={account.displayName} uri={account.avatarUrl} size={DiscoverMetrics.accountAvatar} />
        <View style={styles.accountRowBody}>
          <View style={styles.authorNameRow}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.flex}>{account.displayName}</ThemedText>
            {account.verified ? <Icon icon={BadgeCheck} size={Spacing.three} color={theme.accent} /> : null}
          </View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            @{account.username} · {discoverFr.followers(formatCompactCount(account.followerCount))}
          </ThemedText>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || status !== 'none' }}
        disabled={busy || status !== 'none'}
        onPress={onFollow}
        style={[styles.followButton, styles.followButtonCompact, { backgroundColor: status === 'none' ? theme.accent : theme.backgroundSelected }]}>
        <ThemedText type="smallBold" style={{ color: status === 'none' ? theme.onAccent : theme.textSecondary }}>
          {busy ? discoverFr.following : label}
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  rails: { gap: Spacing.four },
  section: { gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  sectionTitle: { ...Type.sectionTitle, flex: 1 },
  seeAllButton: { paddingVertical: Spacing.one, paddingLeft: Spacing.two },
  rail: { gap: Spacing.three },
  expanded: { gap: Spacing.three },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, alignSelf: 'flex-start', paddingVertical: Spacing.one },
  publicationCard: { borderWidth: 1, borderRadius: Radii.md, overflow: 'hidden' },
  publicationMedia: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  mediaFallback: { alignItems: 'center', gap: Spacing.two },
  videoBadge: { position: 'absolute', right: Spacing.two, top: Spacing.two, padding: Spacing.one, borderRadius: Radii.full },
  publicationBody: { padding: Spacing.three, gap: Spacing.two },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  authorDetails: { flex: 1, gap: Spacing.half },
  authorNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  flex: { flex: 1 },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  hashtagCard: { width: DiscoverMetrics.accountCardWidth, borderWidth: 1, borderRadius: Radii.md, padding: Spacing.three, gap: Spacing.two },
  hashtagMark: { width: Spacing.five, height: Spacing.five, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center' },
  hashtagTitle: { ...Type.body, fontWeight: '600' },
  accountCard: { borderWidth: 1, borderRadius: Radii.md, padding: Spacing.three, alignItems: 'center', gap: Spacing.two },
  accountIdentity: { alignItems: 'center', gap: Spacing.one, width: '100%' },
  accountNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one, maxWidth: '100%' },
  followButton: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Radii.button, minHeight: Spacing.five, width: '100%' },
  followButtonCompact: { width: 'auto', minWidth: DiscoverMetrics.accountAvatar * 2 },
  publicationRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: 1 },
  publicationRowBody: { flex: 1, gap: Spacing.half },
  hashtagRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: 1 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, borderBottomWidth: 1 },
  accountRowIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  accountRowBody: { flex: 1, gap: Spacing.half },
});
