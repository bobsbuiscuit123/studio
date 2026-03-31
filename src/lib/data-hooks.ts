'use client';

import { createContext, createElement, useState, useEffect, useCallback, useMemo, useRef, useContext, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { safeFetchJson } from '@/lib/network';
import type { Member, User, Announcement, SocialPost, Presentation, GalleryImage, ClubEvent, Slide, Message, GroupChat, Transaction, PointEntry, MindMapData, ClubForm } from './mock-data';
import { getDefaultOrgState } from '@/lib/org-state';
import { useOptionalDemoCtx } from '@/lib/demo/DemoDataProvider';
import { getSelectedGroupId, getSelectedOrgId } from '@/lib/selection';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';
import { canEditGroupContent, canManageGroupRoles, displayGroupRole } from '@/lib/group-permissions';
import {
    isMessageFromActor,
    markMessageReadByActor,
    messageIncludesReader,
    normalizeGroupChats,
    normalizeMessageMap,
} from '@/lib/message-state';
import { getPlaceholderImageUrl } from '@/lib/placeholders';
import {
    createEmptyGroupActivitySnapshot,
    createEmptyNotificationActivity,
    createEmptyUnreadNotifications,
    createGroupActivitySnapshot,
    getNotificationActivityByKey,
    getRoleFromMembers,
    getUnreadNotifications,
    type GroupActivitySnapshot,
    type NotificationKey,
} from '@/lib/notification-state';
import { startPerformanceTimer } from '@/lib/performance-guard';

type ClubData = {
    members: Member[];
    events: ClubEvent[];
    announcements: Announcement[];
    socialPosts: SocialPost[];
    transactions: Transaction[];
    messages: {[key: string]: Message[]};
    groupChats: GroupChat[];
    galleryImages: GalleryImage[];
    pointEntries: PointEntry[];
    presentations: Presentation[];
    forms: ClubForm[];
    logo: string;
    mindmap: MindMapData;
};

type MemberProfileRow = {
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

const DEMO_MODE_ENABLED = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
const isDemoRoute = () =>
  typeof window !== 'undefined' &&
  (window.location.pathname === '/demo' || window.location.pathname.startsWith('/demo/'));
const shouldUseDemoData = (hasDemoContext: boolean) =>
  DEMO_MODE_ENABLED && hasDemoContext && isDemoRoute();

const getDefaultClubData = (): ClubData => getDefaultOrgState();
const TAB_VIEW_KEY = 'tabLastViewed';
const serializedValueCache = new WeakMap<object, string>();
const stableSerialize = (value: unknown): string => {
    if (value instanceof Date) {
        return `Date(${value.toISOString()})`;
    }
    if (Array.isArray(value)) {
        const cached = serializedValueCache.get(value);
        if (cached) {
            return cached;
        }
        const serialized = `[${value.map(item => stableSerialize(item)).join(',')}]`;
        serializedValueCache.set(value, serialized);
        return serialized;
    }
    if (value && typeof value === 'object') {
        const objectValue = value as Record<string, unknown>;
        const cached = serializedValueCache.get(objectValue);
        if (cached) {
            return cached;
        }
        const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b)
        );
        const serialized = `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(',')}}`;
        serializedValueCache.set(objectValue, serialized);
        return serialized;
    }
    return JSON.stringify(value);
};
const isSerializedEqual = (left: unknown, right: unknown) => stableSerialize(left) === stableSerialize(right);

const getTabViewStorageKey = (userEmail: string, orgId: string, groupId: string, key: NotificationKey) =>
    `${TAB_VIEW_KEY}:${userEmail}:${orgId}:${groupId}:${key}`;

const readTabLastViewed = (userEmail: string, orgId: string, groupId: string, key: NotificationKey) => {
    if (typeof window === 'undefined') return 0;
    const raw = localStorage.getItem(getTabViewStorageKey(userEmail, orgId, groupId, key));
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
};

const writeTabLastViewed = (userEmail: string, orgId: string, groupId: string, key: NotificationKey, value: number) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(getTabViewStorageKey(userEmail, orgId, groupId, key), String(value));
};

const groupStateCache = new Map<string, ClubData>();
const groupStateRequestCache = new Map<string, Promise<ClubData>>();
const groupStateLoadedAt = new Map<string, number>();
let currentUserCache: User | null = null;
let currentUserHydrationPromise: Promise<User | null> | null = null;
const CURRENT_USER_STORAGE_KEY = 'currentUser';
const GROUP_STATE_REFRESH_COOLDOWN_MS = 1_500;
let clubDataAuthReady = false;
let clubDataAuthReadyPromise: Promise<void> | null = null;
const roleCache = new Map<string, string | null>();
const roleRequestCache = new Map<string, Promise<string | null>>();

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const getResolvedAvatar = (displayName: string, avatar?: string | null) =>
  isNonEmptyString(avatar)
    ? avatar
    : getPlaceholderImageUrl({ label: displayName.charAt(0) });

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

