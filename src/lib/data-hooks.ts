
import { useState, useEffect, useCallback, useMemo } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { safeFetchJson } from '@/lib/network';
import type { Member, User, Announcement, SocialPost, Presentation, GalleryImage, ClubEvent, Slide, Message, GroupChat, Transaction, PointEntry, MindMapData, ClubForm } from './mock-data';
import { getDefaultOrgState } from '@/lib/org-state';
import { useOptionalDemoCtx } from '@/lib/demo/DemoDataProvider';

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

function useClubDataStore() {
    const demoCtx = useOptionalDemoCtx();
    const useDemo = shouldUseDemoData(Boolean(demoCtx));
    const [clubId, setClubId] = useState<string | null>(null);
    const [data, setData] = useState<ClubData | null>(null);
    const [loading, setLoading] = useState(true);
    const supabase = useMemo(() => (useDemo ? null : createSupabaseBrowserClient()), [useDemo]);

    useEffect(() => {
        if (useDemo) return;
        if (typeof window === 'undefined') return;
        setClubId(localStorage.getItem('selectedClubId'));
    }, [useDemo]);

    useEffect(() => {
        if (useDemo || !supabase) {
            setLoading(false);
            return;
        }
        if (!clubId) {
            setLoading(false);
            return;
        }
        const load = async () => {
            setLoading(true);
            const { data: row, error } = await supabase
                .from('org_state')
                .select('data')
                .eq('org_id', clubId)
                .maybeSingle();
            if (error) {
                console.error(`Error loading data for club ${clubId}`, error);
                setData(null);
                setLoading(false);
                return;
            }
            if (!row?.data) {
                const defaults = getDefaultClubData();
                await supabase.from('org_state').insert({ org_id: clubId, data: defaults });
                setData(defaults);
                setLoading(false);
                return;
            }
            setData(normalizeClubData(row.data as ClubData));
            setLoading(false);
        };
        load();
    }, [clubId, supabase, useDemo]);

    const updateClubData = useCallback(
        async (nextData: ClubData) => {
            if (useDemo && demoCtx) {
                demoCtx.updateClubData(nextData);
                return;
            }
            if (!clubId) return;
            setData(nextData);
            await safeFetchJson('/api/org-state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orgId: clubId, data: nextData }),
                timeoutMs: 10_000,
                retry: { retries: 1 },
            });
        },
        [clubId, demoCtx, useDemo]
    );

    if (useDemo && demoCtx) {
        return {
            clubId: demoCtx.clubId,
            data: demoCtx.clubData as ClubData,
            loading: false,
            updateClubData,
        };
    }

    return { clubId, data, loading, updateClubData };
}


function useSpecificClubData<K extends keyof ClubData>(key: K) {
    const { clubId, data, loading, updateClubData } = useClubDataStore();

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
            const updatedFullData = { ...base, [key]: valueToStore };
            updateClubData(updatedFullData);
        },
        [clubId, data, key, updateClubData]
    );

    return { data: specificData as ClubData[K], loading, updateData, clubId };
}


export function useAnnouncements() {
  return useSpecificClubData('announcements');
}

export function useEvents() {
    return useSpecificClubData('events');
}

