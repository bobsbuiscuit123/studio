
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

// In-memory cache for the entire club's data
const clubDataCache: { [clubId: string]: ClubData } = {};

// --- Centralized Subscription Manager for BroadcastChannel ---
const channel = typeof window !== 'undefined' ? new BroadcastChannel('clubhub_ai_sync') : null;
const subscribers = new Map<string, Set<() => void>>();

let isListening = false;
const setupListener = () => {
    if (isListening || !channel) return;
    channel.addEventListener('message', () => {
        // Invalidate cache and notify all subscribers to reload
        Object.keys(clubDataCache).forEach(key => delete clubDataCache[key]);
        subscribers.forEach(callbacks => callbacks.forEach(cb => cb()));
    });
    isListening = true;
};

const subscribe = (id: string, callback: () => void) => {
    setupListener();
    if (!subscribers.has(id)) {
        subscribers.set(id, new Set());
    }
    subscribers.get(id)?.add(callback);

    return () => {
        subscribers.get(id)?.delete(callback);
        if (subscribers.get(id)?.size === 0) {
            subscribers.delete(id);
        }
    };
};
// --- End Subscription Manager ---

// A hook to manage the global club data loading and caching
function useClubData() {
  const [clubId, setClubId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [trigger, setTrigger] = useState(0); // State to trigger re-renders

  // Effect to handle initial load and subscriptions
  useEffect(() => {
    const id = localStorage.getItem('selectedClubId');
    setClubId(id);

    // Subscribe to updates from other tabs
    const unsubscribe = subscribe('clubData', () => {
        const currentId = localStorage.getItem('selectedClubId');
        // Force a reload by updating the trigger
        setTrigger(t => t + 1); 
        setClubId(currentId);
    });

    return () => unsubscribe();
  }, [trigger]);


  // Effect to load data from localStorage when clubId changes
  useEffect(() => {
    if (clubId === null) {
        setLoading(false);
        return;
    }
    
    // Check cache first
    if (clubDataCache[clubId]) {
        setLoading(false);
        return;
    }
    
    setLoading(true);
    try {
        const storedClubData = localStorage.getItem(`club_${clubId}`);
        if (storedClubData) {
            const parsedData = JSON.parse(storedClubData);
            
            // Data transformations
            if (Array.isArray(parsedData.events)) {
                parsedData.events = parsedData.events.map((event: any) => ({
                    ...event,
                    date: new Date(event.date),
                }));
            }
             if (Array.isArray(parsedData.presentations)) {
                parsedData.presentations = parsedData.presentations.map((p: any) => ({
                    ...p,
                    slides: p.slides.map((s: any, index: number) => ({
                        ...s,
                        id: s.id || `${p.id}-${index}`
                    }))
                }));
            }

            clubDataCache[clubId] = parsedData;
        }
    } catch (e) {
        console.error(`Error loading data for club ${clubId}`, e);
        setError(e as Error);
    } finally {
        setLoading(false);
    }

  }, [clubId]);

  return { clubId, loading, error };
}

function useSpecificClubData<K extends keyof ClubData>(key: K, initialData: ClubData[K]) {
    const { clubId, loading: clubLoading } = useClubData();
    const [data, setData] = useState<ClubData[K]>(initialData);
    const [loading, setLoading] = useState(true);
    
    useEffect(() => {
        setLoading(clubLoading);
        if (!clubId || clubLoading) {
            setData(initialData);
            return;
        }

        const clubCache = clubDataCache[clubId];
        if (clubCache && clubCache[key] !== undefined) {
            setData(clubCache[key]);
        } else {
            setData(initialData);
        }
    }, [clubId, clubLoading, key, initialData]);

    const updateData = useCallback((newData: ClubData[K] | ((prevData: ClubData[K]) => ClubData[K])) => {
        if (!clubId || !channel) return;

        setData(currentData => {
            const valueToStore = typeof newData === 'function'
                ? (newData as (prevData: ClubData[K]) => ClubData[K])(currentData)
                : newData;

            try {
                // Ensure the cache is up-to-date before writing to storage
                const fullClubData = clubDataCache[clubId] || {};
                const updatedFullData = { ...fullClubData, [key]: valueToStore };
                clubDataCache[clubId] = updatedFullData;

                localStorage.setItem(`club_${clubId}`, JSON.stringify(updatedFullData));
                
                // Notify other tabs
                channel.postMessage({ type: 'update', clubId: clubId });
            } catch (error) {
                console.error(`Error writing ${key} to localStorage`, error);
                 if (error instanceof DOMException && error.name === 'QuotaExceededError') {
                    console.error("Storage quota exceeded. Could not save new data.");
                }
            }
            return valueToStore;
        });
    }, [clubId, key]);

    return { data, loading, updateData, clubId };
}


export function useAnnouncements() {
  const initialData = useMemo(() => [], []);
  return useSpecificClubData<"announcements">('announcements', initialData);
}

export function useEvents() {
    const initialData = useMemo(() => [], []);
    return useSpecificClubData<'events'>('events', initialData);
}

export function useMembers() {
  const initialData = useMemo(() => [], []);
  return useSpecificClubData<'members'>('members', initialData);
}

export function useSocialPosts() {
  const initialData = useMemo(() => [], []);
  return useSpecificClubData<'socialPosts'>('socialPosts', initialData);
}

export function useTransactions() {
  const initialData = useMemo(() => [], []);
  return useSpecificClubData<'transactions'>('transactions', initialData);
}

export function usePresentations() {
    const initialData = useMemo(() => [], []);
    return useSpecificClubData<'presentations'>('presentations', initialData);
}

export function useGalleryImages() {
    const initialData = useMemo(() => [], []);
    return useSpecificClubData<'galleryImages'>('galleryImages', initialData);
}

export function useMessages() {
    const initialData = useMemo(() => ({}), []);
    return useSpecificClubData<'messages'>('messages', initialData);
}

export function useGroupChats() {
    const initialData = useMemo(() => [], []);
    return useSpecificClubData<'groupChats'>('groupChats', initialData);
}

export function usePointEntries() {
  const initialData = useMemo(() => [], []);
  return useSpecificClubData<'pointEntries'>('pointEntries', initialData);
}

function useUserData<T>(key: string, initialData: T) {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const { user, loading: userLoading } = useCurrentUser();
  
  const userDataKey = useMemo(() => user ? `${key}_${user.email}` : null, [user, key]);

  const loadData = useCallback(() => {
    if (userLoading || !userDataKey) {
        if (!userLoading) {
            setLoading(false);
        }
        return;
    }
    try {
        const storedData = localStorage.getItem(userDataKey);
        const finalData = storedData ? JSON.parse(storedData) : initialData;
        setData(finalData);
    } catch (error) {
        console.error(`Error reading ${key} from localStorage for user`, error);
        setData(initialData);
    } finally {
        setLoading(false);
    }
  }, [userDataKey, initialData, userLoading, key]);

  useEffect(() => {
    loadData();

    const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'update' && event.data?.key === userDataKey) {
            loadData();
        }
    };
    channel?.addEventListener('message', handleMessage);
    return () => {
      channel?.removeEventListener('message', handleMessage);
    };
  }, [userDataKey, loadData]);

  const updateData = useCallback((newData: T | ((prevData: T) => T)) => {
    if (!userDataKey || !channel) return;

    setData(currentData => {
        const valueToStore = typeof newData === 'function'
            ? (newData as (prevData: T) => T)(currentData)
            : newData;

        try {
            const newStorageValue = JSON.stringify(valueToStore);
            localStorage.setItem(userDataKey, newStorageValue);

            // Notify other tabs
            channel.postMessage({ type: 'update', key: userDataKey });
            
        } catch (error) {
            console.error(`Error writing ${key} to localStorage for user`, error);
        }

        return valueToStore;
    });
  }, [userDataKey, key]);

  return { data, loading, updateData };
}