const getGroupStateCacheKey = (orgId: string, groupId: string) => `${orgId}:${groupId}`;
const getRoleCacheKey = (orgId: string, groupId: string, userEmail: string) =>
  `${orgId}:${groupId}:${userEmail.toLowerCase()}`;
const shouldRefreshOnVisibility = () =>
  typeof document !== 'undefined' &&
  document.visibilityState === 'visible' &&
  (typeof navigator === 'undefined' || navigator.onLine !== false);

const setCachedGroupState = (orgId: string, groupId: string, nextData: ClubData) => {
  const cacheKey = getGroupStateCacheKey(orgId, groupId);
  groupStateCache.set(cacheKey, nextData);
  groupStateLoadedAt.set(cacheKey, Date.now());
};

const ensureClubDataAuthReady = async (supabase: ReturnType<typeof createSupabaseBrowserClient>) => {
  if (clubDataAuthReady) {
    return;
  }
  if (!clubDataAuthReadyPromise) {
    clubDataAuthReadyPromise = supabase.auth
      .getSession()
      .catch((error: unknown) => {
        console.error('Error hydrating auth session for club data store', error);
      })
      .then(() => {
        clubDataAuthReady = true;
      })
      .finally(() => {
        clubDataAuthReadyPromise = null;
      });
  }
  await clubDataAuthReadyPromise;
};

const normalizeClubData = (data: ClubData): ClubData => {
    const defaults = getDefaultClubData();
    const source = data && typeof data === 'object' ? data : defaults;
    const normalized = {
        ...defaults,
        ...source,
        messages: normalizeMessageMap(source.messages),
        groupChats: normalizeGroupChats(source.groupChats),
        mindmap: source.mindmap ?? defaults.mindmap,
    };
    if (Array.isArray(normalized.events)) {
        normalized.events = normalized.events.map((event: any) => ({
            ...event,
            date: new Date(event.date),
        }));
    }
    if (Array.isArray(normalized.galleryImages)) {
        normalized.galleryImages = normalized.galleryImages.map((image: any) => ({
            ...image,
            status: 'approved' as const,
        }));
    }
    return normalized;
};

type GroupStateDeletionMap = Partial<
  Record<'announcements' | 'events' | 'galleryImages', string[]>
>;

const getRecordId = (value: unknown) => {
  if (!value || typeof value !== 'object') return '';
  const idValue = (value as { id?: unknown }).id;
  return typeof idValue === 'string' || typeof idValue === 'number' ? String(idValue) : '';
};

const collectDeletedIds = (currentValue: unknown, nextValue: unknown) => {
  if (!Array.isArray(currentValue) || !Array.isArray(nextValue)) {
    return [];
  }

  const nextIds = new Set(nextValue.map(getRecordId).filter(Boolean));
  return currentValue
    .map(getRecordId)
    .filter((id): id is string => Boolean(id) && !nextIds.has(id));
};

type GroupStateSyncDetail = {
  orgId: string;
  groupId: string;
};

const dispatchGroupStateSync = (orgId: string, groupId: string) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<GroupStateSyncDetail>('group-state-sync', {
      detail: { orgId, groupId },
    })
  );
};

type GroupStateResponse = { ok: true; data: ClubData };

async function fetchGroupStateFromServer(orgId: string, groupId: string) {
  const params = new URLSearchParams({ orgId, groupId });
  const response = await safeFetchJson<GroupStateResponse>(`/api/org-state?${params.toString()}`, {
    method: 'GET',
    timeoutMs: 10_000,
    retry: { retries: 1 },
  });
  if (!response.ok) {
    throw new Error(response.error.message || 'Group content could not be loaded.');
  }

  return normalizeClubData(response.data.data);
}

async function requestGroupState(
  orgId: string,
  groupId: string,
  options: { forceFresh?: boolean } = {}
) {
  const cacheKey = getGroupStateCacheKey(orgId, groupId);
  const pending = groupStateRequestCache.get(cacheKey);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    const performanceTimer = startPerformanceTimer('group state fetch', 1_000, {
      orgId,
      groupId,
      mode: options.forceFresh ? 'fresh' : 'cached-miss',
    });
    try {
      const normalized = await fetchGroupStateFromServer(orgId, groupId);
      setCachedGroupState(orgId, groupId, normalized);
      return normalized;
    } finally {
      performanceTimer.stop();
    }
  })();

  groupStateRequestCache.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (groupStateRequestCache.get(cacheKey) === request) {
      groupStateRequestCache.delete(cacheKey);
    }
  }
}

async function loadGroupState(orgId: string, groupId: string) {
  const cacheKey = getGroupStateCacheKey(orgId, groupId);
  const cached = groupStateCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  return requestGroupState(orgId, groupId);
}

async function fetchFreshGroupState(orgId: string, groupId: string) {
  const cacheKey = getGroupStateCacheKey(orgId, groupId);
  const cached = groupStateCache.get(cacheKey);
  const loadedAt = groupStateLoadedAt.get(cacheKey) ?? 0;
  if (cached && Date.now() - loadedAt < GROUP_STATE_REFRESH_COOLDOWN_MS) {
    return cached;
  }
  return requestGroupState(orgId, groupId, { forceFresh: true });
}

