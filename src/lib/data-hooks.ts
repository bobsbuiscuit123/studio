
import { useState, useEffect, useCallback, useMemo } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { safeFetchJson } from '@/lib/network';
import type { Member, User, Announcement, SocialPost, Presentation, GalleryImage, ClubEvent, Slide, Message, GroupChat, Transaction, PointEntry, MindMapData, ClubForm } from './mock-data';
import { getDefaultOrgState } from '@/lib/org-state';
import { useOptionalDemoCtx } from '@/lib/demo/DemoDataProvider';
import { getSelectedGroupId, getSelectedOrgId } from '@/lib/selection';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';
import { canEditGroupContent, canManageGroupRoles, displayGroupRole } from '@/lib/group-permissions';

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

const DEMO_MODE_ENABLED = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
const isDemoRoute = () =>
  typeof window !== 'undefined' &&
  (window.location.pathname === '/demo' || window.location.pathname.startsWith('/demo/'));
const shouldUseDemoData = (hasDemoContext: boolean) =>
  DEMO_MODE_ENABLED && hasDemoContext && isDemoRoute();

const getDefaultClubData = (): ClubData => getDefaultOrgState();
const TAB_VIEW_KEY = 'tabLastViewed';
const stableSerialize = (value: unknown): string => {
    if (Array.isArray(value)) {
        return `[${value.map(item => stableSerialize(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b)
        );
        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(',')}}`;
    }
    return JSON.stringify(value);
};

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

const getGroupStateCacheKey = (orgId: string, groupId: string) => `${orgId}:${groupId}`;

const normalizeClubData = (data: ClubData): ClubData => {
    const defaults = getDefaultClubData();
    const normalized = {
        ...data,
        mindmap: data.mindmap ?? defaults.mindmap,
    };
    if (Array.isArray(normalized.events)) {
        normalized.events = normalized.events.map((event: any) => ({
            ...event,
            date: new Date(event.date),
        }));
    }
    return normalized;
};

async function loadGroupState(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  orgId: string,
  groupId: string
) {
  const cacheKey = getGroupStateCacheKey(orgId, groupId);
  const cached = groupStateCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const pending = groupStateRequestCache.get(cacheKey);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    const { data: row, error } = await supabase
      .from('group_state')
      .select('data')
      .eq('group_id', groupId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!row?.data) {
      const defaults = getDefaultClubData();
      await supabase.from('group_state').insert({ org_id: orgId, group_id: groupId, data: defaults });
      groupStateCache.set(cacheKey, defaults);
      return defaults;
    }
    const normalized = normalizeClubData(row.data as ClubData);
    groupStateCache.set(cacheKey, normalized);
    return normalized;
  })();

  groupStateRequestCache.set(cacheKey, request);
  try {
    return await request;
  } finally {
    groupStateRequestCache.delete(cacheKey);
  }
}

