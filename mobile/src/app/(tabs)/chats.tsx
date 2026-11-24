import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import {
  Ban,
  Bell,
  BellOff,
  CheckCheck,
  Eye,
  EyeOff,
  Info,
  LogOut,
  MessageSquarePlus,
  Pin,
  PinOff,
  Plus,
  Trash2,
  UserCheck,
  UserRound,
  Users,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Avatar } from '@/components/avatar';
import { ConversationRow, type TypingEntry } from '@/components/conversation-row';
import { FilterTabs } from '@/components/filter-tabs';
import { SwipeableRow, type SwipeAction } from '@/components/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TextField, accentColor } from '@/components/ui';
import { Spacing, Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fr } from '@/i18n/fr';
import { messagesSearchFr } from '@/i18n/messages-search-fr';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useCalls } from '@/features/calls/CallProvider';
import { cache } from '@/lib/cache';
import { chatRouteFor } from '@/features/e2ee/routing';
import { isE2eeEnabled } from '@/features/e2ee/policy';
import { groupUnreadCount } from '@/lib/conversationFilters';
import {
  conversationSectionLabel,
  conversationTitle,
  type ConversationFilter,
} from '@/lib/format';
import { friendsWithoutDisplayedDirectChats } from '@/lib/friend-search';
import { searchFriends, type FriendSearchResult } from '@/lib/friends-api';
import { connectSocket, onConnection } from '@/lib/socket';
import { onMissedMessages } from '@/lib/sync';
import type { ConversationRemovedEvent, ConversationSummary, GroupUpdatedEvent, Message } from '@/lib/types';

const FRIEND_SEARCH_DEBOUNCE_MS = 250;

type ListRow =
  | { key: string; type: 'section'; label: string }
  | { key: string; type: 'conversation'; conversation: ConversationSummary }
  | { key: string; type: 'friend'; friend: FriendSearchResult }
  | { key: string; type: 'searchStatus'; label: string }
  | { key: string; type: 'searchRetry'; label: string };

/** Épinglées d'abord, puis discussions les plus récentes en tête. */
function sortConversations(list: ConversationSummary[]): ConversationSummary[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    const aDate = new Date(a.lastMessage?.createdAt ?? a.createdAt).getTime();
    const bDate = new Date(b.lastMessage?.createdAt ?? b.createdAt).getTime();
    return bDate - aDate;
  });
}

function ConversationSeparator({ leadingItem }: { leadingItem?: ListRow }) {
  const theme = useTheme();
  if (leadingItem?.type === 'section') {
    return null;
  }
  return <View style={[styles.separator, { backgroundColor: theme.backgroundElement }]} />;
}

const listKeyExtractor = (item: ListRow) => item.key;