function useClubDataStoreInternal() {
    const demoCtx = useOptionalDemoCtx();
    const useDemo = shouldUseDemoData(Boolean(demoCtx));
    const [clubId, setClubId] = useState<string | null>(() =>
        useDemo || typeof window === 'undefined' ? null : getSelectedGroupId()
    );
    const [orgId, setOrgId] = useState<string | null>(() =>
        useDemo || typeof window === 'undefined' ? null : getSelectedOrgId()
    );
    const [data, setData] = useState<ClubData | null>(() => {
        if (useDemo || typeof window === 'undefined') {
            return null;
        }
        const initialOrgId = getSelectedOrgId();
        const initialClubId = getSelectedGroupId();
        if (!initialOrgId || !initialClubId) {
            return null;
        }
        return groupStateCache.get(getGroupStateCacheKey(initialOrgId, initialClubId)) ?? null;
    });
    const [loading, setLoading] = useState(() => {
        if (useDemo || typeof window === 'undefined') {
            return true;
        }
        const initialOrgId = getSelectedOrgId();
        const initialClubId = getSelectedGroupId();
        if (!initialOrgId || !initialClubId) {
            return false;
        }
        return !groupStateCache.has(getGroupStateCacheKey(initialOrgId, initialClubId));
    });
    const [error, setError] = useState<string | null>(null);
    const [authReady, setAuthReady] = useState(() => useDemo || typeof window === 'undefined' || clubDataAuthReady);
    const supabase = useMemo(() => (useDemo ? null : createSupabaseBrowserClient()), [useDemo]);

    useEffect(() => {
        if (useDemo || !supabase) {
            setAuthReady(true);
            return;
        }

        let active = true;
        if (clubDataAuthReady) {
            setAuthReady(true);
            return;
        }
        setAuthReady(false);

        const hydrateAuth = async () => {
            await ensureClubDataAuthReady(supabase);
            if (active) {
                setAuthReady(true);
            }
        };

        void hydrateAuth();

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(() => {
            clubDataAuthReady = true;
            if (active) {
                setAuthReady(true);
            }
        });

        return () => {
            active = false;
            subscription.unsubscribe();
        };
    }, [supabase, useDemo]);

    useEffect(() => {
        if (useDemo) return;
        if (typeof window === 'undefined') return;
        setClubId(getSelectedGroupId());
        setOrgId(getSelectedOrgId());
    }, [useDemo]);

    useEffect(() => {
        if (useDemo || !supabase) {
            setLoading(false);
            setError(null);
            return;
        }
        if (!clubId || !orgId) {
            setData(null);
            setLoading(false);
            setError(null);
            return;
        }
        if (!authReady) {
            setLoading(true);
            return;
        }
        const load = async () => {
            const cacheKey = getGroupStateCacheKey(orgId, clubId);
            const cached = groupStateCache.get(cacheKey);
            if (cached) {
                setData(cached);
                setLoading(false);
                setError(null);
                return;
            }
            setData(null);
            setLoading(true);
            try {
                const nextData = await loadGroupState(orgId, clubId);
                setData(nextData);
                setError(null);
            } catch (error) {
                console.error(`Error loading data for group ${clubId}`, error);
                setError(error instanceof Error ? error.message : 'Group content could not be loaded.');
            }
            setLoading(false);
        };
        load();
    }, [authReady, clubId, orgId, supabase, useDemo]);

    useEffect(() => {
        if (useDemo || !supabase || !clubId || !orgId || typeof window === 'undefined' || !authReady) {
            return;
        }

        let cancelled = false;
        const refreshFromBackend = async () => {
            if (!shouldRefreshOnVisibility()) return;
            try {
                const nextData = await fetchFreshGroupState(orgId, clubId);
                if (!cancelled) {
                    setError(null);
                    setData(prev => {
                        if (prev && isSerializedEqual(prev, nextData)) {
                            return prev;
                        }
                        return nextData;
                    });
                }
            } catch (error) {
                console.error(`Error refreshing data for group ${clubId}`, error);
                if (!cancelled) {
                    setError(error instanceof Error ? error.message : 'Group content could not be refreshed.');
                }
            }
        };

        const handleVisibilityChange = () => {
            void refreshFromBackend();
        };
        const handleGroupStateSync = (event: Event) => {
            const syncEvent = event as CustomEvent<GroupStateSyncDetail>;
            const detail = syncEvent.detail;
            if (detail?.orgId && detail?.groupId) {
                const eventCacheKey = getGroupStateCacheKey(detail.orgId, detail.groupId);
                const currentCacheKey = getGroupStateCacheKey(orgId, clubId);
                if (eventCacheKey !== currentCacheKey) {
                    return;
                }
                const cached = groupStateCache.get(currentCacheKey);
                if (cached) {
                    setError(null);
                    setData(prev => {
                        if (prev && isSerializedEqual(prev, cached)) {
                            return prev;
                        }
                        return cached;
                    });
                    return;
                }
            }
            void refreshFromBackend();
        };

        window.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', handleVisibilityChange);
        window.addEventListener('online', handleVisibilityChange);
        window.addEventListener('group-state-sync', handleGroupStateSync);

        return () => {
            cancelled = true;
            window.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleVisibilityChange);
            window.removeEventListener('online', handleVisibilityChange);
            window.removeEventListener('group-state-sync', handleGroupStateSync);
        };
    }, [authReady, clubId, orgId, supabase, useDemo]);

    const refreshData = useCallback(async () => {
        if (useDemo || !supabase || !clubId || !orgId || !authReady) return false;
        try {
            const nextData = await fetchFreshGroupState(orgId, clubId);
            setError(null);
            setData(prev => {
                if (prev && isSerializedEqual(prev, nextData)) {
                    return prev;
                }
                return nextData;
            });
            return true;
        } catch (error) {
            console.error(`Error refreshing data for group ${clubId}`, error);
            setError(error instanceof Error ? error.message : 'Group content could not be refreshed.');
            return false;
        }
    }, [authReady, clubId, orgId, supabase, useDemo]);

    const setLocalClubData = useCallback((nextData: ClubData) => {
        if (!clubId || !orgId) return false;
        setData(nextData);
        setCachedGroupState(orgId, clubId, nextData);
        return true;
    }, [clubId, orgId]);

    const updateClubData = useCallback(
        async (
            nextDataOrUpdater: ClubData | ((baseData: ClubData) => ClubData),
            options?: {
                deletedIds?: GroupStateDeletionMap;
                optimisticData?: ClubData;
            }
        ) => {
            if (useDemo && demoCtx) {
                const resolvedData =
                    typeof nextDataOrUpdater === 'function'
                        ? nextDataOrUpdater(data ?? getDefaultClubData())
                        : nextDataOrUpdater;
                demoCtx.updateClubData(resolvedData);
                return true;
            }
            if (!clubId || !orgId || !supabase) return false;
            const currentData = data ?? getDefaultClubData();
            const optimisticData =
                options?.optimisticData ??
                (typeof nextDataOrUpdater === 'function'
                    ? nextDataOrUpdater(currentData)
                    : nextDataOrUpdater);
            if (isSerializedEqual(currentData, optimisticData)) {
                return true;
            }
            const optimisticViolation = findPolicyViolation(optimisticData);
            if (optimisticViolation) {
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                        new CustomEvent('policy-violation', {
                            detail: { message: policyErrorMessage },
                        })
                    );
                }
                return false;
            }

            setData(optimisticData);
            setCachedGroupState(orgId, clubId, optimisticData);

            let freshCurrentData = currentData;
            try {
                freshCurrentData = await fetchFreshGroupState(orgId, clubId);
                setError(null);
            } catch (error) {
                console.error(`Error refreshing latest data for group ${clubId} before save`, error);
            }

            const nextData =
                typeof nextDataOrUpdater === 'function'
                    ? nextDataOrUpdater(freshCurrentData)
                    : nextDataOrUpdater;
            if (isSerializedEqual(freshCurrentData, nextData)) {
                if (!isSerializedEqual(optimisticData, freshCurrentData)) {
                    setData(freshCurrentData);
                    setCachedGroupState(orgId, clubId, freshCurrentData);
                }
                return true;
            }

            const violation = findPolicyViolation(nextData);
            if (violation) {
                setData(freshCurrentData);
                setCachedGroupState(orgId, clubId, freshCurrentData);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                        new CustomEvent('policy-violation', {
                            detail: { message: policyErrorMessage },
                        })
                    );
                }
                return false;
            }
            const response = await safeFetchJson<GroupStateResponse>('/api/org-state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orgId,
                    groupId: clubId,
                    data: nextData,
                    deletedIds: options?.deletedIds,
                }),
                timeoutMs: 10_000,
                retry: { retries: 1 },
            });
            if (!response.ok) {
                console.error(`Error saving data for group ${clubId}`, response.error);
                setData(freshCurrentData);
                setCachedGroupState(orgId, clubId, freshCurrentData);
                setError(response.error.message || 'Group content could not be saved.');
                return false;
            }
            const confirmedData = normalizeClubData(response.data.data);
            setData(prev => {
                if (prev && isSerializedEqual(prev, confirmedData)) {
                    return prev;
                }
                return confirmedData;
            });
            setCachedGroupState(orgId, clubId, confirmedData);
            setError(null);
            dispatchGroupStateSync(orgId, clubId);
            return true;
        },
        [clubId, data, demoCtx, orgId, supabase, useDemo]
    );

    if (useDemo && demoCtx) {
        return {
            clubId: demoCtx.clubId,
            data: demoCtx.clubData as ClubData,
            error: null,
            loading: false,
            updateClubData,
            refreshData,
            setLocalClubData,
        };
    }

    return { clubId, orgId, data, error, loading, updateClubData, refreshData, setLocalClubData };
}