async function fetchFreshGroupState(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  orgId: string,
  groupId: string
) {
  const { data: row, error } = await supabase
    .from('group_state')
    .select('data')
    .eq('group_id', groupId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!row?.data) {
    return groupStateCache.get(getGroupStateCacheKey(orgId, groupId)) ?? getDefaultClubData();
  }
  const normalized = normalizeClubData(row.data as ClubData);
  groupStateCache.set(getGroupStateCacheKey(orgId, groupId), normalized);
  return normalized;
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
    const supabase = useMemo(() => (useDemo ? null : createSupabaseBrowserClient()), [useDemo]);

    useEffect(() => {
        if (useDemo) return;
        if (typeof window === 'undefined') return;
        setClubId(getSelectedGroupId());
        setOrgId(getSelectedOrgId());
    }, [useDemo]);

    useEffect(() => {
        if (useDemo || !supabase) {
            setLoading(false);
            return;
        }
        if (!clubId || !orgId) {
            setLoading(false);
            return;
        }
        const load = async () => {
            const cacheKey = getGroupStateCacheKey(orgId, clubId);
            const cached = groupStateCache.get(cacheKey);
            if (cached) {
                setData(cached);
                setLoading(false);
                return;
            }
            setLoading(true);
            try {
                const nextData = await loadGroupState(supabase, orgId, clubId);
                setData(nextData);
            } catch (error) {
                console.error(`Error loading data for group ${clubId}`, error);
                setData(null);
            }
            setLoading(false);
        };
        load();
    }, [clubId, orgId, supabase, useDemo]);

    useEffect(() => {
        if (useDemo || !supabase || !clubId || !orgId || typeof window === 'undefined') {
            return;
        }

        let cancelled = false;
        const refreshFromBackend = async () => {
            if (document.visibilityState !== 'visible') return;
            try {
                const nextData = await fetchFreshGroupState(supabase, orgId, clubId);
                if (!cancelled) {
                    setData(prev => {
                        if (prev && stableSerialize(prev) === stableSerialize(nextData)) {
                            return prev;
                        }
                        return nextData;
                    });
                }
            } catch (error) {
                console.error(`Error refreshing data for group ${clubId}`, error);
            }
        };

        const handleVisibilityChange = () => {
            void refreshFromBackend();
        };

        window.addEventListener('visibilitychange', handleVisibilityChange);
        const intervalId = window.setInterval(() => {
            void refreshFromBackend();
        }, 5000);

        return () => {
            cancelled = true;
            window.removeEventListener('visibilitychange', handleVisibilityChange);
            window.clearInterval(intervalId);
        };
    }, [clubId, orgId, supabase, useDemo]);

    const updateClubData = useCallback(
        async (nextData: ClubData) => {
            if (useDemo && demoCtx) {
                demoCtx.updateClubData(nextData);
                return;
            }
            if (!clubId || !orgId) return;
            const currentData = data ?? getDefaultClubData();
            if (stableSerialize(currentData) === stableSerialize(nextData)) {
                return;
            }
            const violation = findPolicyViolation(nextData);
            if (violation) {
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                        new CustomEvent('policy-violation', {
                            detail: { message: policyErrorMessage },
                        })
                    );
                }
                return;
            }
            setData(nextData);
            groupStateCache.set(getGroupStateCacheKey(orgId, clubId), nextData);
            await safeFetchJson('/api/org-state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orgId, groupId: clubId, data: nextData }),
                timeoutMs: 10_000,
                retry: { retries: 1 },
            });
        },
        [clubId, data, demoCtx, orgId, useDemo]
    );

    if (useDemo && demoCtx) {
        return {
            clubId: demoCtx.clubId,
            data: demoCtx.clubData as ClubData,
            loading: false,
            updateClubData,
        };
    }

    return { clubId, orgId, data, loading, updateClubData };
}


