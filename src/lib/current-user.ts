"use client";

import {
  createElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthChangeEvent } from '@supabase/supabase-js';

import {
  createDashboardLogger,
  createDashboardRequestId,
  DASHBOARD_RETRY_DELAYS_MS,
  DASHBOARD_TIMEOUT_MS,
  type DashboardAsyncStatus,
  retryWithBackoff,
} from '@/lib/dashboard-load';
import { useOptionalDemoCtx } from '@/lib/demo/DemoDataProvider';
import type { User } from '@/lib/mock-data';
import { safeFetchJson } from '@/lib/network';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const DEMO_MODE_ENABLED = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
const CURRENT_USER_STORAGE_KEY = 'currentUser';

const isDemoRoute = () =>
  typeof window !== 'undefined' &&
  (window.location.pathname === '/demo' || window.location.pathname.startsWith('/demo/'));

const shouldUseDemoData = (hasDemoContext: boolean) =>
  DEMO_MODE_ENABLED && hasDemoContext && isDemoRoute();

type SaveUserInput = Partial<User> | ((currentUser: User | null) => User);
type CurrentUserStatus = DashboardAsyncStatus;
type CurrentUserResponse = { ok: true; data: User | null };

type CurrentUserContextValue = {
  user: User | null;
  status: CurrentUserStatus;
  error: string | null;
  loading: boolean;
  retry: () => Promise<boolean>;
  saveUser: (newUser: SaveUserInput) => Promise<void>;
  clearUser: () => void;
  setLocalUser: (nextUser: User | null) => void;
};

let currentUserCache: User | null = null;

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);
const logger = createDashboardLogger();

const persistCurrentUserCache = (nextUser: User | null) => {
  currentUserCache = nextUser;
  if (typeof window === 'undefined') return;
  if (!nextUser) {
    localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    return;
  }
  try {
    localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(nextUser));
  } catch (error) {
    console.error('Failed to cache current user locally', error);
  }
};

const readStoredCurrentUser = () => {
  if (currentUserCache) {
    return currentUserCache;
  }
  if (typeof window === 'undefined') {
    return null;
  }

  const storedUser = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY);
  if (!storedUser) {
    return null;
  }

  try {
    const parsedUser = JSON.parse(storedUser) as User;
    currentUserCache = parsedUser;
    return parsedUser;
  } catch {
    window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    return null;
  }
};