type ClubDataStoreValue = ReturnType<typeof useClubDataStoreInternal>;

const ClubDataStoreContext = createContext<ClubDataStoreValue | null>(null);

export function ClubDataStoreProvider({ children }: { children: ReactNode }) {
    const store = useClubDataStoreInternal();
    return createElement(ClubDataStoreContext.Provider, { value: store }, children);
}

function useClubDataStore() {
    const context = useContext(ClubDataStoreContext);
    if (!context) {
        throw new Error('useClubDataStore must be used within ClubDataStoreProvider');
    }
    return context;
}


function useSpecificClubData<K extends keyof ClubData>(key: K) {
    const { clubId, orgId, data, error, loading, updateClubData, refreshData, setLocalClubData } = useClubDataStore();

    const specificData = useMemo(() => {
        const defaults = getDefaultClubData();
        return data?.[key] ?? defaults[key];
    }, [data, key]);

    const updateDataAsync = useCallback(
        async (newData: ClubData[K] | ((prevData: ClubData[K]) => ClubData[K])) => {
            if (!clubId) return false;
            const base = data ?? getDefaultClubData();
            const valueToStore =
                typeof newData === 'function'
                    ? (newData as (prevData: ClubData[K]) => ClubData[K])(base[key])
                    : newData;
            if (isSerializedEqual(base[key], valueToStore)) {
                return true;
            }
            const updatedFullData = { ...base, [key]: valueToStore };
            const deletedIds =
                key === 'announcements' || key === 'events' || key === 'galleryImages'
                    ? collectDeletedIds(base[key], valueToStore)
                    : [];
            return updateClubData(
                freshBase => {
                    const nextValue =
                        typeof newData === 'function'
                            ? (newData as (prevData: ClubData[K]) => ClubData[K])(freshBase[key])
                            : valueToStore;
                    return { ...freshBase, [key]: nextValue };
                },
                {
                    optimisticData: updatedFullData,
                    deletedIds:
                        deletedIds.length > 0
                            ? { [key]: deletedIds }
                            : undefined,
                }
            );
        },
        [clubId, data, key, updateClubData]
    );

    const updateData = useCallback(
        (newData: ClubData[K] | ((prevData: ClubData[K]) => ClubData[K])) => {
            void updateDataAsync(newData);
        },
        [updateDataAsync]
    );

    const setLocalData = useCallback(
        (newData: ClubData[K] | ((prevData: ClubData[K]) => ClubData[K])) => {
            if (!clubId) return false;
            const base = data ?? getDefaultClubData();
            const valueToStore =
                typeof newData === 'function'
                    ? (newData as (prevData: ClubData[K]) => ClubData[K])(base[key])
                    : newData;
            if (isSerializedEqual(base[key], valueToStore)) {
                return true;
            }
            const updatedFullData = { ...base, [key]: valueToStore };
            return setLocalClubData(updatedFullData);
        },
        [clubId, data, key, setLocalClubData]
    );

    return { data: specificData as ClubData[K], error, loading, updateData, updateDataAsync, setLocalData, refreshData, clubId, orgId };
}


