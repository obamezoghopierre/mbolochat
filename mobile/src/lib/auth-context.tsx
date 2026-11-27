import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { cache } from './cache';
import { isTransientSessionError } from './auth-restore';
import { resetEmojiFavorites } from '@/features/emoji/useEmojiFavorites';
import { resetRecentEmoji } from '@/features/emoji/useRecentEmoji';
import { resetStickerLibrary } from '@/features/stickers/stickerLibrary';
import { purgeTextDrafts, setTextDraftOwner } from '@/lib/text-draft';
import {
  clearFeedSnapshots,
  hydrateFeedSnapshots,
} from '@/features/social/feed/feed-snapshot';
import {
  clearDiscoverSnapshot,
  hydrateDiscoverSnapshot,
} from '@/features/social/discover/discover-snapshot';
import { sweepSecureMedia } from '@/features/e2ee/mediaStore';
import { resetE2eeInitState } from '@/features/e2ee/initState';
import { getActiveE2eeUser, setActiveE2eeUser } from '@/features/e2ee/activeUser';
import { activateLocalStore } from './store';
import { syncPushToken, ensurePushRegistration, getExistingPushToken } from './push';
import { disconnectSocket } from './socket';
import { announcePresenceLogout } from '@/features/presence/presenceStore';
import {
  clearStoredTokens,
  getCachedUser,
  getCachedAccessToken,
  getStoredAccessToken,
  getStoredRefreshToken,
  storeCachedUser,
  storeTokens,
} from './token-storage';
import type { User } from './types';

