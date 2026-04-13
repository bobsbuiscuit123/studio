
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { usePathname } from 'next/navigation';
import { useCurrentUser } from '@/lib/current-user';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { safeFetchJson } from '@/lib/network';
import type { Member, Announcement, SocialPost, Presentation, GalleryImage, ClubEvent, Slide, Message, GroupChat, Transaction, PointEntry, MindMapData, ClubForm } from './mock-data';
import { getDefaultOrgState } from '@/lib/org-state';
import { useOptionalDemoCtx } from '@/lib/demo/DemoDataProvider';
import { getSelectedGroupId, getSelectedOrgId } from '@/lib/selection';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';
import { canEditGroupContent, canManageGroupRoles, displayGroupRole } from '@/lib/group-permissions';
import {
    isMessageFromActor,
    markMessageReadByActor,
    mergeGroupChatLists,
    mergeMessageMaps,
    messageIncludesReader,
    normalizeGroupChats,
    normalizeMessageMap,
} from '@/lib/message-state';
import { stableSerialize } from '@/lib/stable-serialize';
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
const normalizeViewedRoute = (value?: string | null) => {
    const rawValue = String(value ?? '').trim();
    if (!rawValue) return '';
    const [rawPath] = rawValue.split('?');
    let pathname = rawPath || '';
    if (pathname === '/demo/app') {
        pathname = '/dashboard';
    } else if (pathname.startsWith('/demo/app/')) {
        pathname = pathname.slice('/demo/app'.length) || '/dashboard';
    }
    const [firstSegment] = pathname.split('/').filter(Boolean);
    return firstSegment ? `/${firstSegment}` : '/dashboard';
};

const normalizeActivityActor = (value?: string | null) =>
    String(value ?? '').trim().toLowerCase();

const getActivityTimestamp = (value?: string | Date | null) => {
    if (!value) return 0;
    const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
};

const getRecordActivityTimestamp = (item: Record<string, unknown>) =>
    getActivityTimestamp(
        (item.created_at as string | undefined) ??
            (item.createdAt as string | undefined) ??
            (item.timestamp as string | undefined) ??
            (item.submittedAt as string | undefined) ??
            (item.date as string | Date | undefined)
    );

const viewedByCurrentUser = (viewedBy: string[] | undefined, userEmail: string) =>
    Array.isArray(viewedBy) &&
    viewedBy.some(email => normalizeActivityActor(email) === userEmail);
const groupStateCache = new Map<string, ClubData>();
const groupStateRequestCache = new Map<string, Promise<ClubData>>();
const currentUserRoleCache = new Map<string, { role: string | null; expiresAt: number }>();
const currentUserRoleRequestCache = new Map<string, Promise<string | null>>();
const CURRENT_USER_ROLE_CACHE_TTL_MS = 30_000;

const getGroupStateCacheKey = (orgId: string, groupId: string) => `${orgId}:${groupId}`;
const getCurrentUserRoleCacheKey = (groupId: string, userId: string) => `${groupId}:${userId}`;
const shouldRefreshOnVisibility = () =>
  typeof document !== 'undefined' &&
  document.visibilityState === 'visible' &&
  (typeof navigator === 'undefined' || navigator.onLine !== false);

const readCurrentUserRoleCache = (cacheKey: string) => {
  const cached = currentUserRoleCache.get(cacheKey);
  if (!cached) {
    return { hit: false, role: null as string | null };
  }
  if (cached.expiresAt <= Date.now()) {
    currentUserRoleCache.delete(cacheKey);
    return { hit: false, role: null as string | null };
  }
  return { hit: true, role: cached.role };
};

const persistCurrentUserRoleCache = (cacheKey: string, role: string | null) => {
  currentUserRoleCache.set(cacheKey, {
    role,
    expiresAt: Date.now() + CURRENT_USER_ROLE_CACHE_TTL_MS,
  });
  return role;
};

async function requestCurrentUserRole(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  groupId: string,
  userId: string
) {
  const cacheKey = getCurrentUserRoleCacheKey(groupId, userId);
  const cached = readCurrentUserRoleCache(cacheKey);
  if (cached.hit) {
    return cached.role;
  }

  const pending = currentUserRoleRequestCache.get(cacheKey);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    const { data } = await supabase
      .from('group_memberships')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .maybeSingle();
    return persistCurrentUserRoleCache(cacheKey, displayGroupRole(data?.role));
  })();

  currentUserRoleRequestCache.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (currentUserRoleRequestCache.get(cacheKey) === request) {
      currentUserRoleRequestCache.delete(cacheKey);
    }
  }
}

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