export function useAnnouncements() {
  return useSpecificClubData('announcements');
}

export function useEvents() {
    return useSpecificClubData('events');
}

export function useMembers() {
  const { clubId, orgId, data, loading, updateClubData } = useClubDataStore();
  const demoCtx = useOptionalDemoCtx();
  const useDemo = shouldUseDemoData(Boolean(demoCtx));
  const supabase = useMemo(() => (useDemo ? null : createSupabaseBrowserClient()), [useDemo]);
  const [membersData, setMembersData] = useState<Member[]>(() => {
    const defaults = getDefaultClubData();
    return data?.members ?? defaults.members;
  });
  const [membersLoading, setMembersLoading] = useState(() =>
    useDemo ? loading : loading && !(data?.members && data.members.length >= 0)
  );

  useEffect(() => {
    if (useDemo) {
      setMembersData(data?.members ?? getDefaultClubData().members);
      setMembersLoading(loading);
      return;
    }
    if (!clubId || !orgId) {
      setMembersData(data?.members ?? getDefaultClubData().members);
      setMembersLoading(loading);
      return;
    }

    let active = true;
    const loadMembers = async () => {
      const stateMembers = Array.isArray(data?.members) ? data.members : [];
      if (stateMembers.length > 0) {
        setMembersData(stateMembers);
        setMembersLoading(false);
      } else {
        setMembersLoading(true);
      }
      const response = await safeFetchJson<{ ok: boolean; data?: { members?: Member[] } }>(
        `/api/groups/members?orgId=${encodeURIComponent(orgId)}&groupId=${encodeURIComponent(clubId)}`
      );
      if (!active) return;
      if (!response.ok || !response.data?.data?.members) {
        console.error(`Error loading group memberships for ${clubId}`, response.ok ? response.data : response.error);
        setMembersData(stateMembers);
        setMembersLoading(false);
        return;
      }

      const nextMembers: Member[] = response.data.data.members;
      const memberEmails = nextMembers
        .map(member => member.email)
        .filter((email): email is string => Boolean(email));

      let nextMembersWithProfiles = nextMembers;

      if (supabase && memberEmails.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('email, display_name, avatar_url')
          .in('email', memberEmails);

        if (profilesError) {
          console.error(`Error loading member profiles for ${clubId}`, profilesError);
        } else if (profiles) {
          const profileRows = profiles as MemberProfileRow[];
          const profileByEmail = new Map(
            profileRows
              .filter(profile => profile.email)
              .map(profile => [profile.email as string, profile])
          );

          nextMembersWithProfiles = nextMembers.map(member => {
            const profile = profileByEmail.get(member.email);
            return {
              ...member,
              name: profile?.display_name || member.name,
              avatar: profile?.avatar_url || member.avatar,
            };
          });
        }
      }

      setMembersData(nextMembersWithProfiles);
      setMembersLoading(false);
    };

    void loadMembers();
    return () => {
      active = false;
    };
  }, [clubId, data?.members, loading, orgId, supabase, useDemo]);

  const updateData = useCallback(
    (newData: Member[] | ((prevData: Member[]) => Member[])) => {
      const base = Array.isArray(data?.members) ? data.members : getDefaultClubData().members;
      const valueToStore =
        typeof newData === 'function'
          ? (newData as (prevData: Member[]) => Member[])(base)
          : newData;
      if (isSerializedEqual(base, valueToStore)) {
        return;
      }
      setMembersData(valueToStore);
      const nextFullData = { ...(data ?? getDefaultClubData()), members: valueToStore };
      void updateClubData(
        freshBase => ({
          ...freshBase,
          members:
            typeof newData === 'function'
              ? (newData as (prevData: Member[]) => Member[])(Array.isArray(freshBase.members) ? freshBase.members : [])
              : valueToStore,
        }),
        { optimisticData: nextFullData }
      );
    },
    [data, updateClubData]
  );

  return { data: membersData, loading: membersLoading, updateData, clubId, orgId };
}