interface AuthState {
  token: string | null;
  user: User | null;
  loading: boolean;
  signIn: (accessToken: string, refreshToken: string, user: User) => Promise<void>;
  setUser: (user: User) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * Ferme les bases chiffrées du compte précédent. Import paresseux : le module
 * natif E2EE ne doit pas être chargé sur les cibles qui n'en ont pas (web).
 */
async function closeE2eeDatabases(): Promise<void> {
  try {
    const { closeAllE2eeDatabases } = await import('@/features/e2ee/db');
    await closeAllE2eeDatabases();
  } catch {
    /* aucune base ouverte */
  }
}

async function bindE2eeUser(userId: string): Promise<void> {
  if (getActiveE2eeUser() !== userId) {
    await closeE2eeDatabases();
    resetE2eeInitState();
  }
  setActiveE2eeUser(userId);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // À chaque session restaurée, on rafraîchit le jeton push (et l'adresse
  // de l'API que l'appareil utilise pour les photos de notification).
  useEffect(() => {
    if (!token) {
      return;
    }
    void syncPushToken(token);
  }, [token]);

  // Les brouillons de publication sont cloisonnés par compte : un changement
  // de session recharge la liste du nouveau propriétaire.
  useEffect(() => {
    setTextDraftOwner(user?.id ?? null);
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Le cache disque est chargé avant tout affichage : les pages s'ouvrent
      // ensuite instantanément, avec leur contenu déjà prêt. L'écran de
      // lancement natif reste affiché pendant ce temps (cf. LaunchGate).
      await cache.hydrate();
      const restoreOffline = async (
        accessToken: string,
        cachedUser: User | null,
      ): Promise<boolean> => {
        if (!cachedUser) return false;
        await bindE2eeUser(cachedUser.id);
        await cache.prepareForUser(cachedUser.id);
        // Fil de la dernière visite : prêt avant le premier rendu de l'accueil.
        await hydrateFeedSnapshots(cachedUser.id);
        await hydrateDiscoverSnapshot(cachedUser.id);
        await activateLocalStore(cachedUser.id).catch(() => undefined);
        if (!cancelled) {
          setToken(getCachedAccessToken() ?? accessToken);
          setUser(cachedUser);
        }
        return true;
      };
      try {
        const stored = await getStoredAccessToken();
        const cachedUser = await getCachedUser();

        // Démarrage instantané, comme Instagram : avec une session et un profil
        // déjà enregistrés sur l'appareil, l'app s'ouvre tout de suite. La
        // vérification serveur (`me`, puis `refresh` si besoin) continue en
        // arrière-plan ; seul un refus explicite du serveur déconnecte.
        if (stored && cachedUser) {
          await restoreOffline(stored, cachedUser);
          if (!cancelled) {
            setLoading(false);
          }
          void (async () => {
            try {
              const me = await api.me(stored);
              await storeCachedUser(me);
              if (!cancelled) {
                setToken(getCachedAccessToken() ?? stored);
                setUser(me);
              }
              return;
            } catch (error) {
              if (isTransientSessionError(error)) {
                return;
              }
            }
            const rt = await getStoredRefreshToken();
            if (!rt) {
              await clearStoredTokens();
              if (!cancelled) {
                setToken(null);
                setUser(null);
              }
              return;
            }
            try {
              const refreshed = await api.refresh(rt);
              await storeTokens(refreshed.accessToken, refreshed.refreshToken ?? rt);
              const me = await api.me(refreshed.accessToken);
              await storeCachedUser(me);
              if (!cancelled) {
                setToken(refreshed.accessToken);
                setUser(me);
              }
            } catch (refreshError) {
              if (isTransientSessionError(refreshError)) {
                return;
              }
              await clearStoredTokens();
              if (!cancelled) {
                setToken(null);
                setUser(null);
              }
            }
          })();
          return;
        }

        if (stored) {
          try {
            const me = await api.me(stored);
            await storeCachedUser(me);
            if (!cancelled) {
              await bindE2eeUser(me.id);
              await cache.prepareForUser(me.id);
              await hydrateFeedSnapshots(me.id);
              await hydrateDiscoverSnapshot(me.id);
              await activateLocalStore(me.id).catch(() => undefined);
              // `me` a pu rafraîchir le jeton : l'état doit garder le plus récent.
              setToken(getCachedAccessToken() ?? stored);
              setUser(me);
            }
          } catch (error) {
            if (isTransientSessionError(error) && (await restoreOffline(stored, cachedUser))) {
              return;
            }
            const rt = await getStoredRefreshToken();
            if (!rt) {
              if (isTransientSessionError(error) && (await restoreOffline(stored, cachedUser))) {
                return;
              }
              await clearStoredTokens();
              return;
            }
            try {
              const refreshed = await api.refresh(rt);
              await storeTokens(refreshed.accessToken, refreshed.refreshToken ?? rt);
              const me = await api.me(refreshed.accessToken);
              await storeCachedUser(me);
              if (!cancelled) {
                await bindE2eeUser(me.id);
                await cache.prepareForUser(me.id);
                await hydrateFeedSnapshots(me.id);
                await hydrateDiscoverSnapshot(me.id);
                await activateLocalStore(me.id).catch(() => undefined);
                setToken(refreshed.accessToken);
                setUser(me);
              }
            } catch (refreshError) {
              if (
                isTransientSessionError(refreshError) &&
                (await restoreOffline(stored, cachedUser))
              ) {
                return;
              }
              await clearStoredTokens();
            }
          }
        } else {
          const rt = await getStoredRefreshToken();
          if (!rt) {
            await clearStoredTokens();
            return;
          }
          try {
            const refreshed = await api.refresh(rt);
            await storeTokens(refreshed.accessToken, refreshed.refreshToken ?? rt);
            const me = await api.me(refreshed.accessToken);
            await storeCachedUser(me);
            if (!cancelled) {
              await bindE2eeUser(me.id);
              await cache.prepareForUser(me.id);
              await hydrateFeedSnapshots(me.id);
              await hydrateDiscoverSnapshot(me.id);
              await activateLocalStore(me.id).catch(() => undefined);
              setToken(refreshed.accessToken);
              setUser(me);
            }
          } catch (refreshError) {
            if (isTransientSessionError(refreshError)) {
              return;
            }
            await clearStoredTokens();
          }
        }
      } catch {
        // Le stockage sécurisé lui-même a échoué : ne pas détruire une session
        // potentiellement valide sur une erreur locale transitoire.
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      loading,
      signIn: async (newToken, newRefresh, newUser) => {
        await bindE2eeUser(newUser.id);
        await cache.prepareForUser(newUser.id);
        await hydrateFeedSnapshots(newUser.id);
        await hydrateDiscoverSnapshot(newUser.id);
        await activateLocalStore(newUser.id).catch(() => undefined);
        await storeTokens(newToken, newRefresh);
        await storeCachedUser(newUser);
        setToken(newToken);
        setUser(newUser);
        // Premier login : demande la permission puis associe l'appareil.
        if (newUser.notificationsEnabled) {
          void ensurePushRegistration(newToken, { requestPermission: true });
        }
      },
      setUser: (u: User) => {
        setUser(u);
        void storeCachedUser(u);
      },
      signOut: async () => {
        // Ne laisser derrière soi le jeton d'aucun appareil partagé.
        try {
          const pushToken = await getExistingPushToken();
          if (token && pushToken) {
            await api.removePushToken(token, pushToken);
          }
        } catch {
          // ignore : le logout ne doit pas être bloqué par le réseau
        }
        const rt = await getStoredRefreshToken();
        try {
          if (token) await api.logout(rt ?? undefined, token);
        } catch {
          // ignore
        }
        await announcePresenceLogout();
        await clearStoredTokens();
        disconnectSocket();
        setToken(null);
        setUser(null);
        setActiveE2eeUser(null);
        await closeE2eeDatabases();
        resetE2eeInitState();
        // Le cache et la file restent attachés à ce compte : une reconnexion du
        // même utilisateur retrouve son état. Au prochain compte, ils sont
        // nettoyés avant que son identité soit publiée à l'interface.
        await cache.flush();
        // Un clair de média lu par ce compte ne doit pas survivre à la
        // déconnexion, même si l'appareil reste allumé.
        sweepSecureMedia();
        void resetRecentEmoji();
        void resetEmojiFavorites();
        void resetStickerLibrary();
        // Brouillons de publication et fil enregistré : propres au compte, ils
        // ne doivent pas réapparaître pour une autre personne sur un appareil
        // partagé.
        if (user) {
          void purgeTextDrafts(user.id);
          void clearFeedSnapshots(user.id);
          void clearDiscoverSnapshot(user.id);
        }
      },
    }),
    [token, user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