export default function ChatsScreen() {
  const { token, user } = useAuth();
  const calls = useCalls();
  const liveCallId =
    calls.mode === 'GROUP'
      ? calls.status !== 'idle'
        ? (calls.group?.conversationId ?? null)
        : (calls.offer?.conversationId ?? null)
      : null;
  const theme = useTheme();
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>(
    // Dernière liste connue : la liste s'affiche immédiatement, sans clignotement.
    () => cache.getConversationList() ?? [],
  );
  const [typingMap, setTypingMap] = useState<Record<string, TypingEntry>>({});
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [headerMenu, setHeaderMenu] = useState(false);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [hiddenConversations, setHiddenConversations] = useState<ConversationSummary[]>([]);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(() => new Set());
  const [blockTarget, setBlockTarget] = useState<ConversationSummary | null>(null);
  const [query, setQuery] = useState('');
  const [friendResults, setFriendResults] = useState<FriendSearchResult[]>([]);
  const [friendSearchLoading, setFriendSearchLoading] = useState(false);
  const [friendSearchError, setFriendSearchError] = useState<string | null>(null);
  const [friendSearchAttempt, setFriendSearchAttempt] = useState(0);
  const [openingFriendId, setOpeningFriendId] = useState<string | null>(null);
  // La liste en cache s'affiche immédiatement ; ce drapeau sert seulement à
  // éviter d'afficher « aucune conversation » avant la première réponse.
  const [ready, setReady] = useState(() => cache.getConversationList() !== null);
  const [error, setError] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<ConversationSummary | null>(null);
  const [leaveTarget, setLeaveTarget] = useState<ConversationSummary | null>(null);
  const typingTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const conversationsRef = useRef<ConversationSummary[]>([]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!token || !normalizedQuery || filter !== 'all') {
      setFriendResults([]);
      setFriendSearchLoading(false);
      setFriendSearchError(null);
      return;
    }

    let active = true;
    setFriendResults([]);
    setFriendSearchError(null);
    setFriendSearchLoading(true);
    const timer = setTimeout(() => {
      void searchFriends(token, normalizedQuery)
        .then((results) => {
          if (active) setFriendResults(results);
        })
        .catch((err: unknown) => {
          if (!active) return;
          setFriendSearchError(
            err instanceof ApiError && err.status === 0
              ? messagesSearchFr.offline
              : messagesSearchFr.error,
          );
        })
        .finally(() => {
          if (active) setFriendSearchLoading(false);
        });
    }, FRIEND_SEARCH_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [filter, friendSearchAttempt, query, token]);

  const refresh = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const list = await api.listConversations(token);
      setConversations(sortConversations(list));
      cache.setConversationList(list);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les discussions.');
    } finally {
      setReady(true);
    }
  }, [token]);

  const loadHidden = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const list = await api.listHiddenConversations(token);
      setHiddenConversations(sortConversations(list));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les masquées.');
    }
  }, [token]);

  const handleFilterChange = useCallback(
    (next: ConversationFilter) => {
      setFilter(next);
      if (next === 'hidden') void loadHidden();
    },
    [loadHidden],
  );

  const loadBlocked = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const list = await api.listBlockedUsers(token);
      setBlockedIds(new Set(list.map((item) => item.id)));
    } catch {
      /* silencieux : le blocage reste disponible depuis les réglages */
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      void loadBlocked();
      if (token) {
        // Le socket partagé reste ouvert entre les écrans ; on s'assure
        // simplement qu'il l'est quand la liste reprend le focus.
        connectSocket(token);
      }
    }, [loadBlocked, refresh, token]),
  );

  // Rejoint les salons de toutes les discussions affichées (temps réel).
  useEffect(() => {
    if (!token || conversations.length === 0) {
      return;
    }
    const socket = connectSocket(token);
    for (const conversation of conversations) {
      socket.emit('conversation:join', { conversationId: conversation.id });
    }
  }, [token, conversations]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const socket = connectSocket(token);

    const clearTyping = (conversationId: string) => {
      setTypingMap((previous) => {
        if (!(conversationId in previous)) {
          return previous;
        }
        const next = { ...previous };
        delete next[conversationId];
        return next;
      });
      const timer = typingTimersRef.current.get(conversationId);
      if (timer) {
        clearTimeout(timer);
        typingTimersRef.current.delete(conversationId);
      }
    };

    const onMessage = (message: Message) => {
      if (!conversationsRef.current.some((item) => item.id === message.conversationId)) {
        // Conversation encore inconnue (quelqu'un vient de l'ouvrir) :
        // on recharge la liste pour la faire apparaître.
        void refresh();
        return;
      }
      clearTyping(message.conversationId);
      setConversations((previous) => {
        const index = previous.findIndex((item) => item.id === message.conversationId);
        if (index < 0) {
          return previous;
        }
        const existing = previous[index];
        const updated: ConversationSummary = {
          ...existing,
          lastMessage: message,
          unreadCount:
            message.sender.id === user?.id || message.type === 'call'
              ? existing.unreadCount
              : existing.unreadCount + 1,
        };
        const next = previous.filter((_, position) => position !== index);
        return sortConversations([updated, ...next]);
      });
    };

    const onTyping = (payload: { conversationId: string; userId: string; text?: string }) => {
      if (payload.userId === user?.id) {
        return;
      }
      const conversation = conversationsRef.current.find(
        (item) => item.id === payload.conversationId,
      );
      if (!conversation) {
        return;
      }
      const text = (payload.text ?? '').slice(0, 300);
      if (!text) {
        clearTyping(payload.conversationId);
        return;
      }
      const name =
        conversation.members.find((member) => member.id === payload.userId)?.displayName ??
        'Quelqu’un';
      setTypingMap((previous) => ({ ...previous, [payload.conversationId]: { name, text } }));
      const previousTimer = typingTimersRef.current.get(payload.conversationId);
      if (previousTimer) {
        clearTimeout(previousTimer);
      }
      typingTimersRef.current.set(
        payload.conversationId,
        setTimeout(() => {
          typingTimersRef.current.delete(payload.conversationId);
          setTypingMap((previous) => {
            if (!(payload.conversationId in previous)) {
              return previous;
            }
            const next = { ...previous };
            delete next[payload.conversationId];
            return next;
          });
        }, 3000),
      );
    };

    const onRead = (payload: { conversationId: string; userId: string; at: string }) => {
      setConversations((previous) =>
        previous.map((conversation) => {
          if (conversation.id !== payload.conversationId) {
            return conversation;
          }
          return {
            ...conversation,
            members: conversation.members.map((member) =>
              member.id === payload.userId ? { ...member, lastReadAt: payload.at } : member,
            ),
          };
        }),
      );
    };

    /**
     * Un message retiré change l’aperçu de la discussion — et parfois même son
     * dernier message. Le plus juste reste de le redemander au serveur.
     */
    const onDeleted = (payload: { conversationId?: string }) => {
      if (payload?.conversationId) {
        void refresh();
      }
    };

    socket.on('message:new', onMessage);
    socket.on('typing', onTyping);
    socket.on('read', onRead);
    socket.on('message:deleted', onDeleted);

    // Identité ou membres d'un groupe modifiés : la ligne de liste se met à jour
    // sans attendre le prochain focus.
    const onGroupUpdated = (event: GroupUpdatedEvent) => {
      setConversations((previous) => {
        if (!previous.some((item) => item.id === event.conversationId)) {
          void refresh();
          return previous;
        }
        const next = previous.map((conversation) =>
          conversation.id === event.conversationId
            ? {
                ...conversation,
                name: event.group.name,
                description: event.group.description,
                emoji: event.group.emoji,
                color: event.group.color,
                avatarUrl: event.group.avatarUrl,
                ownerId: event.group.ownerId,
                members: event.members,
                updatedAt: event.group.updatedAt,
              }
            : conversation,
        );
        cache.setConversationList(next);
        return next;
      });
    };
    const onConversationAdded = () => {
      void refresh();
    };
    const onConversationRemoved = (event: ConversationRemovedEvent) => {
      cache.removeConversation(event.conversationId);
      setConversations((previous) =>
        previous.filter((conversation) => conversation.id !== event.conversationId),
      );
    };
    socket.on('group:updated', onGroupUpdated);
    socket.on('members:changed', onGroupUpdated);
    socket.on('conversation:added', onConversationAdded);
    socket.on('conversation:removed', onConversationRemoved);

    return () => {
      socket.off('message:new', onMessage);
      socket.off('typing', onTyping);
      socket.off('read', onRead);
      socket.off('message:deleted', onDeleted);
      socket.off('group:updated', onGroupUpdated);
      socket.off('members:changed', onGroupUpdated);
      socket.off('conversation:added', onConversationAdded);
      socket.off('conversation:removed', onConversationRemoved);
    };
  }, [token, user?.id, refresh]);

  /**
   * Le rattrapage et le retour de connexion changent ce qui est lu, reçu et en
   * attente : la liste relit, sinon les badges resteraient faux après une coupure.
   */
  useEffect(() => {
    if (!token) {
      return;
    }
    const offMissed = onMissedMessages(() => {
      void refresh();
    });
    const offConnection = onConnection((connected) => {
      if (connected) {
        void refresh();
      }
    });
    return () => {
      offMissed();
      offConnection();
    };
  }, [token, refresh]);

  const filteredRows = useMemo<ListRow[]>(() => {
    const needle = query.trim().toLowerCase();
    const source = filter === 'hidden' ? hiddenConversations : conversations;
    const matching = source.filter((item) => {
      // Les discussions masquées n'apparaissent que dans leur propre filtre.
      if (filter !== 'hidden' && item.hidden) {
        return false;
      }
      if (filter === 'unread' && item.unreadCount === 0) {
        return false;
      }
      if (filter === 'groups' && item.type !== 'GROUP') {
        return false;
      }
      if (!needle) {
        return true;
      }
      const title = conversationTitle(item, user?.id ?? '').toLowerCase();
      const preview = (item.lastMessage?.content ?? '').toLowerCase();
      return title.includes(needle) || preview.includes(needle);
    });

    const rows: ListRow[] = [];
    if (needle) {
      if (matching.length > 0) {
        rows.push({
          key: 'section-search-conversations',
          type: 'section',
          label: messagesSearchFr.conversations,
        });
        for (const conversation of matching) {
          rows.push({ key: conversation.id, type: 'conversation', conversation });
        }
      }

      if (filter === 'all') {
        rows.push({
          key: 'section-search-friends',
          type: 'section',
          label: messagesSearchFr.friends,
        });
        if (friendSearchLoading) {
          rows.push({
            key: 'friend-search-loading',
            type: 'searchStatus',
            label: messagesSearchFr.loadingFriends,
          });
        } else if (friendSearchError) {
          rows.push({
            key: 'friend-search-error',
            type: 'searchStatus',
            label: friendSearchError,
          });
          rows.push({
            key: 'friend-search-retry',
            type: 'searchRetry',
            label: messagesSearchFr.retry,
          });
        } else {
          const displayedPeerIds = new Set(
            matching
              .filter((conversation) => conversation.type === 'DIRECT')
              .map((conversation) =>
                conversation.members.find((member) => member.id !== user?.id)?.id,
              )
              .filter((id): id is string => Boolean(id)),
          );
          const visibleFriends = friendsWithoutDisplayedDirectChats(
            friendResults,
            displayedPeerIds,
          );
          if (visibleFriends.length === 0) {
            rows.push({
              key: 'friend-search-empty',
              type: 'searchStatus',
              label: messagesSearchFr.noFriends,
            });
          } else {
            for (const friend of visibleFriends) {
              rows.push({ key: `friend:${friend.id}`, type: 'friend', friend });
            }
          }
        }
      }
      return rows;
    }

    const pinned = matching.filter((item) => item.pinned);
    if (pinned.length > 0) {
      rows.push({ key: 'section-pinned', type: 'section', label: 'Épinglées' });
      for (const conversation of pinned) {
        rows.push({ key: conversation.id, type: 'conversation', conversation });
      }
    }

    let currentLabel = '';
    for (const conversation of matching.filter((item) => !item.pinned)) {
      const label = conversationSectionLabel(
        conversation.lastMessage?.createdAt ?? conversation.createdAt,
      );
      if (label !== currentLabel) {
        currentLabel = label;
        rows.push({ key: `section-${label}`, type: 'section', label });
      }
      rows.push({ key: conversation.id, type: 'conversation', conversation });
    }
    return rows;
  }, [
    hiddenConversations,
    conversations,
    filter,
    query,
    user?.id,
    friendResults,
    friendSearchLoading,
    friendSearchError,
  ]);

  const filterOptions = useMemo(
    () => [
      // « Toutes » n'affiche aucun nombre : un compteur à côté de cet onglet est
      // confondu avec un badge de messages non lus.
      { key: 'all' as const, label: 'Toutes' },
      {
        key: 'unread' as const,
        label: 'Non lus',
        count: (user?.notificationsEnabled ?? true)
          ? conversations.filter((item) => item.unreadCount > 0).length
          : 0,
        dot: true,
      },
      {
        key: 'groups' as const,
        label: 'Groupes',
        count: groupUnreadCount(conversations),
      },
      { key: 'hidden' as const, label: 'Masqué' },
    ],
    [conversations, user?.notificationsEnabled],
  );

  const totalUnread = useMemo(
    () =>
      (user?.notificationsEnabled ?? true)
        ? conversations
            .filter((item) => !item.muted)
            .reduce((total, item) => total + item.unreadCount, 0)
        : 0,
    [conversations, user?.notificationsEnabled],
  );

  const applyPreferences = useCallback(
    async (
      conversation: ConversationSummary,
      body: { pinned?: boolean; muted?: boolean; hidden?: boolean },
    ) => {
      if (!token) {
        return;
      }
      try {
        const updated = await api.setConversationPreferences(token, conversation.id, body);
        if (updated.hidden) {
          setConversations((previous) => previous.filter((item) => item.id !== updated.id));
          setHiddenConversations((previous) =>
            sortConversations([...previous.filter((item) => item.id !== updated.id), updated]),
          );
        } else {
          setConversations((previous) =>
            sortConversations([...previous.filter((item) => item.id !== updated.id), updated]),
          );
          setHiddenConversations((previous) => previous.filter((item) => item.id !== updated.id));
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Action impossible.');
      }
    },
    [token],
  );

  const markConversationRead = useCallback(
    async (conversation: ConversationSummary) => {
      if (!token) {
        return;
      }
      try {
        await api.markRead(token, conversation.id);
        setConversations((previous) =>
          previous.map((item) =>
            item.id === conversation.id ? { ...item, unreadCount: 0 } : item,
          ),
        );
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Impossible de marquer comme lu.');
      }
    },
    [token],
  );

  const markAllRead = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      await api.markAllRead(token);
      setConversations((previous) => previous.map((item) => ({ ...item, unreadCount: 0 })));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de tout marquer comme lu.');
    }
  }, [token]);

  const leaveConversation = useCallback(
    async (conversation: ConversationSummary) => {
      if (!token || !user) {
        return;
      }
      try {
        await api.removeConversationMember(token, conversation.id, user.id);
        setConversations((previous) => previous.filter((item) => item.id !== conversation.id));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Impossible de quitter la discussion.');
      }
    },
    [token, user],
  );

  const routeToConversation = useCallback(
    (conversation: ConversationSummary) => {
      // Le serveur est la seule autorité : `e2eeSince` décide de l'écran.
      // Une conversation chiffrée sans correspondant identifiable est refusée
      // plutôt que renvoyée vers l'écran en clair.
      const route = chatRouteFor({
        conversation,
        currentUserId: user?.id,
        e2eeEnabled: isE2eeEnabled(),
      });
      if (route.kind === 'blocked') {
        setError(fr.e2eeChat.peerMissing);
        return;
      }
      router.push({ pathname: '/chat/[id]', params: route.params });
    },
    [router, user?.id],
  );

  const openConversation = useCallback(
    (conversation: ConversationSummary) => {
      if (openRowId) {
        setOpenRowId(null);
        return;
      }
      routeToConversation(conversation);
    },
    [openRowId, routeToConversation],
  );

  const openFriendChat = useCallback(
    async (friend: FriendSearchResult) => {
      if (!token || !user) return;
      const existing = conversations.find(
        (conversation) =>
          conversation.type === 'DIRECT' &&
          conversation.members.some((member) => member.id === friend.id) &&
          conversation.members.some((member) => member.id === user.id),
      );
      if (existing) {
        routeToConversation(existing);
        return;
      }

      setOpeningFriendId(friend.id);
      try {
        const conversation = await api.createConversation(token, { memberIds: [friend.id] });
        setConversations((previous) => {
          const next = sortConversations([
            conversation,
            ...previous.filter((item) => item.id !== conversation.id),
          ]);
          cache.setConversationList(next);
          return next;
        });
        routeToConversation(conversation);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : messagesSearchFr.openFailed);
      } finally {
        setOpeningFriendId(null);
      }
    },
    [conversations, routeToConversation, token, user],
  );

  const openConversationActions = useCallback((conversation: ConversationSummary) => {
    setActionTarget(conversation);
  }, []);

  const renderItem = useCallback<({ item }: { item: ListRow }) => ReactElement>(
    ({ item }) => {
      if (item.type === 'section') {
        return (
          <ThemedView style={styles.sectionRow}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
              {item.label.toUpperCase()}
            </ThemedText>
          </ThemedView>
        );
      }
      if (item.type === 'searchStatus') {
        return (
          <ThemedView style={styles.searchStatus}>
            <ThemedText type="small" themeColor="textSecondary">
              {item.label}
            </ThemedText>
          </ThemedView>
        );
      }
      if (item.type === 'searchRetry') {
        return (
          <Pressable
            style={styles.searchRetry}
            onPress={() => setFriendSearchAttempt((attempt) => attempt + 1)}
            accessibilityRole="button"
            accessibilityLabel={item.label}>
            <ThemedText type="smallBold" themeColor="accent">
              {item.label}
            </ThemedText>
          </Pressable>
        );
      }
      if (item.type === 'friend') {
        const opening = openingFriendId === item.friend.id;
        return (
          <Pressable
            style={({ pressed }) => [styles.searchFriendRow, pressed && styles.pressed]}
            onPress={() => void openFriendChat(item.friend)}
            disabled={openingFriendId !== null}
            accessibilityRole="button"
            accessibilityLabel={`${item.friend.displayName}, @${item.friend.username}`}>
            <Avatar
              name={item.friend.displayName}
              uri={item.friend.avatarUrl}
              gender={item.friend.gender}
            />
            <View style={styles.searchFriendIdentity}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {item.friend.displayName}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                @{item.friend.username}
              </ThemedText>
            </View>
            {opening ? (
              <ThemedText type="small" themeColor="textSecondary">
                {messagesSearchFr.opening}
              </ThemedText>
            ) : null}
          </Pressable>
        );
      }
      const conversation = item.conversation;
      const leftActions: SwipeAction[] =
        conversation.hidden
          ? [
              {
                key: 'show',
                label: 'Afficher',
                icon: Eye,
                onPress: () => void applyPreferences(conversation, { hidden: false }),
              },
            ]
          : conversation.unreadCount > 0
          ? [
              {
                key: 'read',
                label: 'Lu',
                icon: CheckCheck,
                onPress: () => void markConversationRead(conversation),
              },
            ]
          : [
              {
                key: 'pin',
                label: conversation.pinned ? 'Désépingler' : 'Épingler',
                icon: conversation.pinned ? PinOff : Pin,
                background: '#8e8e93',
                onPress: () =>
                  void applyPreferences(conversation, { pinned: !conversation.pinned }),
              },
            ];
      const rightActions: SwipeAction[] = [
        ...(conversation.hidden
          ? []
          : ([
              {
                key: 'hide',
                label: 'Masquer',
                icon: EyeOff,
                background: '#8e8e93',
                onPress: () => void applyPreferences(conversation, { hidden: true }),
              },
            ] satisfies SwipeAction[])),
        {
          key: 'delete',
          label: 'Supprimer',
          icon: Trash2,
          background: '#e5484d',
          onPress: () => setLeaveTarget(conversation),
        },
      ];
      return (
        <SwipeableRow
          open={openRowId === conversation.id}
          onOpenChange={(next) =>
            setOpenRowId((current) =>
              next ? conversation.id : current === conversation.id ? null : current,
            )
          }
          left={leftActions}
          right={rightActions}>
          <ConversationRow
            conversation={conversation}
            currentUserId={user?.id ?? ''}
            typing={typingMap[conversation.id] ?? null}
            liveCall={conversation.id === liveCallId}
            onPress={openConversation}
            onLongPress={openConversationActions}
          />
        </SwipeableRow>
      );
    },
    [
      applyPreferences,
      liveCallId,
      markConversationRead,
      openConversation,
      openConversationActions,
      openFriendChat,
      openRowId,
      openingFriendId,
      typingMap,
      user?.id,
    ],
  );

  const handleScroll = useCallback(() => {
    if (openRowId) setOpenRowId(null);
  }, [openRowId]);

  const listEmpty = useMemo(
    () =>
      ready ? (
        <ThemedView style={styles.center}>
          <ThemedText themeColor="textSecondary" style={styles.emptyText}>
            {query.trim().length > 0
              ? 'Aucune discussion ne correspond à ta recherche.'
              : filter === 'unread'
                ? 'Tout est lu !'
                : filter === 'groups'
                  ? 'Aucun groupe pour le moment.'
                  : filter === 'hidden'
                    ? 'Aucune discussion masquée.'
                    : 'Aucune conversation pour le moment.\nAppuie sur + pour commencer.'}
          </ThemedText>
        </ThemedView>
      ) : undefined,
    [ready, query, filter],
  );

  // Déclarés avant le early return d'authentification : sauter ces hooks au
  // re-render de déconnexion ferait planter React (hook count mismatch).
  const blockTargetUser = blockTarget?.members.find((member) => member.id !== user?.id) ?? null;

  const confirmBlock = useCallback(async () => {
    if (!token || !blockTargetUser) {
      return;
    }
    const blockedUserId = blockTargetUser.id;
    setBlockTarget(null);
    try {
      await api.blockUser(token, blockedUserId);
      setBlockedIds((previous) => new Set(previous).add(blockedUserId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Blocage impossible.');
    }
  }, [blockTargetUser, token]);

  const unblockUser = useCallback(
    async (userId: string) => {
      if (!token) {
        return;
      }
      try {
        await api.unblockUser(token, userId);
        setBlockedIds((previous) => {
          const next = new Set(previous);
          next.delete(userId);
          return next;
        });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Déblocage impossible.');
      }
    },
    [token],
  );

  if (!token || !user) {
    return <Redirect href="/login" />;
  }

  const sheetOther =
    actionTarget?.type === 'DIRECT'
      ? (actionTarget.members.find((member) => member.id !== user?.id) ?? null)
      : null;

  const sheetActions: SheetAction[] = actionTarget
    ? [
        ...(actionTarget.type === 'DIRECT'
          ? (() => {
              const other = actionTarget.members.find((member) => member.id !== user.id);
              return [
                {
                  key: 'profile',
                  label: 'Voir le profil',
                  icon: UserRound,
                  onPress: () => {
                    setActionTarget(null);
                    if (other) {
                      router.push({
                        pathname: '/user/[id]',
                        params: {
                          id: other.id,
                          name: other.displayName,
                          username: other.username,
                          avatar: other.avatarUrl ?? '',
                          gender: other.gender ?? '',
                        },
                      });
                    }
                  },
                },
              ] satisfies SheetAction[];
            })()
          : []),
        ...(actionTarget.unreadCount > 0
          ? ([
              {
                key: 'read',
                label: 'Marquer comme lu',
                icon: CheckCheck,
                onPress: () => {
                  setActionTarget(null);
                  void markConversationRead(actionTarget);
                },
              },
            ] satisfies SheetAction[])
          : []),
        {
          key: 'pin',
          label: actionTarget.pinned ? 'Désépingler' : 'Épingler la discussion',
          icon: actionTarget.pinned ? PinOff : Pin,
          onPress: () => {
            setActionTarget(null);
            void applyPreferences(actionTarget, { pinned: !actionTarget.pinned });
          },
        },
        {
          key: 'mute',
          label: actionTarget.muted ? 'Réactiver les notifications' : 'Couper les notifications',
          icon: actionTarget.muted ? Bell : BellOff,
          onPress: () => {
            setActionTarget(null);
            void applyPreferences(actionTarget, { muted: !actionTarget.muted });
          },
        },
        {
          key: 'hide',
          label: actionTarget.hidden ? 'Afficher la discussion' : 'Masquer la discussion',
          icon: actionTarget.hidden ? Eye : EyeOff,
          onPress: () => {
            setActionTarget(null);
            void applyPreferences(actionTarget, { hidden: !actionTarget.hidden });
          },
        },
        ...(actionTarget.type === 'GROUP'
          ? ([
              {
                key: 'info',
                label: 'Infos de la discussion',
                icon: Info,
                onPress: () => {
                  const id = actionTarget.id;
                  setActionTarget(null);
                  router.push({ pathname: '/group/[id]', params: { id } });
                },
              },
            ] satisfies SheetAction[])
          : []),
        {
          key: 'leave',
          label:
            actionTarget.type === 'GROUP'
              ? 'Quitter la discussion'
              : 'Supprimer la conversation',
          icon: LogOut,
          destructive: true,
          onPress: () => {
            setActionTarget(null);
            setLeaveTarget(actionTarget);
          },
        },
        ...(sheetOther
          ? ([
              {
                key: blockedIds.has(sheetOther.id) ? 'unblock' : 'block',
                label: blockedIds.has(sheetOther.id) ? 'Débloquer' : 'Bloquer',
                icon: blockedIds.has(sheetOther.id) ? UserCheck : Ban,
                destructive: !blockedIds.has(sheetOther.id),
                onPress: () => {
                  setActionTarget(null);
                  if (blockedIds.has(sheetOther.id)) {
                    void unblockUser(sheetOther.id);
                  } else {
                    setBlockTarget(actionTarget);
                  }
                },
              },
            ] satisfies SheetAction[])
          : []),
      ]
    : [];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.flex} edges={['top', 'left', 'right', 'bottom']}>
        <ThemedView style={styles.header}>
          <ThemedView style={styles.headerTitleRow}>
            <ThemedText style={styles.brandTitle}>MboloChat</ThemedText>
          </ThemedView>
          <ThemedView style={styles.headerActions}>
            <Pressable
              onPress={() => router.push('/profile')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Mon profil"
              style={({ pressed }) => pressed && styles.pressed}>
              <Avatar
                name={user?.displayName ?? 'Moi'}
                uri={user?.avatarUrl}
                gender={user?.gender}
                size={34}
              />
            </Pressable>
            <Pressable
              onPress={() => setHeaderMenu(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Nouveau"
              style={({ pressed }) => pressed && styles.pressed}>
              <Plus size={26} strokeWidth={2.2} color={theme.text} />
            </Pressable>
          </ThemedView>
        </ThemedView>

        <ThemedView style={styles.searchWrapper}>
          <TextField
            style={styles.search}
            placeholder={messagesSearchFr.placeholder}
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
          />
        </ThemedView>

        <FilterTabs options={filterOptions} value={filter} onChange={handleFilterChange} />

        {error ? (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}

        <FlatList
          data={filteredRows}
          keyExtractor={listKeyExtractor}
          contentContainerStyle={filteredRows.length === 0 ? styles.emptyList : styles.listContent}
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={5}
          updateCellsBatchingPeriod={50}
          ItemSeparatorComponent={ConversationSeparator}
          ListEmptyComponent={listEmpty}
          renderItem={renderItem}
        />

        <ActionSheet
          visible={headerMenu}
          title="Nouveau"
          actions={[
            {
              key: 'message',
              label: 'Nouveau message',
              icon: MessageSquarePlus,
              onPress: () => {
                setHeaderMenu(false);
                router.push('/new-message');
              },
            },
            {
              key: 'group',
              label: 'Nouveau groupe',
              icon: Users,
              onPress: () => {
                setHeaderMenu(false);
                router.push('/new-group');
              },
            },
            ...(totalUnread > 0
              ? ([
                  {
                    key: 'readAll',
                    label: 'Tout marquer comme lu',
                    icon: CheckCheck,
                    onPress: () => {
                      setHeaderMenu(false);
                      void markAllRead();
                    },
                  },
                ] satisfies SheetAction[])
              : []),
          ]}
          onClose={() => setHeaderMenu(false)}
        />

        <ActionSheet
          visible={blockTarget !== null}
          title={blockTargetUser ? `Bloquer ${blockTargetUser.displayName} ?` : 'Bloquer ?'}
          subtitle="Cette personne ne pourra plus t’envoyer de messages."
          actions={[
            {
              key: 'block',
              label: 'Bloquer',
              icon: Ban,
              destructive: true,
              onPress: () => void confirmBlock(),
            },
          ]}
          onClose={() => setBlockTarget(null)}
        />

        <ActionSheet
          visible={actionTarget !== null}
          title={actionTarget ? conversationTitle(actionTarget, user.id) : undefined}
          subtitle={
            actionTarget
              ? actionTarget.type === 'GROUP'
                ? `${actionTarget.members.length} membres`
                : undefined
              : undefined
          }
          actions={sheetActions}
          onClose={() => setActionTarget(null)}
        />

        <ActionSheet
          visible={leaveTarget !== null}
          title={leaveTarget ? conversationTitle(leaveTarget, user.id) : undefined}
          subtitle={
            leaveTarget?.type === 'GROUP'
              ? 'Tu ne pourras plus recevoir les messages de ce groupe.'
              : 'La conversation disparaîtra de ta liste.'
          }
          actions={
            leaveTarget
              ? [
                  {
                    key: 'confirm',
                    label:
                      leaveTarget.type === 'GROUP'
                        ? 'Quitter la discussion'
                        : 'Supprimer la conversation',
                    destructive: true,
                    onPress: () => {
                      const target = leaveTarget;
                      setLeaveTarget(null);
                      void leaveConversation(target);
                    },
                  },
                ]
              : []
          }
          onClose={() => setLeaveTarget(null)}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  brandTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    color: accentColor,
  },
  searchWrapper: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  search: {
    borderRadius: Radii.md,
    paddingVertical: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  emptyList: {
    flexGrow: 1,
  },
  emptyText: {
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: 96,
  },
  sectionRow: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
  sectionLabel: {
    letterSpacing: 0.8,
    fontSize: 12,
  },
  searchFriendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  searchFriendIdentity: {
    flex: 1,
    gap: Spacing.half,
  },
  searchStatus: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  searchRetry: {
    alignSelf: 'flex-start',
    marginHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 84,
  },
  error: {
    color: '#e5484d',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
  },
  backdrop: {
    flex: 1,
  },
  backdropDim: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
});
