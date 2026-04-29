
import {
    createElement,
    createContext,
    useState,
    useEffect,
    useCallback,
    useContext,
    useMemo,
    useRef,
    type ReactNode,
} from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { usePathname } from 'next/navigation';
import { useCurrentUser } from '@/lib/current-user';
import {
    createDashboardLogger,
    createDashboardRequestId,
    DASHBOARD_RETRY_DELAYS_MS,
    DASHBOARD_WATCHDOG_MS,
    type DashboardAsyncStatus,
    retryWithBackoff,
} from '@/lib/dashboard-load';
import {
    createSupabaseBrowserClient,
    getBrowserSessionWithTimeout,
} from '@/lib/supabase/client';
import { safeFetchJson } from '@/lib/network';
import type { Member, Announcement, SocialPost, Presentation, GalleryImage, ClubEvent, Slide, Message, GroupChat, Transaction, PointEntry, MindMapData, ClubForm } from './mock-data';
import { getDefaultOrgState } from '@/lib/org-state';
import { useOptionalDemoCtx } from '@/lib/demo/DemoDataProvider';
import { getSelectedGroupId, getSelectedOrgId } from '@/lib/selection';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';
import { canEditGroupContent, canManageGroupRoles } from '@/lib/group-permissions';
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
type ClubDataStatus = DashboardAsyncStatus;

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
const groupStateFetchedAtCache = new Map<string, number>();
const groupStateIncludesMediaCache = new Map<string, boolean>();
const GROUP_STATE_REFRESH_TTL_MS = 5 * 60_000;
const clubDataLogger = createDashboardLogger();

const getGroupStateCacheKey = (orgId: string, groupId: string) => `${orgId}:${groupId}`;
const routeNeedsMedia = (pathname?: string | null) => {
  const value = pathname ?? '';
  return (
    value === '/gallery' ||
    value.startsWith('/gallery/') ||
    value === '/social' ||
    value.startsWith('/social/') ||
    value.startsWith('/demo/app/gallery') ||
    value.startsWith('/demo/app/social')
  );
};
const shouldRefreshOnVisibility = () =>
  typeof document !== 'undefined' &&
  document.visibilityState === 'visible' &&
  (typeof navigator === 'undefined' || navigator.onLine !== false);

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

type GroupStateResponse = { ok: true; data: ClubData | null };
type GroupStatePatch = {
    path: Array<string | number>;
    value: unknown;
};
type GroupStatePatchResponse = { ok: true; data: null };

const patchableArrayFields: Record<string, Set<string>> = {
    announcements: new Set(['read', 'viewedBy']),
    events: new Set(['attendanceRecords', 'attendees', 'lastViewedAttendees', 'read', 'rsvps', 'viewedBy']),
    forms: new Set(['responses', 'viewedBy']),
    galleryImages: new Set(['liked', 'likedBy', 'likes', 'read', 'viewedBy']),
    socialPosts: new Set(['comments', 'liked', 'likedBy', 'likes', 'read', 'viewedBy']),
};

const buildAtomicArrayPatches = (
    sectionKey: string,
    currentValue: unknown,
    nextValue: unknown
): GroupStatePatch[] => {
    const allowedFields = patchableArrayFields[sectionKey];
    if (!allowedFields || !Array.isArray(currentValue) || !Array.isArray(nextValue)) {
        return [];
    }
    if (currentValue.length !== nextValue.length) {
        return [];
    }

    const patches: GroupStatePatch[] = [];
    for (let index = 0; index < currentValue.length; index += 1) {
        const currentItem = currentValue[index];
        const nextItem = nextValue[index];
        if (!currentItem || !nextItem || typeof currentItem !== 'object' || typeof nextItem !== 'object') {
            if (stableSerialize(currentItem) !== stableSerialize(nextItem)) {
                return [];
            }
            continue;
        }

        const currentRecord = currentItem as Record<string, unknown>;
        const nextRecord = nextItem as Record<string, unknown>;
        if (getRecordId(currentRecord) !== getRecordId(nextRecord)) {
            return [];
        }

        const fields = new Set([...Object.keys(currentRecord), ...Object.keys(nextRecord)]);
        for (const field of fields) {
            if (stableSerialize(currentRecord[field]) === stableSerialize(nextRecord[field])) {
                continue;
            }
            if (!allowedFields.has(field)) {
                return [];
            }
            patches.push({
                path: [sectionKey, index, field],
                value: nextRecord[field] ?? null,
            });
        }
    }

    return patches.length <= 100 ? patches : [];
};

