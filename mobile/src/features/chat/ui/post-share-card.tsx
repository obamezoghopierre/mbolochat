import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Images, Play } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedSurface, Radii, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { fr } from '@/i18n/fr';
import { resolveMediaUrl } from '@/lib/media-url';
import type { FeedPost } from '@/lib/types';
import { extraMediaCount, primaryMedia } from '@/features/social/feed/pager/feed-media';

/**
 * Carte d'une publication partagée dans une discussion (lien profond
 * `mbolochat://post/<id>` envoyé comme message), rendue comme l'aperçu de
 * post d'Instagram : grand média, puis avatar + auteur + extrait de
 * légende. Le contenu est relu via l'API : si la publication a été
 * supprimée ou est devenue invisible, la carte l'indique au lieu de
 * casser la bulle.
 */
export function PostShareCard({ publicationId, token }: { publicationId: string; token: string }) {
  const theme = useTheme();
  const [post, setPost] = useState<FeedPost | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    let active = true;
    api
      .publication(token, publicationId)
      .then((result) => {
        if (!active) return;
        setPost(result);
        setState('ready');
      })
      .catch(() => {
        if (active) setState('missing');
      });
    return () => {
      active = false;
    };
  }, [publicationId, token]);

  if (state === 'missing') {
    return (
      <View style={[styles.card, { borderColor: theme.border }]}>
        <ThemedText type="caption" themeColor="textSecondary">
          {fr.chat.postShare.unavailable}
        </ThemedText>
      </View>
    );
  }

  const media = post ? primaryMedia(post) : null;
  const preview = media
    ? resolveMediaUrl(media.kind === 'video' ? media.posterUrl : media.url)
    : null;
  const extras = post ? extraMediaCount(post) : 0;

  return (
    <Pressable
      onPress={() => router.push(`/post/${publicationId}`)}
      disabled={state !== 'ready'}
      accessibilityRole="button"
      accessibilityLabel={
        post ? fr.chat.postShare.open(post.author.displayName) : fr.chat.postShare.unavailable
      }
      style={({ pressed }) => [
        styles.card,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
        pressed && { opacity: 0.8 },
      ]}>
      {preview ? (
        <View style={styles.media}>
          <Image
            source={{ uri: preview }}
            style={[styles.mediaImage, { backgroundColor: theme.backgroundSelected }]}
            contentFit="cover"
            transition={120}
          />
          {media?.kind === 'video' || extras > 0 ? (
            <View style={styles.badge}>
              <Icon
                icon={media?.kind === 'video' ? Play : Images}
                size={12}
                color={FeedSurface.onMedia}
                fill={media?.kind === 'video' ? FeedSurface.onMedia : 'none'}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.body}>
        {post ? (
          <>
            <View style={styles.authorRow}>
              <Avatar
                name={post.author.displayName}
                uri={post.author.avatarUrl}
                size={20}
                variant="user"
              />
              <ThemedText numberOfLines={1} style={styles.name}>
                {post.author.displayName}
              </ThemedText>
            </View>
            {post.caption ? (
              <ThemedText
                numberOfLines={preview ? 3 : 5}
                type={preview ? 'caption' : 'small'}
                themeColor={preview ? 'textSecondary' : undefined}>
                {post.caption}
              </ThemedText>
            ) : null}
          </>
        ) : (
          <View style={styles.skeleton} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 240,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  media: {
    width: '100%',
    aspectRatio: 1,
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    right: Spacing.two,
    bottom: Spacing.two,
    width: 22,
    height: 22,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FeedSurface.glassStrong,
  },
  body: {
    gap: Spacing.one,
    paddingHorizontal: Spacing.two + Spacing.half,
    paddingVertical: Spacing.two,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
  },
  name: {
    ...Type.caption,
    fontWeight: '700',
    flexShrink: 1,
  },
  skeleton: {
    height: 14,
    borderRadius: Radii.xs,
    backgroundColor: 'rgba(128,128,128,0.25)',
  },
});