function useSpecificClubData<K extends keyof ClubData>(key: K) {
    const { clubId, orgId, data, loading, updateClubData } = useClubDataStore();

    const specificData = useMemo(() => {
        const defaults = getDefaultClubData();
        return data?.[key] ?? defaults[key];
    }, [data, key]);

    const updateData = useCallback(
        (newData: ClubData[K] | ((prevData: ClubData[K]) => ClubData[K])) => {
            if (!clubId) return;
            const base = data ?? getDefaultClubData();
            const valueToStore =
                typeof newData === 'function'
                    ? (newData as (prevData: ClubData[K]) => ClubData[K])(base[key])
                    : newData;
            if (stableSerialize(base[key]) === stableSerialize(valueToStore)) {
                return;
            }
            const updatedFullData = { ...base, [key]: valueToStore };
            updateClubData(updatedFullData);
        },
        [clubId, data, key, updateClubData]
    );

    return { data: specificData as ClubData[K], loading, updateData, clubId, orgId };
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
          const profileByEmail = new Map(
            profiles
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
      void updateClubData(nextFullData);
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
    const getDefaultAvatar = (displayName: string) =>
      `https://placehold.co/100x100.png?text=${displayName.charAt(0)}`;
    const hydrate = async () => {
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
            avatar: profile?.avatar_url || getDefaultAvatar(displayName),
          } as User;
          localStorage.setItem('currentUser', JSON.stringify(hydratedUser));
          setUser(hydratedUser);
          return;
        }
        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
          setUser(JSON.parse(storedUser));
          return;
        }
        setUser(null);
      } catch (error) {
        console.error('Error reading user from storage on init', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    hydrate();
  }, [demoCtx, useDemo]);

  const setLocalUser = useCallback((nextUser: User | null) => {
    if (useDemo) {
      setUser(nextUser);
      return;
    }
    setUser(nextUser);
    if (nextUser) {
      localStorage.setItem('currentUser', JSON.stringify(nextUser));
    } else {
      localStorage.removeItem('currentUser');
    }
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
    const updatedUser =
      typeof newUser === 'function'
        ? (newUser as (currentUser: User | null) => User)(user)
        : ({ ...(user || {}), ...newUser } as User);
    localStorage.setItem('currentUser', JSON.stringify(updatedUser));
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
      localStorage.setItem('currentUser', JSON.stringify(response.data.data));
      setUser(response.data.data);
      return;
    }
    console.error('Failed to persist profile', response.ok ? response.data : response.error);
  }, [demoCtx, useDemo, user]);
  
  const clearUser = useCallback(() => {
    if (useDemo) {
      setUser(null);
      return;
    }
    setUser(null);
    localStorage.removeItem('currentUser');
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
        const groupId = getSelectedGroupId();
        if (!user?.email || !groupId) {
            setRole(null);
            setLoading(false);
            return;
        }
        const supabase = createSupabaseBrowserClient();
        let active = true;
        const loadRole = async () => {
            const { data: authUser } = await supabase.auth.getUser();
            const userId = authUser.user?.id;
            if (!userId) {
                if (active) {
                    setRole(null);
                    setLoading(false);
                }
                return;
            }
            const { data } = await supabase
                .from('group_memberships')
                .select('role')
                .eq('group_id', groupId)
                .eq('user_id', userId)
                .maybeSingle();
            if (active) {
                setRole(displayGroupRole(data?.role));
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

export type NotificationKey = 'announcements' | 'social' | 'messages' | 'calendar' | 'gallery' | 'attendance' | 'forms';

export type OrgAiQuotaStatus = {
    orgId: string;
    orgName: string;
    role: string;
    memberLimit: number;
    dailyAiLimitPerUser: number;
    activeUsers: number;
    requestsUsedToday: number;
    aiAvailability: 'available' | 'limited' | 'paused';
    estimatedMonthlyCredits: number;
    estimatedDailyCredits: number;
    creditHealth: 'healthy' | 'low' | 'urgent' | 'depleted';
    creditBalance?: number;
    estimatedDaysRemaining?: number;
    recentCreditActivity?: Array<{
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
    window.dispatchEvent(
        new CustomEvent('org-ai-usage-changed', {
            detail: {
                orgId: orgId ?? getSelectedOrgId() ?? null,
                delta,
            },
        })
    );
};

export function useOrgAiQuotaStatus(orgIdOverride?: string | null) {
    const [status, setStatus] = useState<OrgAiQuotaStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const orgId = orgIdOverride ?? getSelectedOrgId();

    const refresh = useCallback(async (options?: { silent?: boolean }) => {
        if (!orgId) {
            setStatus(null);
            setLoading(false);
            return;
        }
        if (!options?.silent) {
            setLoading(true);
        }
        const response = await safeFetchJson<{ ok: true; data: OrgAiQuotaStatus }>(
            `/api/orgs/${orgId}/status`,
            { method: 'GET' }
        );
        if (response.ok) {
            setStatus(response.data.data);
        } else {
            console.error('Failed to load org AI status', response.error);
            setStatus(null);
        }
        setLoading(false);
    }, [orgId]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void refresh({ silent: true });
            }
        };
        const handleUsageChanged = (event?: Event) => {
            const detail =
                event && 'detail' in event
                    ? (event as CustomEvent<{ orgId?: string | null; delta?: number }>).detail
                    : undefined;
            const changedOrgId = detail?.orgId ?? null;
            if (changedOrgId && orgId && changedOrgId !== orgId) return;
            const delta = Math.max(0, Number(detail?.delta ?? 0));
            if (delta > 0) {
                setStatus(prev =>
                    prev
                        ? {
                              ...prev,
                              requestsUsedToday: Math.min(
                                  prev.dailyAiLimitPerUser,
                                  prev.requestsUsedToday + delta
                              ),
                          }
                        : prev
                );
            }
            void refresh({ silent: true });
        };
        window.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('org-ai-usage-changed', handleUsageChanged as EventListener);
        const intervalId = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                void refresh({ silent: true });
            }
        }, 10000);
        return () => {
            window.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('org-ai-usage-changed', handleUsageChanged as EventListener);
            window.clearInterval(intervalId);
        };
    }, [refresh]);

    const used = status?.requestsUsedToday ?? 0;
    const limit = status?.dailyAiLimitPerUser ?? 0;
    const remaining = Math.max(0, limit - used);
    const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

    return { status, loading, refresh, used, limit, remaining, percent };
}