type ClubDataStoreValue = {
    clubId: string | null;
    orgId: string | null;
    data: ClubData | null;
    error: string | null;
    status: ClubDataStatus;
    loading: boolean;
    attempt: number;
    startedAt: number | null;
    lastSuccessAt: number | null;
    requestId: string | null;
    updateClubData: (
        nextDataOrUpdater: ClubData | ((baseData: ClubData) => ClubData),
        options?: {
            deletedIds?: GroupStateDeletionMap;
            optimisticData?: ClubData;
            patches?: GroupStatePatch[];
        }
    ) => Promise<boolean>;
    refreshData: () => Promise<boolean>;
    retry: () => Promise<boolean>;
    setLocalClubData: (
        nextDataOrUpdater: ClubData | ((baseData: ClubData) => ClubData),
        options?: {
            reconcile?: boolean;
        }
    ) => boolean;
};

const ClubDataContext = createContext<ClubDataStoreValue | null>(null);

const summarizeClubData = (data: ClubData | null | undefined) => ({
    announcements: Array.isArray(data?.announcements) ? data.announcements.length : 0,
    events: Array.isArray(data?.events) ? data.events.length : 0,
    forms: Array.isArray(data?.forms) ? data.forms.length : 0,
    galleryImages: Array.isArray(data?.galleryImages) ? data.galleryImages.length : 0,
    groupChats: Array.isArray(data?.groupChats) ? data.groupChats.length : 0,
    members: Array.isArray(data?.members) ? data.members.length : 0,
    pointEntries: Array.isArray(data?.pointEntries) ? data.pointEntries.length : 0,
    socialPosts: Array.isArray(data?.socialPosts) ? data.socialPosts.length : 0,
    transactions: Array.isArray(data?.transactions) ? data.transactions.length : 0,
});

async function fetchGroupStateFromServer(
  orgId: string,
  groupId: string,
  options: { includeMedia?: boolean; signal?: AbortSignal; requestId?: string | null } = {}
) {
  const params = new URLSearchParams({ orgId, groupId });
  if (options.includeMedia) {
    params.set('media', '1');
  }
  clubDataLogger.log('Fetch group state start', {
    groupId,
    includeMedia: Boolean(options.includeMedia),
    orgId,
    requestId: options.requestId ?? null,
  });
  const response = await safeFetchJson<GroupStateResponse>(`/api/org-state?${params.toString()}`, {
    method: 'GET',
    cache: 'no-store',
    timeoutMs: 8_000,
    retry: { retries: 0 },
    requestId: options.requestId ?? undefined,
    signal: options.signal,
  });
  if (!response.ok) {
    clubDataLogger.error('Fetch group state failed', response.error, {
      groupId,
      includeMedia: Boolean(options.includeMedia),
      orgId,
      requestId: options.requestId ?? null,
    });
    throw new Error(response.error.message || 'Group content could not be loaded.');
  }
  if (!response.data.data) {
    clubDataLogger.warn('Fetch group state returned empty payload', {
      groupId,
      includeMedia: Boolean(options.includeMedia),
      orgId,
      requestId: options.requestId ?? null,
    });
    throw new Error('Group content response was empty.');
  }

  const normalized = normalizeClubData(response.data.data);
  clubDataLogger.log('Fetch group state success', {
    groupId,
    includeMedia: Boolean(options.includeMedia),
    orgId,
    requestId: options.requestId ?? null,
    summary: summarizeClubData(normalized),
  });

  return normalized;
}