const reconcileClubData = (currentData: ClubData | null | undefined, incomingData: ClubData): ClubData => {
    const current = normalizeClubData(currentData ?? getDefaultClubData());
    const incoming = normalizeClubData(incomingData);

    return {
        ...current,
        ...incoming,
        messages: mergeMessageMaps(current.messages, incoming.messages),
        groupChats: mergeGroupChatLists(current.groupChats, incoming.groupChats),
    };
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
    cache: 'no-store',
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
  if (!options.forceFresh) {
    const pending = groupStateRequestCache.get(cacheKey);
    if (pending) {
      return pending;
    }
  }

  const request = (async () => {
    const performanceTimer = startPerformanceTimer('group state fetch', 1_000, {
      orgId,
      groupId,
      mode: options.forceFresh ? 'fresh' : 'cached-miss',
    });
    try {
      const normalized = await fetchGroupStateFromServer(orgId, groupId);
      const merged = reconcileClubData(groupStateCache.get(cacheKey), normalized);
      groupStateCache.set(cacheKey, merged);
      return merged;
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
  return requestGroupState(orgId, groupId, { forceFresh: true });
}

function useClubDataStore() {
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
    const [authReady, setAuthReady] = useState(() => useDemo || typeof window === 'undefined');
    const supabase = useMemo(() => (useDemo ? null : createSupabaseBrowserClient()), [useDemo]);

    useEffect(() => {
        if (useDemo || !supabase) {
            setAuthReady(true);
            return;
        }

        let active = true;
        setAuthReady(false);

        const hydrateAuth = async () => {
            try {
                await supabase.auth.getSession();
            } finally {
                if (active) {
                    setAuthReady(true);
                }
            }
        };

        void hydrateAuth();

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(() => {
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
                        if (prev && stableSerialize(prev) === stableSerialize(nextData)) {
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
                        if (prev && stableSerialize(prev) === stableSerialize(cached)) {
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
                if (prev && stableSerialize(prev) === stableSerialize(nextData)) {
                    return prev;
                }
                return nextData;
            });
            dispatchGroupStateSync(orgId, clubId);
            return true;
        } catch (error) {
            console.error(`Error refreshing data for group ${clubId}`, error);
            setError(error instanceof Error ? error.message : 'Group content could not be refreshed.');
            return false;
        }
    }, [authReady, clubId, orgId, supabase, useDemo]);

    const setLocalClubData = useCallback((nextDataOrUpdater: ClubData | ((baseData: ClubData) => ClubData)) => {
        if (!clubId || !orgId) return false;
        const cacheKey = getGroupStateCacheKey(orgId, clubId);
        const baseData = groupStateCache.get(cacheKey) ?? data ?? getDefaultClubData();
        const nextData =
            typeof nextDataOrUpdater === 'function'
                ? nextDataOrUpdater(baseData)
                : nextDataOrUpdater;
        const mergedData = reconcileClubData(baseData, nextData);
        setData(prev => {
            if (prev && stableSerialize(prev) === stableSerialize(mergedData)) {
                return prev;
            }
            return mergedData;
        });
        groupStateCache.set(cacheKey, mergedData);
        return true;
    }, [clubId, data, orgId]);

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
            const cacheKey = getGroupStateCacheKey(orgId, clubId);
            const currentData = groupStateCache.get(cacheKey) ?? data ?? getDefaultClubData();
            const optimisticData =
                options?.optimisticData ??
                (typeof nextDataOrUpdater === 'function'
                    ? nextDataOrUpdater(currentData)
                    : nextDataOrUpdater);
            if (stableSerialize(currentData) === stableSerialize(optimisticData)) {
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
            groupStateCache.set(getGroupStateCacheKey(orgId, clubId), optimisticData);

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
            if (stableSerialize(freshCurrentData) === stableSerialize(nextData)) {
                if (stableSerialize(optimisticData) !== stableSerialize(freshCurrentData)) {
                    setData(freshCurrentData);
                    groupStateCache.set(getGroupStateCacheKey(orgId, clubId), freshCurrentData);
                }
                return true;
            }

            const violation = findPolicyViolation(nextData);
            if (violation) {
                setData(freshCurrentData);
                groupStateCache.set(getGroupStateCacheKey(orgId, clubId), freshCurrentData);
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
                groupStateCache.set(getGroupStateCacheKey(orgId, clubId), freshCurrentData);
                setError(response.error.message || 'Group content could not be saved.');
                return false;
            }
            const confirmedData = normalizeClubData(response.data.data);
            setData(prev => {
                if (prev && stableSerialize(prev) === stableSerialize(confirmedData)) {
                    return prev;
                }
                return confirmedData;
            });
            groupStateCache.set(getGroupStateCacheKey(orgId, clubId), confirmedData);
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


function useSpecificClubData<K extends keyof ClubData>(key: K) {
    const { clubId, orgId, data, error, loading, updateClubData, refreshData, setLocalClubData } = useClubDataStore();

    const specificData = useMemo(() => {
        const defaults = getDefaultClubData();
        return data?.[key] ?? defaults[key];
    }, [data, key]);

    const updateDataAsync = useCallback(
        async (newData: ClubData[K] | ((prevData: ClubData[K]) => ClubData[K])) => {
            if (!clubId) return false;
            const base =
                orgId && clubId
                    ? groupStateCache.get(getGroupStateCacheKey(orgId, clubId)) ?? data ?? getDefaultClubData()
                    : data ?? getDefaultClubData();
            const valueToStore =
                typeof newData === 'function'
                    ? (newData as (prevData: ClubData[K]) => ClubData[K])(base[key])
                    : newData;
            if (stableSerialize(base[key]) === stableSerialize(valueToStore)) {
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
        [clubId, data, key, orgId, updateClubData]
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
            return setLocalClubData(base => {
                const currentValue = base[key];
                const valueToStore =
                    typeof newData === 'function'
                        ? (newData as (prevData: ClubData[K]) => ClubData[K])(currentValue)
                        : newData;
                if (stableSerialize(currentValue) === stableSerialize(valueToStore)) {
                    return base;
                }
                return { ...base, [key]: valueToStore };
            });
        },
        [clubId, key, setLocalClubData]
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
      if (stableSerialize(base) === stableSerialize(valueToStore)) {
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

export { useCurrentUser };

// Hook to get the current user's group role
export function useCurrentUserRole() {
    const pathname = usePathname();
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
        const groupId = getSelectedGroupId();
        if (!user?.email || !groupId) {
            setRole(null);
            setLoading(false);
            return;
        }
        const supabase = createSupabaseBrowserClient();
        let active = true;
        const loadRole = async () => {
            const { data: sessionData } = await supabase.auth.getSession();
            const userId = sessionData.session?.user?.id;
            if (!userId) {
                if (active) {
                    setRole(null);
                    setLoading(false);
                }
                return;
            }
            const nextRole = await requestCurrentUserRole(supabase, groupId, userId);
            if (active) {
                setRole(nextRole);
                setLoading(false);
            }
        };
        loadRole();
        return () => {
            active = false;
        };
    }, [demoCtx, pathname, useDemo, user?.email, userLoading]);

    const normalizedRole = role?.toLowerCase() ?? null;
    const canEdit = canEditGroupContent(normalizedRole);
    const canManage = canManageGroupRoles(normalizedRole);

    return { role, canEditContent: canEdit, canManageRoles: canManage, loading };
}

export type { NotificationKey } from '@/lib/notification-state';
type TabLastSeenState = Record<NotificationKey, string | null>;

const DEFAULT_TAB_LAST_SEEN: TabLastSeenState = {
    announcements: null,
    social: null,
    messages: null,
    calendar: null,
    gallery: null,
    attendance: null,
    forms: null,
};

export function hasUnseenActivity<T extends Record<string, unknown>>(
    _tab: NotificationKey,
    items: T[],
    lastSeenAt: string | null,
    getItemTimestamp: (item: T) => number = item => getRecordActivityTimestamp(item)
) {
    if (!Array.isArray(items) || items.length === 0) {
        return false;
    }

    const lastSeenTimestamp = getActivityTimestamp(lastSeenAt);
    return items.some(item => getItemTimestamp(item) > lastSeenTimestamp);
}

export type OrgAiQuotaStatus = {
    orgId: string;
    orgName: string;
    role: string;
    memberLimit: number;
    dailyAiLimitPerUser: number;
    activeUsers: number;
    requestsUsedToday: number;
    aiAvailability: 'available' | 'limited' | 'paused';
    estimatedMonthlyTokens: number;
    estimatedDailyTokens: number;
    tokenHealth: 'healthy' | 'low' | 'urgent' | 'depleted';
    tokenBalance?: number;
    estimatedDaysRemaining?: number;
    recentTokenActivity?: Array<{
        id: string;
        amount: number;
        type: string;
        description: string;
        metadata?: Record<string, unknown> | null;
        created_at: string;
    }>;
    createdAt: string | null;
    updatedAt: string | null;
};

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
    const pathname = usePathname();
    const { clubId, data, loading: clubDataLoading } = useClubDataStore();
    const { user, loading: userLoading } = useCurrentUser();
    const { role: membershipRole, loading: roleLoading } = useCurrentUserRole();
    const [tabLastSeenAt, setTabLastSeenAt] = useState<TabLastSeenState>(DEFAULT_TAB_LAST_SEEN);
    const [lastSeenLoaded, setLastSeenLoaded] = useState(false);
    const [groupSessionStartedAt, setGroupSessionStartedAt] = useState(0);
    const [groupSessionEntrySnapshot, setGroupSessionEntrySnapshot] = useState<GroupActivitySnapshot>(
        () => createEmptyGroupActivitySnapshot()
    );
    const [groupSessionReady, setGroupSessionReady] = useState(false);
    const [sessionViewedRoutes, setSessionViewedRoutes] = useState<string[]>([]);
    const selectedOrgId = getSelectedOrgId();
    const selectedGroupId = getSelectedGroupId();
    const lastGroupSessionResetAtRef = useRef(0);
    const markInFlightRef = useRef<Partial<Record<NotificationKey, boolean>>>({});
    const clubData = data ?? defaultClubData;
    const announcements = clubData.announcements;
    const socialPosts = clubData.socialPosts;
    const allMessages = clubData.messages;
    const groupChats = clubData.groupChats;
    const events = clubData.events;
    const galleryImages = clubData.galleryImages;
    const forms = clubData.forms;
    const members = clubData.members;

    const inferredRole = useMemo(() => getRoleFromMembers(members, user?.email), [members, user?.email]);
    const role = membershipRole ?? inferredRole;
    const loading = userLoading || clubDataLoading || roleLoading;

    const resetGroupSession = useCallback(() => {
        setGroupSessionStartedAt(0);
        setGroupSessionEntrySnapshot(createEmptyGroupActivitySnapshot());
        setGroupSessionReady(false);
        setSessionViewedRoutes([]);
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
            setTabLastSeenAt(DEFAULT_TAB_LAST_SEEN);
            setLastSeenLoaded(false);
            return;
        }

        let cancelled = false;
        setLastSeenLoaded(false);

        void safeFetchJson<{ ok: boolean; data?: { lastSeenByTab?: Partial<TabLastSeenState> } }>(
            `/api/tab-activity?orgId=${encodeURIComponent(selectedOrgId)}&groupId=${encodeURIComponent(selectedGroupId)}`,
            { retry: { retries: 1 } }
        ).then(result => {
            if (cancelled) {
                return;
            }

            setTabLastSeenAt({
                ...DEFAULT_TAB_LAST_SEEN,
                ...((result.ok && result.data?.data?.lastSeenByTab) || {}),
            });
            setLastSeenLoaded(true);
        });

        return () => {
            cancelled = true;
        };
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

    const activityByKey = useMemo<Record<NotificationKey, number>>(
        () =>
            getNotificationActivityByKey({
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
            }),
        [allMessages, announcements, events, forms, galleryImages, groupChats, loading, role, socialPosts, user]
    );

    const tabReadyByKey = useMemo<Record<NotificationKey, boolean>>(
        () => ({
            announcements: !loading,
            social: !loading,
            messages: !loading,
            calendar: !loading,
            gallery: !loading,
            forms: !loading,
            attendance: !loading,
        }),
        [loading]
    );

    const activeNotificationKey = useMemo<NotificationKey | null>(() => {
        const currentPath = pathname ?? '';
        const normalizedPath =
            currentPath === '/demo/app'
                ? '/dashboard'
                : currentPath.startsWith('/demo/app/')
                    ? currentPath.replace('/demo/app', '')
                    : currentPath;

        if (normalizedPath === '/announcements' || normalizedPath.startsWith('/announcements/')) return 'announcements';
        if (normalizedPath === '/messages' || normalizedPath.startsWith('/messages/')) return 'messages';
        if (normalizedPath === '/calendar' || normalizedPath.startsWith('/calendar/')) return 'calendar';
        if (normalizedPath === '/gallery' || normalizedPath.startsWith('/gallery/')) return 'gallery';
        if (normalizedPath === '/forms' || normalizedPath.startsWith('/forms/')) return 'forms';
        if (normalizedPath === '/attendance' || normalizedPath.startsWith('/attendance/')) return 'attendance';
        return null;
    }, [pathname]);

    const unread = useMemo(() => {
        if (loading || !user || !lastSeenLoaded) {
            return createEmptyUnreadNotifications();
        }

        return {
            announcements:
                tabReadyByKey.announcements &&
                activityByKey.announcements > getActivityTimestamp(tabLastSeenAt.announcements),
            social:
                tabReadyByKey.social &&
                activityByKey.social > getActivityTimestamp(tabLastSeenAt.social),
            messages:
                tabReadyByKey.messages &&
                activityByKey.messages > getActivityTimestamp(tabLastSeenAt.messages),
            calendar:
                tabReadyByKey.calendar &&
                activityByKey.calendar > getActivityTimestamp(tabLastSeenAt.calendar),
            gallery:
                tabReadyByKey.gallery &&
                activityByKey.gallery > getActivityTimestamp(tabLastSeenAt.gallery),
            forms:
                tabReadyByKey.forms &&
                activityByKey.forms > getActivityTimestamp(tabLastSeenAt.forms),
            attendance:
                role === 'Admin' &&
                tabReadyByKey.attendance &&
                activityByKey.attendance > getActivityTimestamp(tabLastSeenAt.attendance),
        };
    }, [activityByKey, lastSeenLoaded, loading, role, tabLastSeenAt, tabReadyByKey, user]);

    const markTabViewed = useCallback((key: NotificationKey | null, href?: string | null) => {
        const normalizedRoute = normalizeViewedRoute(href);
        if (normalizedRoute) {
            setSessionViewedRoutes(prev =>
                prev.includes(normalizedRoute) ? prev : [...prev, normalizedRoute]
            );
        }
        if (
            !key ||
            !user?.email ||
            !selectedOrgId ||
            !selectedGroupId ||
            !lastSeenLoaded ||
            !tabReadyByKey[key] ||
            markInFlightRef.current[key]
        ) {
            return;
        }

        markInFlightRef.current[key] = true;
        void safeFetchJson<{
            ok: boolean;
            data?: { lastSeenByTab?: Partial<TabLastSeenState> };
            lastSeenAt?: string;
        }>('/api/tab-activity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orgId: selectedOrgId,
                groupId: selectedGroupId,
                tab: key,
            }),
        }).then(result => {
            if (!result.ok || !result.data?.lastSeenAt) {
                return;
            }

            setTabLastSeenAt(prev => ({
                ...prev,
                ...(result.data?.data?.lastSeenByTab ?? {}),
                [key]: result.data?.lastSeenAt ?? prev[key],
            }));
        }).finally(() => {
            markInFlightRef.current[key] = false;
        });
    }, [lastSeenLoaded, selectedGroupId, selectedOrgId, tabReadyByKey, user?.email]);

    const markAllAsRead = useCallback((key: NotificationKey) => {
        markTabViewed(key);
    }, [markTabViewed]);

    useEffect(() => {
        if (!activeNotificationKey || !lastSeenLoaded || !tabReadyByKey[activeNotificationKey]) {
            return;
        }
        if (!unread[activeNotificationKey]) {
            return;
        }

        markTabViewed(activeNotificationKey, pathname);
    }, [activeNotificationKey, lastSeenLoaded, markTabViewed, pathname, tabReadyByKey, unread]);

    return {
        unread,
        loading: loading || !lastSeenLoaded,
        markAllAsRead,
        markTabViewed,
        role,
        sessionViewedRoutes,
        groupSessionStartedAt,
        groupSessionEntrySnapshot,
        groupSessionReady,
        tabLastSeenAt,
    };
}