export function useNotifications() {
    const { data: announcements, loading: announcementsLoading } = useAnnouncements();
    const { data: socialPosts, loading: socialPostsLoading } = useSocialPosts();
    const { data: allMessages, loading: messagesLoading } = useMessages();
    const { data: groupChats, loading: groupsLoading } = useGroupChats();
    const { data: events, loading: eventsLoading } = useEvents();
    const { data: galleryImages, loading: galleryImagesLoading } = useGalleryImages();
    const { data: forms, loading: formsLoading } = useForms();
    const { user, loading: userLoading } = useCurrentUser();
    const { role, loading: roleLoading } = useCurrentUserRole();
    const [tabLastViewed, setTabLastViewed] = useState<Record<NotificationKey, number>>({
        announcements: 0,
        social: 0,
        messages: 0,
        calendar: 0,
        gallery: 0,
        attendance: 0,
        forms: 0,
    });
    const selectedOrgId = getSelectedOrgId();
    const selectedGroupId = getSelectedGroupId();

    const loading = userLoading || announcementsLoading || socialPostsLoading || messagesLoading || groupsLoading || eventsLoading || galleryImagesLoading || formsLoading || roleLoading;

    useEffect(() => {
        if (!user?.email || !selectedOrgId || !selectedGroupId) {
            setTabLastViewed({
                announcements: 0,
                social: 0,
                messages: 0,
                calendar: 0,
                gallery: 0,
                attendance: 0,
                forms: 0,
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

    const unread = useMemo(() => {
        if (loading || !user) {
            return {
            announcements: false,
            social: false,
            messages: false,
            calendar: false,
            gallery: false,
            forms: false,
            attendance: false,
        };
        }
        
        const safeAnnouncements = Array.isArray(announcements) ? announcements : [];
        const safeSocialPosts = Array.isArray(socialPosts) ? socialPosts : [];
        const safeEvents = Array.isArray(events) ? events : [];
        const safeGalleryImages = Array.isArray(galleryImages) ? galleryImages : [];
        const safeGroupChats = Array.isArray(groupChats) ? groupChats : [];
        const safeAllMessages = allMessages && typeof allMessages === 'object' ? allMessages : {};
        const safeForms = Array.isArray(forms) ? forms : [];


        const latestAnnouncementTimestamp = safeAnnouncements.reduce((latest: number, announcement: Announcement) => {
            const timestamp = new Date(announcement.date).getTime();
            return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
        }, 0);
        const latestSocialTimestamp = safeSocialPosts.reduce((latest: number, post: SocialPost) => {
            const timestamp = new Date(post.date).getTime();
            return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
        }, 0);
        
        const latestDmTimestamp = Object.values(safeAllMessages)
            .flat()
            .filter((m: Message) => m.sender !== user.email)
            .reduce((latest, message) => {
                const timestamp = new Date(message.timestamp).getTime();
                return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
            }, 0);
        const latestGroupTimestamp = safeGroupChats.reduce((latestChatTimestamp: number, chat: GroupChat) => {
            const chatLatest = chat.messages
                .filter(message => message.sender !== user.email)
                .reduce((latestMessageTimestamp, message) => {
                    const timestamp = new Date(message.timestamp).getTime();
                    return Number.isFinite(timestamp) ? Math.max(latestMessageTimestamp, timestamp) : latestMessageTimestamp;
                }, 0);
            return Math.max(latestChatTimestamp, chatLatest);
        }, 0);
        const latestMessageTimestamp = Math.max(latestDmTimestamp, latestGroupTimestamp);
        const latestEventTimestamp = safeEvents.reduce((latest: number, event: ClubEvent) => {
            const timestamp = event.date instanceof Date ? event.date.getTime() : new Date(event.date).getTime();
            return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
        }, 0);
        const latestGalleryTimestamp = safeGalleryImages.reduce((latest: number, image: GalleryImage) => {
            if (image.status !== 'approved') return latest;
            const timestamp = new Date(image.date).getTime();
            return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
        }, 0);
        const latestFormTimestamp = safeForms.reduce((latest: number, form: ClubForm) => {
            const createdAt = new Date(form.createdAt).getTime();
            const latestResponse = form.responses.reduce((responseLatest, response) => {
                const submittedAt = new Date(response.submittedAt).getTime();
                return Number.isFinite(submittedAt) ? Math.max(responseLatest, submittedAt) : responseLatest;
            }, 0);
            return Math.max(latest, Number.isFinite(createdAt) ? createdAt : 0, latestResponse);
        }, 0);
        const attendanceActivity = safeEvents.reduce((count, event) => count + (event.attendees?.length ?? 0), 0);

        const hasUnreadAnnouncements = latestAnnouncementTimestamp > tabLastViewed.announcements;
        const hasUnreadSocials = latestSocialTimestamp > tabLastViewed.social;
        const hasUnreadMessages = latestMessageTimestamp > tabLastViewed.messages;
        const hasUnreadEvents = latestEventTimestamp > tabLastViewed.calendar;
        const hasUnreadGallery = latestGalleryTimestamp > tabLastViewed.gallery;
        const hasUnreadForms = latestFormTimestamp > tabLastViewed.forms;
        const hasUnreadAttendance = role === 'Admin' && attendanceActivity > tabLastViewed.attendance;

        return {
            announcements: hasUnreadAnnouncements,
            social: hasUnreadSocials,
            messages: hasUnreadMessages,
            calendar: hasUnreadEvents,
            gallery: hasUnreadGallery,
            forms: hasUnreadForms,
            attendance: hasUnreadAttendance,
        };
    }, [loading, user, announcements, socialPosts, allMessages, groupChats, events, galleryImages, role, forms, tabLastViewed]);
    
    const announcementsHook = useAnnouncements();
    const socialPostsHook = useSocialPosts();
    const messagesHook = useMessages();
    const groupChatsHook = useGroupChats();
    const eventsHook = useEvents();
    const galleryImagesHook = useGalleryImages();
    const formsHook = useForms();
    
    const markAllAsRead = useCallback((key: NotificationKey) => {
        if (!user?.email) return;
        const userEmail = user.email;

        switch (key) {
            case 'announcements':
                announcementsHook.updateData(prev => (Array.isArray(prev) ? prev : []).map(item => ({ ...item, read: true })));
                break;
            case 'social':
                socialPostsHook.updateData(prev => (Array.isArray(prev) ? prev : []).map(item => ({ ...item, read: true })));
                break;
            case 'messages':
                messagesHook.updateData(prev => {
                    const newMessages = { ...(prev || {}) };
                    for (const convoId in newMessages) {
                        newMessages[convoId] = newMessages[convoId].map(msg => {
                            if (!msg.readBy.includes(userEmail)) {
                                return { ...msg, readBy: [...msg.readBy, userEmail] };
                            }
                            return msg;
                        });
                    }
                    return newMessages;
                });
                groupChatsHook.updateData(prev => (Array.isArray(prev) ? prev : []).map(g => ({
                    ...g,
                    messages: g.messages.map(msg => {
                        if (!msg.readBy.includes(userEmail)) {
                            return { ...msg, readBy: [...msg.readBy, userEmail] };
                        }
                        return msg;
                    })
                })));
                break;
            case 'calendar':
                eventsHook.updateData(prev => (Array.isArray(prev) ? prev : []).map(item => ({...item, read: true } as any)));
                break;
            case 'gallery':
                galleryImagesHook.updateData(prev => (Array.isArray(prev) ? prev : []).map(item => ({ ...item, read: true })));
                break;
            case 'forms':
                formsHook.updateData(prev => (Array.isArray(prev) ? prev : []).map(item => {
                    const viewedBy = Array.isArray(item.viewedBy) ? item.viewedBy : [];
                    return viewedBy.includes(userEmail) ? item : { ...item, viewedBy: [...viewedBy, userEmail] };
                }));
                break;
            case 'attendance':
                eventsHook.updateData(prev => (Array.isArray(prev) ? prev : []).map(item => ({...item, lastViewedAttendees: item.attendees?.length || 0 } as any)));
                break;
        }
    }, [user, announcementsHook, socialPostsHook, messagesHook, groupChatsHook, eventsHook, galleryImagesHook, formsHook]);

    const markTabViewed = useCallback((key: NotificationKey) => {
        if (!user?.email || !selectedOrgId || !selectedGroupId) return;
        const activityValueByKey: Record<NotificationKey, number> = {
            announcements: unread.announcements
                ? (Array.isArray(announcements) ? announcements.reduce((latest, announcement) => {
                    const timestamp = new Date(announcement.date).getTime();
                    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
                }, 0) : 0)
                : tabLastViewed.announcements,
            social: unread.social
                ? (Array.isArray(socialPosts) ? socialPosts.reduce((latest, post) => {
                    const timestamp = new Date(post.date).getTime();
                    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
                }, 0) : 0)
                : tabLastViewed.social,
            messages: unread.messages
                ? Math.max(
                    Object.values(allMessages && typeof allMessages === 'object' ? allMessages : {})
                        .flat()
                        .filter((message: Message) => message.sender !== user.email)
                        .reduce((latest, message) => {
                            const timestamp = new Date(message.timestamp).getTime();
                            return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
                        }, 0),
                    (Array.isArray(groupChats) ? groupChats : []).reduce((latest, chat) => {
                        const chatLatest = chat.messages
                            .filter(message => message.sender !== user.email)
                            .reduce((messageLatest, message) => {
                                const timestamp = new Date(message.timestamp).getTime();
                                return Number.isFinite(timestamp) ? Math.max(messageLatest, timestamp) : messageLatest;
                            }, 0);
                        return Math.max(latest, chatLatest);
                    }, 0)
                )
                : tabLastViewed.messages,
            calendar: unread.calendar
                ? (Array.isArray(events) ? events.reduce((latest, event) => {
                    const timestamp = event.date instanceof Date ? event.date.getTime() : new Date(event.date).getTime();
                    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
                }, 0) : 0)
                : tabLastViewed.calendar,
            gallery: unread.gallery
                ? (Array.isArray(galleryImages) ? galleryImages.reduce((latest, image) => {
                    if (image.status !== 'approved') return latest;
                    const timestamp = new Date(image.date).getTime();
                    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
                }, 0) : 0)
                : tabLastViewed.gallery,
            attendance: unread.attendance
                ? (Array.isArray(events) ? events.reduce((count, event) => count + (event.attendees?.length ?? 0), 0) : 0)
                : tabLastViewed.attendance,
            forms: unread.forms
                ? (Array.isArray(forms) ? forms.reduce((latest, form) => {
                    const createdAt = new Date(form.createdAt).getTime();
                    const latestResponse = form.responses.reduce((responseLatest, response) => {
                        const submittedAt = new Date(response.submittedAt).getTime();
                        return Number.isFinite(submittedAt) ? Math.max(responseLatest, submittedAt) : responseLatest;
                    }, 0);
                    return Math.max(latest, Number.isFinite(createdAt) ? createdAt : 0, latestResponse);
                }, 0) : 0)
                : tabLastViewed.forms,
        };
        const nextValue = activityValueByKey[key];
        writeTabLastViewed(user.email, selectedOrgId, selectedGroupId, key, nextValue);
        setTabLastViewed(prev => ({ ...prev, [key]: nextValue }));
    }, [allMessages, announcements, events, forms, galleryImages, groupChats, selectedGroupId, selectedOrgId, socialPosts, tabLastViewed, unread, user?.email]);

    return { unread, loading, markAllAsRead, markTabViewed };
}