async function requestGroupState(
  orgId: string,
  groupId: string,
  options: {
    forceFresh?: boolean;
    bypassCache?: boolean;
    includeMedia?: boolean;
    signal?: AbortSignal;
    requestId?: string | null;
  } = {}
) {
  const cacheKey = getGroupStateCacheKey(orgId, groupId);
  const requestCacheKey = `${cacheKey}:${options.includeMedia ? 'media' : 'lite'}`;
  const cached = groupStateCache.get(cacheKey);
  const cachedIncludesMedia = groupStateIncludesMediaCache.get(cacheKey) === true;
  const cacheSatisfiesMedia = !options.includeMedia || cachedIncludesMedia;
  const fetchedAt = groupStateFetchedAtCache.get(cacheKey) ?? 0;
  const cacheAge = Date.now() - fetchedAt;
  if (
    cached &&
    cacheSatisfiesMedia &&
    (
      !options.forceFresh ||
      (!options.bypassCache && cacheAge < GROUP_STATE_REFRESH_TTL_MS)
    )
  ) {
    return cached;
  }

  const canReusePendingRequest = !options.forceFresh && !options.signal;

  if (canReusePendingRequest) {
    const pending = groupStateRequestCache.get(requestCacheKey);
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
      const normalized = await fetchGroupStateFromServer(orgId, groupId, {
        includeMedia: options.includeMedia,
        requestId: options.requestId,
        signal: options.signal,
      });
      const merged = reconcileClubData(groupStateCache.get(cacheKey), normalized);
      groupStateCache.set(cacheKey, merged);
      groupStateFetchedAtCache.set(cacheKey, Date.now());
      groupStateIncludesMediaCache.set(cacheKey, cachedIncludesMedia || Boolean(options.includeMedia));
      return merged;
    } finally {
      performanceTimer.stop();
    }
  })();

  if (canReusePendingRequest) {
    groupStateRequestCache.set(requestCacheKey, request);
  }
  try {
    return await request;
  } finally {
    if (canReusePendingRequest && groupStateRequestCache.get(requestCacheKey) === request) {
      groupStateRequestCache.delete(requestCacheKey);
    }
  }
}

async function loadGroupState(
  orgId: string,
  groupId: string,
  options: { includeMedia?: boolean; signal?: AbortSignal; requestId?: string | null } = {}
) {
  const cacheKey = getGroupStateCacheKey(orgId, groupId);
  const cached = groupStateCache.get(cacheKey);
  const cachedIncludesMedia = groupStateIncludesMediaCache.get(cacheKey) === true;
  if (cached && (!options.includeMedia || cachedIncludesMedia)) {
    return cached;
  }

  return requestGroupState(orgId, groupId, options);
}

async function fetchFreshGroupState(
  orgId: string,
  groupId: string,
  options: {
    includeMedia?: boolean;
    bypassCache?: boolean;
    signal?: AbortSignal;
    requestId?: string | null;
  } = {}
) {
  return requestGroupState(orgId, groupId, { forceFresh: true, ...options });
}