export function useMindMapData() {
    const initialData = useMemo(() => ({
        nodes: [{ id: '1', type: 'input', data: { label: 'My Mind Map' }, position: { x: 250, y: 5 } }],
        edges: [],
    }), []);
    return useUserData<MindMapData>('mindmap', initialData);
}


export function useCurrentUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const storedUser = localStorage.getItem('currentUser');
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
      }
    } catch (error) {
      console.error('Error reading user from localStorage', error);
    }
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
            const currentUserInClub = members.find((m: Member) => m.email === user.email);
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

        const hasUnreadAnnouncements = announcements.some(a => !a.read);
        const hasUnreadSocials = socialPosts.some(p => !p.read);
        
        const unreadDms = Object.values(allMessages || {}).flat().some(m => m.readBy && !m.readBy.includes(user.email!) && m.sender !== user.email);
        const unreadGroups = groupChats.some(chat => chat.messages.some(m => m.readBy && !m.readBy.includes(user.email!) && m.sender !== user.email));
        const hasUnreadMessages = unreadDms || unreadGroups;
        
        const hasUnreadEvents = events.some(e => !e.read);
        const hasUnreadGallery = galleryImages.some(i => i.status === 'approved' && !i.read);
        
        let hasUnreadAttendance = false;
        if (role === 'President' || role === 'Admin') {
            hasUnreadAttendance = events.some(e => e.attendees && e.attendees.length > (e.lastViewedAttendees || 0));
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

    const markAllAsRead = useCallback((key: NotificationKey) => {
        if (!user?.email) return;
        const userEmail = user.email;

        switch (key) {
            case 'announcements':
                const announcementsHook = useAnnouncements();
                announcementsHook.updateData(prev => prev.map(item => ({ ...item, read: true })));
                break;
            case 'social':
                const socialPostsHook = useSocialPosts();
                socialPostsHook.updateData(prev => prev.map(item => ({ ...item, read: true })));
                break;
            case 'messages':
                const messagesHook = useMessages();
                messagesHook.updateData(prev => {
                    const newMessages = { ...prev };
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
                const groupChatsHook = useGroupChats();
                groupChatsHook.updateData(prev => prev.map(g => ({
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
                const eventsHook = useEvents();
                eventsHook.updateData(prev => prev.map(item => ({...item, read: true } as any)));
                break;
            case 'gallery':
                const galleryImagesHook = useGalleryImages();
                galleryImagesHook.updateData(prev => prev.map(item => ({ ...item, read: true })));
                break;
            case 'attendance':
                const attendanceEventsHook = useEvents();
                attendanceEventsHook.updateData(prev => prev.map(item => ({...item, lastViewedAttendees: item.attendees?.length || 0 } as any)));
                break;
        }
    }, [user]);

    return { unread, loading, markAllAsRead };
}

    