function useCurrentUserState(): CurrentUserContextValue {
  const demoCtx = useOptionalDemoCtx();
  const useDemo = shouldUseDemoData(Boolean(demoCtx));
  const initialStoredUser = useDemo && demoCtx ? demoCtx.user : readStoredCurrentUser();
  const [user, setUser] = useState<User | null>(() => initialStoredUser);
  const [status, setStatus] = useState<CurrentUserStatus>(() => {
    if (useDemo && demoCtx) {
      return 'success';
    }
    return initialStoredUser ? 'success' : 'loading';
  });
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const activeAbortRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const userRef = useRef<User | null>(initialStoredUser);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const hydrateCurrentUser = useCallback(
    async ({
      reason,
      forceBlocking,
    }: {
      reason: 'initial' | 'auth-change' | 'manual-retry';
      forceBlocking?: boolean;
    }) => {
      if (useDemo && demoCtx) {
        setUser(demoCtx.user);
        setStatus('success');
        setError(null);
        return true;
      }

      const cachedUser = readStoredCurrentUser();
      const nextRequestId = createDashboardRequestId('profile');
      const controller = new AbortController();
      activeAbortRef.current?.abort();
      activeAbortRef.current = controller;
      activeRequestIdRef.current = nextRequestId;

      const hasCachedUser = Boolean(cachedUser ?? userRef.current ?? currentUserCache);
      setError(null);
      setStatus(forceBlocking || !hasCachedUser ? 'loading' : 'retrying');
      if (cachedUser) {
        setUser(cachedUser);
      }

      logger.log('Current user load start', {
        requestId: nextRequestId,
        reason,
        hasCachedUser,
      });

      try {
        const hydratedUser = await retryWithBackoff<User | null>(
          async (attempt) => {
            logger.log('Current user fetch start', {
              requestId: nextRequestId,
              reason,
              attempt: attempt + 1,
            });

            const response = await safeFetchJson<CurrentUserResponse>('/api/profile', {
              method: 'GET',
              cache: 'no-store',
              timeoutMs: DASHBOARD_TIMEOUT_MS,
              retry: { retries: 0 },
              signal: controller.signal,
              requestId: nextRequestId,
            });

            if (!response.ok) {
              logger.error('Current user fetch failed', response.error, {
                requestId: nextRequestId,
                reason,
                attempt: attempt + 1,
              });
              throw new Error(response.error.message || 'Current user could not be loaded.');
            }

            logger.log('Current user fetch success', {
              requestId: nextRequestId,
              reason,
              attempt: attempt + 1,
              hasUser: Boolean(response.data.data),
            });

            return response.data.data ?? null;
          },
          {
            retries: DASHBOARD_RETRY_DELAYS_MS.length,
            delaysMs: DASHBOARD_RETRY_DELAYS_MS,
            label: 'Current user fetch',
            logger,
            requestId: nextRequestId,
          }
        );

        if (activeRequestIdRef.current !== nextRequestId || controller.signal.aborted) {
          logger.warn('Current user response ignored as stale', {
            requestId: nextRequestId,
            reason,
          });
          return false;
        }

        if (hydratedUser) {
          persistCurrentUserCache(hydratedUser);
          setUser(hydratedUser);
          setStatus('success');
          setError(null);
        } else {
          persistCurrentUserCache(null);
          setUser(null);
          setStatus('empty');
          setError(null);
        }

        logger.log('Current user load resolved', {
          requestId: nextRequestId,
          reason,
          status: hydratedUser ? 'success' : 'empty',
        });

        return true;
      } catch (loadError) {
        if (controller.signal.aborted || activeRequestIdRef.current !== nextRequestId) {
          logger.warn('Current user load aborted', {
            requestId: nextRequestId,
            reason,
          });
          return false;
        }

        const message =
          loadError instanceof Error && loadError.message
            ? loadError.message
            : 'Current user could not be loaded.';

        logger.error('Current user load failed', loadError, {
          requestId: nextRequestId,
          reason,
        });

        setError(message);
        setUser(prevUser => prevUser ?? cachedUser ?? currentUserCache);
        setStatus('error');
        return false;
      } finally {
        if (activeRequestIdRef.current === nextRequestId) {
          activeAbortRef.current = null;
        }
      }
    },
    [demoCtx, useDemo]
  );

  useEffect(() => {
    setIsMounted(true);
    if (useDemo && demoCtx) {
      setUser(demoCtx.user);
      setStatus('success');
      setError(null);
      return;
    }

    void hydrateCurrentUser({
      reason: 'initial',
      forceBlocking: !readStoredCurrentUser(),
    });

    return () => {
      activeAbortRef.current?.abort();
    };
  }, [demoCtx, hydrateCurrentUser, useDemo]);

  const setLocalUser = useCallback(
    (nextUser: User | null) => {
      if (useDemo) {
        setUser(nextUser);
        setStatus(nextUser ? 'success' : 'empty');
        setError(null);
        return;
      }
      setUser(nextUser);
      persistCurrentUserCache(nextUser);
      setStatus(nextUser ? 'success' : 'empty');
      setError(null);
    },
    [useDemo]
  );

  useEffect(() => {
    if (!useDemo || !demoCtx) return;
    setUser(demoCtx.user);
    setStatus('success');
    setError(null);
  }, [demoCtx, useDemo]);

  useEffect(() => {
    if (useDemo) {
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
      logger.log('Current user auth state change', { event });
      if (event === 'SIGNED_OUT') {
        persistCurrentUserCache(null);
        setUser(null);
        setStatus('empty');
        setError(null);
        return;
      }
      void hydrateCurrentUser({
        reason: 'auth-change',
        forceBlocking: !readStoredCurrentUser(),
      });
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [hydrateCurrentUser, useDemo]);

  const saveUser = useCallback(
    async (newUser: SaveUserInput) => {
      if (useDemo && demoCtx) {
        demoCtx.updateUser(currentUser =>
          typeof newUser === 'function'
            ? (newUser as (currentUser: User | null) => User)(currentUser)
            : ({ ...(currentUser || {}), ...newUser } as User)
        );
        return;
      }

      const previousUser = user;
      const updatedUser =
        typeof newUser === 'function'
          ? (newUser as (currentUser: User | null) => User)(user)
          : ({ ...(user || {}), ...newUser } as User);
      persistCurrentUserCache(updatedUser);
      setUser(updatedUser);
      const response = await safeFetchJson<{ ok: boolean; data?: User }>('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: updatedUser.name,
          avatar: updatedUser.avatar,
        }),
      });
      if (response.ok && response.data?.data) {
        persistCurrentUserCache(response.data.data);
        setUser(response.data.data);
        setStatus('success');
        setError(null);
        return;
      }
      console.error('Failed to persist profile', response.ok ? response.data : response.error);
      persistCurrentUserCache(previousUser);
      setUser(previousUser);
      throw new Error(response.ok ? 'Failed to persist profile.' : response.error.message);
    },
    [demoCtx, useDemo, user]
  );

  const clearUser = useCallback(() => {
    if (useDemo) {
      setUser(null);
      setStatus('empty');
      setError(null);
      return;
    }
    setUser(null);
    persistCurrentUserCache(null);
    setStatus('empty');
    setError(null);
  }, [useDemo]);

  const retry = useCallback(async () => {
    return hydrateCurrentUser({ reason: 'manual-retry', forceBlocking: !readStoredCurrentUser() });
  }, [hydrateCurrentUser]);

  return {
    user: isMounted ? user : null,
    status,
    error,
    loading: status === 'loading',
    retry,
    saveUser,
    clearUser,
    setLocalUser,
  };
}

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const value = useCurrentUserState();

  return createElement(CurrentUserContext.Provider, { value }, children);
}

export function useCurrentUser() {
  const context = useContext(CurrentUserContext);
  if (!context) {
    throw new Error('useCurrentUser must be used within CurrentUserProvider.');
  }
  return context;
}