function useClubDataStoreState(): ClubDataStoreValue {
    const pathname = usePathname();
    const demoCtx = useOptionalDemoCtx();
    const useDemo = shouldUseDemoData(Boolean(demoCtx));
    const includeMedia = routeNeedsMedia(pathname);
    const initialOrgId = useDemo || typeof window === 'undefined' ? null : getSelectedOrgId();
    const initialClubId = useDemo || typeof window === 'undefined' ? null : getSelectedGroupId();
    const initialCacheKey =
        initialOrgId && initialClubId ? getGroupStateCacheKey(initialOrgId, initialClubId) : null;
    const initialCachedData = initialCacheKey ? groupStateCache.get(initialCacheKey) ?? null : null;
    const initialHasSelection = Boolean(initialOrgId && initialClubId);
    const initialHasUsableCache = Boolean(
        initialCachedData &&
            (!includeMedia || groupStateIncludesMediaCache.get(initialCacheKey ?? '') === true)
    );

    const [clubId, setClubId] = useState<string | null>(initialClubId);
    const [orgId, setOrgId] = useState<string | null>(initialOrgId);
    const [data, setData] = useState<ClubData | null>(() => {
        if (useDemo && demoCtx) {
            return demoCtx.clubData as ClubData;
        }
        return initialCachedData;
    });
    const [status, setStatus] = useState<ClubDataStatus>(() => {
        if (useDemo && demoCtx) {
            return 'success';
        }
        if (!initialHasSelection) {
            return 'empty';
        }
        return initialHasUsableCache ? 'success' : 'loading';
    });
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [startedAt, setStartedAt] = useState<number | null>(
        initialHasSelection && !initialHasUsableCache ? Date.now() : null
    );
    const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(
        initialHasUsableCache ? Date.now() : null
    );
    const [requestId, setRequestId] = useState<string | null>(null);
    const [authReady, setAuthReady] = useState(() => useDemo || typeof window === 'undefined');
    const supabase = useMemo(() => (useDemo ? null : createSupabaseBrowserClient()), [useDemo]);
    const activeAbortRef = useRef<AbortController | null>(null);
    const activeRequestIdRef = useRef<string | null>(null);
    const statusRef = useRef<ClubDataStatus>(status);
    const dataRef = useRef<ClubData | null>(data);

    useEffect(() => {
        statusRef.current = status;
    }, [status]);

    useEffect(() => {
        dataRef.current = data;
    }, [data]);

    useEffect(() => {
        if (useDemo || !supabase) {
            setAuthReady(true);
            return;
        }

        let active = true;
        setAuthReady(false);

        const hydrateAuth = async () => {
            try {
                await getBrowserSessionWithTimeout(supabase);
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
        const syncSelection = () => {
            setClubId(getSelectedGroupId());
            setOrgId(getSelectedOrgId());
        };
        syncSelection();
        window.addEventListener('storage', syncSelection);
        window.addEventListener('focus', syncSelection);
        window.addEventListener('popstate', syncSelection);
        return () => {
            window.removeEventListener('storage', syncSelection);
            window.removeEventListener('focus', syncSelection);
            window.removeEventListener('popstate', syncSelection);
        };
    }, [useDemo]);

    const runLoad = useCallback(
        async ({
            reason,
            forceFresh = false,
            bypassCache = false,
            keepStaleData = false,
        }: {
            reason: 'initial' | 'visibility' | 'sync' | 'manual-retry';
            forceFresh?: boolean;
            bypassCache?: boolean;
            keepStaleData?: boolean;
        }) => {
            if (useDemo && demoCtx) {
                setData(demoCtx.clubData as ClubData);
                setStatus('success');
                setError(null);
                setAttempt(0);
                setStartedAt(null);
                setLastSuccessAt(Date.now());
                return true;
            }

            if (!clubId || !orgId) {
                activeAbortRef.current?.abort();
                activeAbortRef.current = null;
                activeRequestIdRef.current = null;
                setData(null);
                setError(null);
                setStatus('empty');
                setAttempt(0);
                setStartedAt(null);
                setRequestId(null);
                return false;
            }

            if (!authReady) {
                setError(null);
                setStatus(dataRef.current ? 'retrying' : 'loading');
                return false;
            }

            const cacheKey = getGroupStateCacheKey(orgId, clubId);
            const cached = groupStateCache.get(cacheKey) ?? dataRef.current;
            const cachedIncludesMedia = groupStateIncludesMediaCache.get(cacheKey) === true;
            const hasUsableCache = Boolean(cached && (!includeMedia || cachedIncludesMedia));

            if (!forceFresh && hasUsableCache) {
                setData(cached ?? null);
                setStatus('success');
                setError(null);
                setAttempt(0);
                setStartedAt(null);
                setLastSuccessAt(groupStateFetchedAtCache.get(cacheKey) ?? Date.now());
                clubDataLogger.log('Group state resolved from cache', {
                    groupId: clubId,
                    orgId,
                    reason,
                    summary: summarizeClubData(cached),
                });
                return true;
            }

            const nextRequestId = createDashboardRequestId('group-state');
            const controller = new AbortController();
            activeAbortRef.current?.abort();
            activeAbortRef.current = controller;
            activeRequestIdRef.current = nextRequestId;
            setRequestId(nextRequestId);
            setStartedAt(Date.now());
            setAttempt(0);
            setError(null);
            setStatus(keepStaleData || hasUsableCache || Boolean(dataRef.current) ? 'retrying' : 'loading');
            if (cached && keepStaleData) {
                setData(cached);
            }

            clubDataLogger.log('Group state load start', {
                forceFresh,
                groupId: clubId,
                hasCachedData: hasUsableCache,
                includeMedia,
                orgId,
                reason,
                requestId: nextRequestId,
            });

            try {
                const nextData = await retryWithBackoff(
                    async (attemptIndex) => {
                        setAttempt(attemptIndex + 1);
                        return forceFresh
                            ? await fetchFreshGroupState(orgId, clubId, {
                                  bypassCache,
                                  includeMedia,
                                  requestId: nextRequestId,
                                  signal: controller.signal,
                              })
                            : await loadGroupState(orgId, clubId, {
                                  includeMedia,
                                  requestId: nextRequestId,
                                  signal: controller.signal,
                              });
                    },
                    {
                        delaysMs: DASHBOARD_RETRY_DELAYS_MS,
                        label: 'Group state load',
                        logger: clubDataLogger,
                        requestId: nextRequestId,
                        retries: DASHBOARD_RETRY_DELAYS_MS.length,
                    }
                );

                if (controller.signal.aborted || activeRequestIdRef.current !== nextRequestId) {
                    clubDataLogger.warn('Group state response ignored as stale', {
                        groupId: clubId,
                        orgId,
                        requestId: nextRequestId,
                    });
                    return false;
                }

                setData(prev => {
                    if (prev && stableSerialize(prev) === stableSerialize(nextData)) {
                        return prev;
                    }
                    return nextData;
                });
                setStatus('success');
                setError(null);
                setStartedAt(null);
                setLastSuccessAt(Date.now());
                clubDataLogger.log('Group state load success', {
                    groupId: clubId,
                    orgId,
                    reason,
                    requestId: nextRequestId,
                    summary: summarizeClubData(nextData),
                });
                return true;
            } catch (loadError) {
                if (controller.signal.aborted || activeRequestIdRef.current !== nextRequestId) {
                    clubDataLogger.warn('Group state load aborted', {
                        groupId: clubId,
                        orgId,
                        requestId: nextRequestId,
                    });
                    return false;
                }

                const message =
                    loadError instanceof Error && loadError.message
                        ? loadError.message
                        : 'Group content could not be loaded.';

                clubDataLogger.error('Group state load failed', loadError, {
                    groupId: clubId,
                    orgId,
                    reason,
                    requestId: nextRequestId,
                });

                setError(message);
                setStatus('error');
                setStartedAt(null);
                return false;
            } finally {
                if (activeRequestIdRef.current === nextRequestId) {
                    activeAbortRef.current = null;
                }
            }
        },
        [authReady, clubId, demoCtx, includeMedia, orgId, useDemo]
    );

    useEffect(() => {
        if (useDemo && demoCtx) {
            setData(demoCtx.clubData as ClubData);
            setStatus('success');
            setError(null);
            setStartedAt(null);
            setLastSuccessAt(Date.now());
            return;
        }
        if (!supabase) {
            setStatus('empty');
            setError(null);
            setStartedAt(null);
            return;
        }
        if (!clubId || !orgId) {
            activeAbortRef.current?.abort();
            activeAbortRef.current = null;
            activeRequestIdRef.current = null;
            setData(null);
            setStatus('empty');
            setError(null);
            setAttempt(0);
            setStartedAt(null);
            setRequestId(null);
            return;
        }
        if (!authReady) {
            setStatus(dataRef.current ? 'retrying' : 'loading');
            return;
        }

        void runLoad({
            reason: 'initial',
            keepStaleData: true,
        });
    }, [authReady, clubId, demoCtx, orgId, runLoad, supabase, useDemo]);

    useEffect(() => {
        if (useDemo || !supabase || !clubId || !orgId || typeof window === 'undefined' || !authReady) {
            return;
        }

        let cancelled = false;
        const refreshFromBackend = async (reason: 'visibility' | 'sync') => {
            if (reason === 'visibility' && !shouldRefreshOnVisibility()) return;
            if (cancelled) return;
            await runLoad({
                reason,
                forceFresh: true,
                bypassCache: true,
                keepStaleData: true,
            });
        };

        const handleVisibilityChange = () => {
            void refreshFromBackend('visibility');
        };
        const handleGroupStateSync = (event: Event) => {
            const syncEvent = event as CustomEvent<GroupStateSyncDetail>;
            const detail = syncEvent.detail;
            if (!detail?.orgId || !detail?.groupId) {
                return;
            }
            if (detail.orgId !== orgId || detail.groupId !== clubId) {
                return;
            }
            void refreshFromBackend('sync');
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
    }, [authReady, clubId, orgId, runLoad, supabase, useDemo]);

    useEffect(() => {
        if (status !== 'loading' && status !== 'retrying') {
            return;
        }
        const pendingRequestId = activeRequestIdRef.current;
        const timeout = setTimeout(() => {
            if (!pendingRequestId || activeRequestIdRef.current !== pendingRequestId) {
                return;
            }
            if (statusRef.current !== 'loading' && statusRef.current !== 'retrying') {
                return;
            }
            activeAbortRef.current?.abort();
            clubDataLogger.error(
                'Group state load watchdog forced error',
                new Error('Group state watchdog timeout'),
                {
                    groupId: clubId,
                    orgId,
                    requestId: pendingRequestId,
                    status: statusRef.current,
                }
            );
            setError('Group content is taking too long to load. Please try again.');
            setStatus('error');
            setStartedAt(null);
        }, DASHBOARD_WATCHDOG_MS);

        return () => clearTimeout(timeout);
    }, [clubId, orgId, status]);

    useEffect(() => {
        return () => {
            activeAbortRef.current?.abort();
        };
    }, []);

    const refreshData = useCallback(async () => {
        if (useDemo || !supabase || !clubId || !orgId || !authReady) return false;
        return await runLoad({
            reason: 'manual-retry',
            forceFresh: true,
            bypassCache: true,
            keepStaleData: true,
        });
    }, [authReady, clubId, orgId, runLoad, supabase, useDemo]);

    const retry = useCallback(async () => {
        return refreshData();
    }, [refreshData]);

    const setLocalClubData = useCallback((
        nextDataOrUpdater: ClubData | ((baseData: ClubData) => ClubData),
        options?: {
            reconcile?: boolean;
        }
    ) => {
        if (!clubId || !orgId) return false;
        const cacheKey = getGroupStateCacheKey(orgId, clubId);
        const baseData = groupStateCache.get(cacheKey) ?? dataRef.current ?? getDefaultClubData();
        const nextData =
            typeof nextDataOrUpdater === 'function'
                ? nextDataOrUpdater(baseData)
                : nextDataOrUpdater;
        const mergedData =
            options?.reconcile === false
                ? normalizeClubData(nextData)
                : reconcileClubData(baseData, nextData);
        setData(prev => {
            if (prev && stableSerialize(prev) === stableSerialize(mergedData)) {
                return prev;
            }
            return mergedData;
        });
        setStatus('success');
        setError(null);
        groupStateCache.set(cacheKey, mergedData);
        if (includeMedia) {
            groupStateIncludesMediaCache.set(cacheKey, true);
        }
        return true;
    }, [clubId, includeMedia, orgId]);

    const updateClubData = useCallback(
        async (
            nextDataOrUpdater: ClubData | ((baseData: ClubData) => ClubData),
            options?: {
                deletedIds?: GroupStateDeletionMap;
                optimisticData?: ClubData;
                patches?: GroupStatePatch[];
            }
        ) => {
            if (useDemo && demoCtx) {
                const resolvedData =
                    typeof nextDataOrUpdater === 'function'
                        ? nextDataOrUpdater(dataRef.current ?? getDefaultClubData())
                        : nextDataOrUpdater;
                demoCtx.updateClubData(resolvedData);
                return true;
            }
            if (!clubId || !orgId || !supabase) return false;
            const cacheKey = getGroupStateCacheKey(orgId, clubId);
            const currentData = groupStateCache.get(cacheKey) ?? dataRef.current ?? getDefaultClubData();
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
            setStatus('success');
            groupStateCache.set(getGroupStateCacheKey(orgId, clubId), optimisticData);
            if (includeMedia) {
                groupStateIncludesMediaCache.set(getGroupStateCacheKey(orgId, clubId), true);
            }

            const freshCurrentData = currentData;

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
                if (includeMedia) {
                    groupStateIncludesMediaCache.set(getGroupStateCacheKey(orgId, clubId), true);
                }
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                        new CustomEvent('policy-violation', {
                            detail: { message: policyErrorMessage },
                        })
                    );
                }
                return false;
            }
            let confirmedPayload: ClubData | null = null;
            const requestedPatches = options?.patches ?? [];
            const shouldPatch = requestedPatches.length > 0 && !options?.deletedIds;
            const saveResponse = shouldPatch
                ? await safeFetchJson<GroupStatePatchResponse>('/api/org-state/patch', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        orgId,
                        groupId: clubId,
                        patches: requestedPatches,
                    }),
                    timeoutMs: 10_000,
                    retry: { retries: 1 },
                    requestId: createDashboardRequestId('group-state-patch'),
                })
                : await safeFetchJson<GroupStateResponse>('/api/org-state?return=minimal', {
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
                    requestId: createDashboardRequestId('group-state-save'),
                });
            if (!saveResponse.ok) {
                console.error(`Error saving data for group ${clubId}`, saveResponse.error);
                setData(freshCurrentData);
                groupStateCache.set(getGroupStateCacheKey(orgId, clubId), freshCurrentData);
                if (includeMedia) {
                    groupStateIncludesMediaCache.set(getGroupStateCacheKey(orgId, clubId), true);
                }
                setError(saveResponse.error.message || 'Group content could not be saved.');
                setStatus('error');
                return false;
            }
            if (!shouldPatch) {
                confirmedPayload = (saveResponse as { ok: true; data: GroupStateResponse }).data.data ?? null;
            }
            const confirmedData = normalizeClubData(confirmedPayload ?? nextData);
            setData(prev => {
                if (prev && stableSerialize(prev) === stableSerialize(confirmedData)) {
                    return prev;
                }
                return confirmedData;
            });
            groupStateCache.set(getGroupStateCacheKey(orgId, clubId), confirmedData);
            if (includeMedia) {
                groupStateIncludesMediaCache.set(getGroupStateCacheKey(orgId, clubId), true);
            }
            setError(null);
            setStatus('success');
            setLastSuccessAt(Date.now());
            dispatchGroupStateSync(orgId, clubId);
            return true;
        },
        [clubId, demoCtx, includeMedia, orgId, supabase, useDemo]
    );

    if (useDemo && demoCtx) {
        return {
            attempt: 0,
            clubId: demoCtx.clubId,
            data: demoCtx.clubData as ClubData,
            error: null,
            lastSuccessAt: Date.now(),
            loading: false,
            orgId: null,
            refreshData,
            requestId: null,
            retry,
            setLocalClubData,
            startedAt: null,
            status: 'success',
            updateClubData,
        };
    }

    return {
        attempt,
        clubId,
        data,
        error,
        lastSuccessAt,
        loading: status === 'loading',
        orgId,
        refreshData,
        requestId,
        retry,
        setLocalClubData,
        startedAt,
        status,
        updateClubData,
    };
}