export function useSocialPosts() {
  return useSpecificClubData('socialPosts');
}

export function useTransactions() {
  return useSpecificClubData('transactions');
}

export function usePresentations() {
    return useSpecificClubData('presentations');
}

export function useForms() {
    return useSpecificClubData('forms');
}

export function useGalleryImages() {
    return useSpecificClubData('galleryImages');
}

export function useMessages() {
    return useSpecificClubData('messages');
}

export function useGroupChats() {
    return useSpecificClubData('groupChats');
}

export function usePointEntries() {
  return useSpecificClubData('pointEntries');
}

export function useMindMapData() {
    return useSpecificClubData('mindmap');
}


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
          const displayName =
            profile?.display_name ||
            (sessionUser.user_metadata?.display_name as string | undefined) ||
            sessionUser.email ||
            'Member';
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

  const setLocalUser = useCallback((nextUser: User | null) => {
    if (useDemo) {
      setUser(nextUser);
      return;
    }
    setUser(nextUser);
    persistCurrentUserCache(nextUser);
  }, [useDemo]);

  useEffect(() => {
    if (!useDemo || !demoCtx) return;
    setUser(demoCtx.user);
    setLoading(false);
  }, [demoCtx, useDemo]);

  const saveUser = useCallback(async (newUser: Partial<User> | ((currentUser: User | null) => User)) => {
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
  }, [demoCtx, useDemo, user]);
  
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


// Hook to get the current user's group role
export function useCurrentUserRole() {
    const demoCtx = useOptionalDemoCtx();
    const useDemo = shouldUseDemoData(Boolean(demoCtx));
    const { user, loading: userLoading } = useCurrentUser();
    const [role, setRole] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (userLoading) return;
        if (useDemo && demoCtx) {
            setRole(demoCtx.appRole);
            setLoading(false);
            return;
        }
        const orgId = getSelectedOrgId();
        const groupId = getSelectedGroupId();
        if (!user?.email || !orgId || !groupId) {
            setRole(null);
            setLoading(false);
            return;
        }
        const roleCacheKey = getRoleCacheKey(orgId, groupId, user.email);
        const cachedGroupData = groupStateCache.get(getGroupStateCacheKey(orgId, groupId));
        const inferredRole = getRoleFromMembers(cachedGroupData?.members ?? [], user.email);
        if (inferredRole) {
            roleCache.set(roleCacheKey, inferredRole);
            setRole(inferredRole);
            setLoading(false);
            return;
        }
        if (roleCache.has(roleCacheKey)) {
            setRole(roleCache.get(roleCacheKey) ?? null);
            setLoading(false);
            return;
        }
        const supabase = createSupabaseBrowserClient();
        let active = true;
        const loadRole = async () => {
            const existingRequest = roleRequestCache.get(roleCacheKey);
            const roleRequest =
                existingRequest ??
                (async () => {
                    const { data: authUser } = await supabase.auth.getUser();
                    const userId = authUser.user?.id;
                    if (!userId) {
                        roleCache.set(roleCacheKey, null);
                        return null;
                    }
                    const { data } = await supabase
                        .from('group_memberships')
                        .select('role')
                        .eq('group_id', groupId)
                        .eq('user_id', userId)
                        .maybeSingle();
                    const resolvedRole = displayGroupRole(data?.role);
                    roleCache.set(roleCacheKey, resolvedRole);
                    return resolvedRole;
                })();

            roleRequestCache.set(roleCacheKey, roleRequest);
            const resolvedRole = await roleRequest.finally(() => {
                if (roleRequestCache.get(roleCacheKey) === roleRequest) {
                    roleRequestCache.delete(roleCacheKey);
                }
            });
            if (active) {
                setRole(resolvedRole);
                setLoading(false);
            }
        };
        loadRole();
        return () => {
            active = false;
        };
    }, [demoCtx, useDemo, user?.email, userLoading]);

    const normalizedRole = role?.toLowerCase() ?? null;
    const canEdit = canEditGroupContent(normalizedRole);
    const canManage = canManageGroupRoles(normalizedRole);

    return { role, canEditContent: canEdit, canManageRoles: canManage, loading };
}

