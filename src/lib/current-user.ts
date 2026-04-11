import { useCallback, useEffect, useState } from 'react';

import { useOptionalDemoCtx } from '@/lib/demo/DemoDataProvider';
import type { User } from '@/lib/mock-data';
import { safeFetchJson } from '@/lib/network';
import { getPlaceholderImageUrl } from '@/lib/placeholders';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { getAuthMetadataDisplayName, resolveStoredDisplayName } from '@/lib/user-display-name';

const DEMO_MODE_ENABLED = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
const CURRENT_USER_STORAGE_KEY = 'currentUser';

const isDemoRoute = () =>
  typeof window !== 'undefined' &&
  (window.location.pathname === '/demo' || window.location.pathname.startsWith('/demo/'));

const shouldUseDemoData = (hasDemoContext: boolean) =>
  DEMO_MODE_ENABLED && hasDemoContext && isDemoRoute();

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const getResolvedAvatar = (displayName: string, avatar?: string | null) =>
  isNonEmptyString(avatar)
    ? avatar
    : getPlaceholderImageUrl({ label: displayName.charAt(0) });

let currentUserCache: User | null = null;
let currentUserHydrationPromise: Promise<User | null> | null = null;

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

export function useCurrentUser() {
  const demoCtx = useOptionalDemoCtx();
  const useDemo = shouldUseDemoData(Boolean(demoCtx));
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    if (useDemo && demoCtx) {
      setUser(demoCtx.user);
      setLoading(false);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const hydrate = async () => {
      const storedUser = localStorage.getItem(CURRENT_USER_STORAGE_KEY);
      if (storedUser) {
        try {
          const parsedUser = JSON.parse(storedUser) as User;
          currentUserCache = parsedUser;
          setUser(parsedUser);
          setLoading(false);
        } catch {
          localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
        }
      } else if (currentUserCache) {
        setUser(currentUserCache);
        setLoading(false);
      }

      if (currentUserHydrationPromise) {
        const cachedUser = await currentUserHydrationPromise;
        setUser(cachedUser);
        setLoading(false);
        return;
      }

      currentUserHydrationPromise = (async () => {
        try {
          const { data } = await supabase.auth.getSession();
          const sessionUser = data.session?.user;
          if (sessionUser) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('email, display_name, avatar_url')
              .eq('id', sessionUser.id)
              .maybeSingle();
            const displayName = resolveStoredDisplayName({
              existingProfileName: profile?.display_name,
              authDisplayName: getAuthMetadataDisplayName(sessionUser),
              email: profile?.email || sessionUser.email || '',
            });
            const hydratedUser = {
              name: displayName,
              email: profile?.email || sessionUser.email || '',
              avatar: getResolvedAvatar(displayName, profile?.avatar_url),
            } as User;
            persistCurrentUserCache(hydratedUser);
            return hydratedUser;
          }
          persistCurrentUserCache(null);
          return null;
        } catch (error) {
          console.error('Error reading user from storage on init', error);
          return currentUserCache;
        }
      })();

      try {
        const hydratedUser = await currentUserHydrationPromise;
        setUser(hydratedUser);
      } finally {
        currentUserHydrationPromise = null;
        setLoading(false);
      }
    };

    void hydrate();
  }, [demoCtx, useDemo]);

  const setLocalUser = useCallback(
    (nextUser: User | null) => {
      if (useDemo) {
        setUser(nextUser);
        return;
      }
      setUser(nextUser);
      persistCurrentUserCache(nextUser);
    },
    [useDemo]
  );

  useEffect(() => {
    if (!useDemo || !demoCtx) return;
    setUser(demoCtx.user);
    setLoading(false);
  }, [demoCtx, useDemo]);

  const saveUser = useCallback(
    async (newUser: Partial<User> | ((currentUser: User | null) => User)) => {
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
      return;
    }
    setUser(null);
    persistCurrentUserCache(null);
  }, [useDemo]);

  return { user: isMounted ? user : null, loading, saveUser, clearUser, setLocalUser };
}