export function ClubDataProvider({ children }: { children: ReactNode }) {
    const value = useClubDataStoreState();
    return createElement(ClubDataContext.Provider, { value }, children);
}

function useClubDataStore() {
    const context = useContext(ClubDataContext);
    if (!context) {
        throw new Error('useClubDataStore must be used within a ClubDataProvider.');
    }
    return context;
}

export function useClubData() {
    return useClubDataStore();
}


function useSpecificClubData<K extends keyof ClubData>(key: K) {
    const {
        clubId,
        orgId,
        data,
        error,
        loading,
        status,
        retry,
        updateClubData,
        refreshData,
        setLocalClubData,
    } = useClubDataStore();

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
            const atomicPatches =
                deletedIds.length === 0
                    ? buildAtomicArrayPatches(String(key), base[key], valueToStore)
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
                    patches: atomicPatches.length > 0 ? atomicPatches : undefined,
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

    return {
        data: specificData as ClubData[K],
        error,
        loading,
        status,
        retry,
        updateData,
        updateDataAsync,
        setLocalData,
        refreshData,
        clubId,
        orgId,
    };
}


export function useAnnouncements() {
  return useSpecificClubData('announcements');
}

export function useEvents() {
    return useSpecificClubData('events');
}

export function useMembers() {
  const { data, loading, updateData, clubId, orgId } = useSpecificClubData('members');
  return { data, loading, updateData, clubId, orgId };
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

export function useMessagingData() {
    const { clubId, orgId, data, error, loading, updateClubData, refreshData, setLocalClubData } = useClubDataStore();
    const defaults = useMemo(() => getDefaultClubData(), []);
    const members = useMemo(() => data?.members ?? defaults.members, [data, defaults.members]);
    const messages = useMemo(() => data?.messages ?? defaults.messages, [data, defaults.messages]);
    const groupChats = useMemo(() => data?.groupChats ?? defaults.groupChats, [data, defaults.groupChats]);

    const updateMessagesAsync = useCallback(
        async (
            newData:
                | ClubData['messages']
                | ((prevData: ClubData['messages']) => ClubData['messages'])
        ) => {
            if (!clubId) return false;
            const base =
                orgId && clubId
                    ? groupStateCache.get(getGroupStateCacheKey(orgId, clubId)) ?? data ?? defaults
                    : data ?? defaults;
            const baseMessages = normalizeMessageMap(base.messages);
            const valueToStore =
                typeof newData === 'function'
                    ? (newData as (prevData: ClubData['messages']) => ClubData['messages'])(baseMessages)
                    : newData;
            if (stableSerialize(baseMessages) === stableSerialize(valueToStore)) {
                return true;
            }
            const updatedFullData = { ...base, messages: valueToStore };
            return updateClubData(
                freshBase => ({
                    ...freshBase,
                    messages:
                        typeof newData === 'function'
                            ? (newData as (prevData: ClubData['messages']) => ClubData['messages'])(
                                  normalizeMessageMap(freshBase.messages)
                              )
                            : valueToStore,
                }),
                { optimisticData: updatedFullData }
            );
        },
        [clubId, data, defaults, orgId, updateClubData]
    );

    const updateMessages = useCallback(
        (
            newData:
                | ClubData['messages']
                | ((prevData: ClubData['messages']) => ClubData['messages'])
        ) => {
            void updateMessagesAsync(newData);
        },
        [updateMessagesAsync]
    );

    const setLocalMessages = useCallback(
        (
            newData:
                | ClubData['messages']
                | ((prevData: ClubData['messages']) => ClubData['messages'])
        ) => {
            if (!clubId) return false;
            return setLocalClubData(base => {
                const currentValue = normalizeMessageMap(base.messages);
                const valueToStore =
                    typeof newData === 'function'
                        ? (newData as (prevData: ClubData['messages']) => ClubData['messages'])(currentValue)
                        : newData;
                if (stableSerialize(currentValue) === stableSerialize(valueToStore)) {
                    return base;
                }
                return { ...base, messages: valueToStore };
            }, { reconcile: false });
        },
        [clubId, setLocalClubData]
    );

    const updateGroupChatsAsync = useCallback(
        async (
            newData:
                | ClubData['groupChats']
                | ((prevData: ClubData['groupChats']) => ClubData['groupChats'])
        ) => {
            if (!clubId) return false;
            const base =
                orgId && clubId
                    ? groupStateCache.get(getGroupStateCacheKey(orgId, clubId)) ?? data ?? defaults
                    : data ?? defaults;
            const baseGroupChats = normalizeGroupChats(base.groupChats);
            const valueToStore =
                typeof newData === 'function'
                    ? (newData as (prevData: ClubData['groupChats']) => ClubData['groupChats'])(baseGroupChats)
                    : newData;
            if (stableSerialize(baseGroupChats) === stableSerialize(valueToStore)) {
                return true;
            }
            const updatedFullData = { ...base, groupChats: valueToStore };
            return updateClubData(
                freshBase => ({
                    ...freshBase,
                    groupChats:
                        typeof newData === 'function'
                            ? (newData as (prevData: ClubData['groupChats']) => ClubData['groupChats'])(
                                  normalizeGroupChats(freshBase.groupChats)
                              )
                            : valueToStore,
                }),
                { optimisticData: updatedFullData }
            );
        },
        [clubId, data, defaults, orgId, updateClubData]
    );

    const updateGroupChats = useCallback(
        (
            newData:
                | ClubData['groupChats']
                | ((prevData: ClubData['groupChats']) => ClubData['groupChats'])
        ) => {
            void updateGroupChatsAsync(newData);
        },
        [updateGroupChatsAsync]
    );

    const setLocalGroupChats = useCallback(
        (
            newData:
                | ClubData['groupChats']
                | ((prevData: ClubData['groupChats']) => ClubData['groupChats'])
        ) => {
            if (!clubId) return false;
            return setLocalClubData(base => {
                const currentValue = normalizeGroupChats(base.groupChats);
                const valueToStore =
                    typeof newData === 'function'
                        ? (newData as (prevData: ClubData['groupChats']) => ClubData['groupChats'])(currentValue)
                        : newData;
                if (stableSerialize(currentValue) === stableSerialize(valueToStore)) {
                    return base;
                }
                return { ...base, groupChats: valueToStore };
            }, { reconcile: false });
        },
        [clubId, setLocalClubData]
    );

    return {
        clubId,
        orgId,
        members,
        messages,
        groupChats,
        error,
        loading,
        refreshData,
        updateMessages,
        updateMessagesAsync,
        setLocalMessages,
        updateGroupChats,
        updateGroupChatsAsync,
        setLocalGroupChats,
    };
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
    const demoCtx = useOptionalDemoCtx();
    const useDemo = shouldUseDemoData(Boolean(demoCtx));
    const { user, loading: userLoading } = useCurrentUser();
    const { clubId, data, loading: clubDataLoading, status: clubDataStatus, error, retry } = useClubDataStore();

    const role = useMemo(() => {
        if (useDemo && demoCtx) {
            return demoCtx.appRole;
        }
        if (!user?.email) {
            return null;
        }
        return getRoleFromMembers(Array.isArray(data?.members) ? data.members : [], user.email);
    }, [data?.members, demoCtx, useDemo, user?.email]);

    const loading = useMemo(() => {
        if (useDemo && demoCtx) {
            return false;
        }
        if (userLoading) {
            return true;
        }
        if (!user?.email || !clubId) {
            return false;
        }
        return clubDataLoading;
    }, [clubDataLoading, clubId, demoCtx, useDemo, user?.email, userLoading]);

    const normalizedRole = role?.toLowerCase() ?? null;
    const canEdit = canEditGroupContent(normalizedRole);
    const canManage = canManageGroupRoles(normalizedRole);

    return {
        role,
        canEditContent: canEdit,
        canManageRoles: canManage,
        loading,
        status: !clubId ? 'empty' : clubDataStatus,
        error,
        retry,
    };
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
    const role = inferredRole;
    const loading = userLoading || clubDataLoading;

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