export type { NotificationKey } from '@/lib/notification-state';

export const notifyOrgAiUsageChanged = (
    orgId?: string | null,
    delta: number = 0
) => {
    if (typeof window === 'undefined') return;
    const detail = {
        orgId: orgId ?? getSelectedOrgId() ?? null,
        delta,
    };
    window.dispatchEvent(new CustomEvent('org-ai-usage-changed', { detail }));
    window.dispatchEvent(new CustomEvent('org-subscription-changed', { detail }));
};


export function useNotifications() {
    const defaultClubData = useMemo(() => getDefaultClubData(), []);
    // This provider lives in the shared app layout, so it must reuse one store instance.
    const { clubId, data, loading: clubDataLoading, updateClubData } = useClubDataStore();
    const { user, loading: userLoading } = useCurrentUser();
    const { role: membershipRole, loading: roleLoading } = useCurrentUserRole();
    const [tabLastViewed, setTabLastViewed] = useState<Record<NotificationKey, number>>({
        ...createEmptyNotificationActivity(),
    });
    const [groupSessionStartedAt, setGroupSessionStartedAt] = useState(0);
    const [groupSessionEntrySnapshot, setGroupSessionEntrySnapshot] = useState<GroupActivitySnapshot>(
        () => createEmptyGroupActivitySnapshot()
    );
    const [groupSessionReady, setGroupSessionReady] = useState(false);
    const selectedOrgId = getSelectedOrgId();
    const selectedGroupId = getSelectedGroupId();
    const lastGroupSessionResetAtRef = useRef(0);
    const clubData = data ?? defaultClubData;
    const announcements = clubData.announcements;
    const socialPosts = clubData.socialPosts;
    const allMessages = clubData.messages;
    const groupChats = clubData.groupChats;
    const events = clubData.events;
    const galleryImages = clubData.galleryImages;
    const forms = clubData.forms;
    const members = clubData.members;

    const inferredRole = useMemo(() => {
        return getRoleFromMembers(members, user?.email);
    }, [members, user?.email]);
    const role = membershipRole ?? inferredRole;

    const loading = userLoading || clubDataLoading || roleLoading;

    const resetGroupSession = useCallback(() => {
        setGroupSessionStartedAt(0);
        setGroupSessionEntrySnapshot(createEmptyGroupActivitySnapshot());
        setGroupSessionReady(false);
    }, []);

    const beginGroupSession = useCallback(() => {
        if (!user?.email || !selectedOrgId || !selectedGroupId) {
            resetGroupSession();
            return;
        }
        const now = Date.now();
        if (now - lastGroupSessionResetAtRef.current < 150) {
            return;
        }
        lastGroupSessionResetAtRef.current = now;
        setGroupSessionStartedAt(now);
        setGroupSessionEntrySnapshot(createEmptyGroupActivitySnapshot());
        setGroupSessionReady(false);
    }, [resetGroupSession, selectedGroupId, selectedOrgId, user?.email]);

    useEffect(() => {
        if (!user?.email || !selectedOrgId || !selectedGroupId) {
            setTabLastViewed({
                ...createEmptyNotificationActivity(),
            });
            return;
        }
        setTabLastViewed({
            announcements: readTabLastViewed(user.email, selectedOrgId, selectedGroupId, 'announcements'),
            social: readTabLastViewed(user.email, selectedOrgId, selectedGroupId, 'social'),
            messages: readTabLastViewed(user.email, selectedOrgId, selectedGroupId, 'messages'),
            calendar: readTabLastViewed(user.email, selectedOrgId, selectedGroupId, 'calendar'),
            gallery: readTabLastViewed(user.email, selectedOrgId, selectedGroupId, 'gallery'),
            attendance: readTabLastViewed(user.email, selectedOrgId, selectedGroupId, 'attendance'),
            forms: readTabLastViewed(user.email, selectedOrgId, selectedGroupId, 'forms'),
        });
    }, [selectedGroupId, selectedOrgId, user?.email]);

    useEffect(() => {
        if (!user?.email || !selectedOrgId || !selectedGroupId) {
            resetGroupSession();
            return;
        }
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
            return;
        }
        beginGroupSession();
    }, [beginGroupSession, resetGroupSession, selectedGroupId, selectedOrgId, user?.email]);

    useEffect(() => {
        if (!user?.email || !selectedOrgId || !selectedGroupId) {
            resetGroupSession();
            return;
        }
        if (loading || clubId !== selectedGroupId || !groupSessionStartedAt || groupSessionReady) {
            return;
        }
        setGroupSessionEntrySnapshot(
            createGroupActivitySnapshot({
                members,
                events,
            })
        );
        setGroupSessionReady(true);
    }, [
        clubId,
        events,
        groupSessionReady,
        groupSessionStartedAt,
        loading,
        members,
        resetGroupSession,
        selectedGroupId,
        selectedOrgId,
        user?.email,
    ]);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return;
        }

        const handleVisible = () => {
            if (document.visibilityState === 'visible') {
                beginGroupSession();
            }
        };

        let disposed = false;
        const listenerRemovers: Array<() => Promise<void>> = [];

        document.addEventListener('visibilitychange', handleVisible);
        window.addEventListener('pageshow', handleVisible);

        if (Capacitor.isNativePlatform()) {
            void App.addListener('appStateChange', ({ isActive }) => {
                if (isActive) {
                    beginGroupSession();
                }
            }).then(handle => {
                if (disposed) {
                    void handle.remove();
                    return;
                }
                listenerRemovers.push(() => handle.remove());
            });

            void App.addListener('resume', () => {
                beginGroupSession();
            }).then(handle => {
                if (disposed) {
                    void handle.remove();
                    return;
                }
                listenerRemovers.push(() => handle.remove());
            });
        }

        return () => {
            disposed = true;
            document.removeEventListener('visibilitychange', handleVisible);
            window.removeEventListener('pageshow', handleVisible);
            listenerRemovers.forEach(removeListener => {
                void removeListener();
            });
        };
    }, [beginGroupSession]);

    const activityByKey = useMemo<Record<NotificationKey, number>>(() => {
        return getNotificationActivityByKey({
            announcements,
            socialPosts,
            allMessages,
            groupChats,
            events,
            galleryImages,
            forms,
            user,
            role,
            loading,
        });
    }, [loading, user, announcements, socialPosts, allMessages, groupChats, events, galleryImages, role, forms]);

    const unread = useMemo(() => {
        return getUnreadNotifications({
            activityByKey,
            tabLastViewed,
            loading,
            user,
            role,
        });
    }, [activityByKey, loading, role, tabLastViewed, user]);
    
    const markAllAsRead = useCallback((key: NotificationKey) => {
        if (!user?.email) return;
        const userEmail = user.email;
        void updateClubData(prev => {
            switch (key) {
                case 'announcements':
                    return {
                        ...prev,
                        announcements: prev.announcements.map(item => ({ ...item, read: true })),
                    };
                case 'social':
                    return {
                        ...prev,
                        socialPosts: prev.socialPosts.map(item => ({ ...item, read: true })),
                    };
                case 'messages':
                    return {
                        ...prev,
                        messages: Object.fromEntries(
                            Object.entries(normalizeMessageMap(prev.messages)).map(([convoId, messages]) => [
                                convoId,
                                messages.map(msg => markMessageReadByActor(msg, userEmail)),
                            ])
                        ),
                        groupChats: normalizeGroupChats(prev.groupChats).map(chat => ({
                            ...chat,
                            messages: chat.messages.map(msg => markMessageReadByActor(msg, userEmail)),
                        })),
                    };
                case 'calendar':
                    return {
                        ...prev,
                        events: prev.events.map(item => ({ ...item, read: true })),
                    };
                case 'gallery':
                    return {
                        ...prev,
                        galleryImages: prev.galleryImages.map(item => ({ ...item, read: true })),
                    };
                case 'forms':
                    return {
                        ...prev,
                        forms: prev.forms.map(item => {
                            const viewedBy = Array.isArray(item.viewedBy) ? item.viewedBy : [];
                            return viewedBy.includes(userEmail)
                                ? item
                                : { ...item, viewedBy: [...viewedBy, userEmail] };
                        }),
                    };
                case 'attendance':
                    return {
                        ...prev,
                        events: prev.events.map(item => ({
                            ...item,
                            lastViewedAttendees: item.attendees?.length || 0,
                        })),
                    };
                default:
                    return prev;
            }
        });
    }, [updateClubData, user?.email]);

    const markTabViewed = useCallback((key: NotificationKey) => {
        if (!user?.email || !selectedOrgId || !selectedGroupId) return;
        const nextValue = activityByKey[key];
        writeTabLastViewed(user.email, selectedOrgId, selectedGroupId, key, nextValue);
        setTabLastViewed(prev => ({ ...prev, [key]: nextValue }));
    }, [activityByKey, selectedGroupId, selectedOrgId, user?.email]);

    return {
        unread,
        loading,
        markAllAsRead,
        markTabViewed,
        role,
        groupSessionStartedAt,
        groupSessionEntrySnapshot,
        groupSessionReady,
    };
}