export function useMembers() {
  return useSpecificClubData('members');
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
      try {
        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
          setUser(JSON.parse(storedUser));
          return;
        }
        const { data } = await supabase.auth.getSession();
        const sessionUser = data.session?.user;
        if (sessionUser) {
          const displayName =
            (sessionUser.user_metadata?.display_name as string | undefined) ||
            sessionUser.email ||
            'Member';
          const hydratedUser = {
            name: displayName,
            email: sessionUser.email || '',
            avatar: `https://placehold.co/100x100.png?text=${displayName.charAt(0)}`,
          } as User;
          localStorage.setItem('currentUser', JSON.stringify(hydratedUser));
          setUser(hydratedUser);
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

  useEffect(() => {
    if (!useDemo || !demoCtx) return;
    setUser(demoCtx.user);
    setLoading(false);
  }, [demoCtx, useDemo]);

  const saveUser = useCallback((newUser: Partial<User> | ((currentUser: User | null) => User)) => {
    if (useDemo && demoCtx) {
      demoCtx.updateUser(currentUser =>
        typeof newUser === 'function'
          ? (newUser as (currentUser: User | null) => User)(currentUser)
          : ({ ...(currentUser || {}), ...newUser } as User)
      );
      return;
    }
    setUser(currentUser => {
        const updatedUser = typeof newUser === 'function'
            ? newUser(currentUser)
            : { ...(currentUser || {}), ...newUser } as User;
        localStorage.setItem('currentUser', JSON.stringify(updatedUser));
        return updatedUser;
    });
  }, [demoCtx, useDemo]);
  
  const clearUser = useCallback(() => {
    if (useDemo) {
      setUser(null);
      return;
    }
    setUser(null);
    localStorage.removeItem('currentUser');
  }, [useDemo]);

  return { user: isMounted ? user : null, loading, saveUser, clearUser };
}


// Hook to get the current user's role
export function useCurrentUserRole() {
    const demoCtx = useOptionalDemoCtx();
    const useDemo = shouldUseDemoData(Boolean(demoCtx));
    const { user, loading: userLoading } = useCurrentUser();
    const [role, setRole] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const supabase = useMemo(() => (useDemo ? null : createSupabaseBrowserClient()), [useDemo]);

    useEffect(() => {
        const load = async () => {
            if (userLoading) return;
            if (useDemo && demoCtx) {
                setRole(demoCtx.appRole);
                setLoading(false);
                return;
            }
            const clubId = typeof window !== 'undefined' ? localStorage.getItem('selectedClubId') : null;
            if (!clubId || !user || !supabase) {
                setRole(null);
                setLoading(false);
                return;
            }
            const { data: authUser } = await supabase.auth.getUser();
            const userId = authUser.user?.id;
            if (!userId) {
                setRole(null);
                setLoading(false);
                return;
            }
            const { data } = await supabase
                .from('memberships')
                .select('role')
                .eq('org_id', clubId)
                .eq('user_id', userId)
                .maybeSingle();
            const mappedRole =
                data?.role === 'admin'
                    ? 'Admin'
                    : data?.role === 'moderator'
                      ? 'Officer'
                      : data?.role === 'member'
                        ? 'Member'
                        : null;
            setRole(mappedRole);
            setLoading(false);
        };
        load();
    }, [demoCtx, supabase, useDemo, user, userLoading]);

    const canEdit = role === 'Admin' || role === 'Officer' || role === 'President';
    const canManage = role === 'Admin' || role === 'President';

    return { role, canEditContent: canEdit, canManageRoles: canManage, loading };
}

export type NotificationKey = 'announcements' | 'social' | 'messages' | 'calendar' | 'gallery' | 'attendance' | 'forms';

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

    const loading = userLoading || announcementsLoading || socialPostsLoading || messagesLoading || groupsLoading || eventsLoading || galleryImagesLoading || formsLoading || roleLoading;

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


        const hasUnreadAnnouncements = safeAnnouncements.some((a: Announcement) => !a.read);
        const hasUnreadSocials = safeSocialPosts.some((p: SocialPost) => !p.read);
        
        const unreadDms = Object.values(safeAllMessages).flat().some((m: Message) => m.readBy && !m.readBy.includes(user.email!) && m.sender !== user.email);
        const unreadGroups = safeGroupChats.some((chat: GroupChat) => chat.messages.some(m => m.readBy && !m.readBy.includes(user.email!) && m.sender !== user.email));
        const hasUnreadMessages = unreadDms || unreadGroups;
        
        const hasUnreadEvents = safeEvents.some((e: ClubEvent) => !e.read);
        const hasUnreadGallery = safeGalleryImages.some((i: GalleryImage) => i.status === 'approved' && !i.read);
        const hasUnreadForms = safeForms.some((f: ClubForm) => {
            if (!user.email) return false;
            return !(f.viewedBy || []).includes(user.email);
        });
        
        let hasUnreadAttendance = false;
        if (role === 'President' || role === 'Admin') {
            hasUnreadAttendance = safeEvents.some((e: ClubEvent) => e.attendees && e.attendees.length > (e.lastViewedAttendees || 0));
        }

        return {
            announcements: hasUnreadAnnouncements,
            social: hasUnreadSocials,
            messages: hasUnreadMessages,
            calendar: hasUnreadEvents,
            gallery: hasUnreadGallery,
            forms: hasUnreadForms,
            attendance: hasUnreadAttendance,
        };
    }, [loading, user, announcements, socialPosts, allMessages, groupChats, events, galleryImages, role, forms]);
    
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

    return { unread, loading, markAllAsRead };
}
