
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Member, User, Announcement, SocialPost, Presentation, GalleryImage, ClubEvent, Slide, Message, GroupChat, Transaction, PointEntry, MindMapData } from './mock-data';

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
    logo: string;
    mindmap?: MindMapData;
};

// --- Centralized Data Store ---
let clubDataCache: { [clubId: string]: ClubData } = {};
const subscribers = new Set<() => void>();
const channel = typeof window !== 'undefined' ? new BroadcastChannel('clubhub_ai_sync') : null;

function notifySubscribers() {
    subscribers.forEach(cb => cb());
}

if (channel) {
    channel.onmessage = (event) => {
        if (event.data?.type === 'update') {
            // Invalidate local cache and notify to re-fetch
            const clubId = event.data.clubId;
            if (clubId && clubDataCache[clubId]) {
                delete clubDataCache[clubId];
            }
            notifySubscribers();
        }
    };
}

function useClubDataStore() {
    const [clubId, setClubId] = useState<string | null>(() => typeof window !== 'undefined' ? localStorage.getItem('selectedClubId') : null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const loadData = useCallback((id: string | null) => {
        if (!id) {
            setLoading(false);
            return;
        }

        if (clubDataCache[id]) {
            setLoading(false);
            return; // Data already in cache
        }
        
        setLoading(true);
        try {
            const storedClubData = localStorage.getItem(`club_${id}`);
            if (storedClubData) {
                const parsedData = JSON.parse(storedClubData);
                // Data transformations for dates
                if (Array.isArray(parsedData.events)) {
                    parsedData.events = parsedData.events.map((event: any) => ({
                        ...event,
                        date: new Date(event.date),
                    }));
                }
                clubDataCache[id] = parsedData;
            }
        } catch (e) {
            console.error(`Error loading data for club ${id}`, e);
            setError(e as Error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const handleStorageChange = () => {
            const newClubId = localStorage.getItem('selectedClubId');
            if (newClubId !== clubId) {
                setClubId(newClubId);
                loadData(newClubId);
            }
        };

        // Initial load
        loadData(clubId);

        // Listen for changes
        const unsubscribe = () => {
            subscribers.delete(handleStorageChange);
        };
        subscribers.add(handleStorageChange);
        window.addEventListener('storage', handleStorageChange);
        
        return () => {
            unsubscribe();
            window.removeEventListener('storage', handleStorageChange);
        };
    }, [clubId, loadData]);

    const data = clubId ? clubDataCache[clubId] : null;

    return { clubId, data, loading, error };
}

function useSpecificClubData<K extends keyof ClubData>(key: K) {
    const { clubId, data, loading } = useClubDataStore();

    const specificData = useMemo(() => {
        return data?.[key] ?? [];
    }, [data, key]);

    const updateData = useCallback((newData: ClubData[K] | ((prevData: ClubData[K]) => ClubData[K])) => {
        if (!clubId || !data) return;

        const valueToStore = typeof newData === 'function'
            ? (newData as (prevData: ClubData[K]) => ClubData[K])(data[key])
            : newData;
        
        const updatedFullData = { ...data, [key]: valueToStore };
        clubDataCache[clubId] = updatedFullData;
        
        try {
            localStorage.setItem(`club_${clubId}`, JSON.stringify(updatedFullData));
            if (channel) {
                channel.postMessage({ type: 'update', clubId: clubId });
            }
            notifySubscribers(); // Notify local hooks to update
        } catch (error) {
            console.error(`Error writing ${key} to localStorage`, error);
        }
    }, [clubId, data, key]);

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
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const storedUser = localStorage.getItem('currentUser');
      return storedUser ? JSON.parse(storedUser) : null;
    } catch (error) {
      console.error('Error reading user from localStorage on init', error);
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(false);
  }, []);

  const saveUser = (newUser: Partial<User> | ((currentUser: User | null) => User)) => {
    setUser(currentUser => {
        const updatedUser = typeof newUser === 'function'
            ? newUser(currentUser)
            : { ...(currentUser || {}), ...newUser } as User;
        localStorage.setItem('currentUser', JSON.stringify(updatedUser));
        return updatedUser;
    });
  };
  
  const clearUser = () => {
    setUser(null);
    localStorage.removeItem('currentUser');
  }

  return { user, loading, saveUser, clearUser };
}


// Hook to get the current user's role
export function useCurrentUserRole() {
    const { data: members, loading: membersLoading } = useMembers();
    const { user, loading: userLoading } = useCurrentUser();

    const roleData = useMemo(() => {
        if (membersLoading || userLoading) {
            return { role: null, canEditContent: false, canManageRoles: false, loading: true };
        }

        let currentRole: string | null = null;
        if (user && members) {
            const currentUserInClub = (members as Member[]).find((m: Member) => m.email === user.email);
            currentRole = currentUserInClub ? currentUserInClub.role : null;
        }

        const canEdit = currentRole === 'President' || currentRole === 'Admin' || currentRole === 'Officer';
        const canManage = currentRole === 'President' || currentRole === 'Admin';
        
        return {
            role: currentRole,
            canEditContent: canEdit,
            canManageRoles: canManage,
            loading: false,
        };
    }, [members, user, membersLoading, userLoading]);

    return roleData;
}

export type NotificationKey = 'announcements' | 'social' | 'messages' | 'calendar' | 'gallery' | 'attendance';

export function useNotifications() {
    const { data: announcements, loading: announcementsLoading } = useAnnouncements();
    const { data: socialPosts, loading: socialPostsLoading } = useSocialPosts();
    const { data: allMessages, loading: messagesLoading } = useMessages();
    const { data: groupChats, loading: groupsLoading } = useGroupChats();
    const { data: events, loading: eventsLoading } = useEvents();
    const { data: galleryImages, loading: galleryImagesLoading } = useGalleryImages();
    const { user, loading: userLoading } = useCurrentUser();
    const { role, loading: roleLoading } = useCurrentUserRole();

    const loading = userLoading || announcementsLoading || socialPostsLoading || messagesLoading || groupsLoading || eventsLoading || galleryImagesLoading || roleLoading;

    const unread = useMemo(() => {
        if (loading || !user) {
            return {
                announcements: false,
                social: false,
                messages: false,
                calendar: false,
                gallery: false,
                attendance: false,
            };
        }
        
        const safeAnnouncements = Array.isArray(announcements) ? announcements : [];
        const safeSocialPosts = Array.isArray(socialPosts) ? socialPosts : [];
        const safeEvents = Array.isArray(events) ? events : [];
        const safeGalleryImages = Array.isArray(galleryImages) ? galleryImages : [];
        const safeGroupChats = Array.isArray(groupChats) ? groupChats : [];
        const safeAllMessages = allMessages && typeof allMessages === 'object' ? allMessages : {};


        const hasUnreadAnnouncements = safeAnnouncements.some((a: Announcement) => !a.read);
        const hasUnreadSocials = safeSocialPosts.some((p: SocialPost) => !p.read);
        
        const unreadDms = Object.values(safeAllMessages).flat().some((m: Message) => m.readBy && !m.readBy.includes(user.email!) && m.sender !== user.email);
        const unreadGroups = safeGroupChats.some((chat: GroupChat) => chat.messages.some(m => m.readBy && !m.readBy.includes(user.email!) && m.sender !== user.email));
        const hasUnreadMessages = unreadDms || unreadGroups;
        
        const hasUnreadEvents = safeEvents.some((e: ClubEvent) => !e.read);
        const hasUnreadGallery = safeGalleryImages.some((i: GalleryImage) => i.status === 'approved' && !i.read);
        
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
            attendance: hasUnreadAttendance,
        };
    }, [loading, user, announcements, socialPosts, allMessages, groupChats, events, galleryImages, role]);
    
    const announcementsHook = useAnnouncements();
    const socialPostsHook = useSocialPosts();
    const messagesHook = useMessages();
    const groupChatsHook = useGroupChats();
    const eventsHook = useEvents();
    const galleryImagesHook = useGalleryImages();
    
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
            case 'attendance':
                eventsHook.updateData(prev => (Array.isArray(prev) ? prev : []).map(item => ({...item, lastViewedAttendees: item.attendees?.length || 0 } as any)));
                break;
        }
    }, [user, announcementsHook, socialPostsHook, messagesHook, groupChatsHook, eventsHook, galleryImagesHook]);

    return { unread, loading, markAllAsRead };
}
