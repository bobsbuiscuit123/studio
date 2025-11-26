
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Member, User, Announcement, SocialPost, Presentation, GalleryImage, ClubEvent, Slide, Message, GroupChat, Transaction, PointEntry, MindMapData } from './mock-data';

// In-memory cache
const dataCache: { [key: string]: any } = {};

// --- Centralized Subscription Manager for BroadcastChannel ---
const channel = typeof window !== 'undefined' ? new BroadcastChannel('clubhub_ai_sync') : null;
const subscribers = new Map<string, Set<() => void>>();

let isListening = false;
const setupListener = () => {
    if (isListening || !channel) return;
    channel.addEventListener('message', (event: MessageEvent) => {
        const callbacks = subscribers.get('all');
        callbacks?.forEach(cb => cb());
    });
    isListening = true;
}

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


function useClubData<T>(key: string, initialData: T) {
  const [clubId, setClubId] = useState<string | null>(null);
  const clubDataKey = useMemo(() => clubId ? `club_${clubId}` : null, [clubId]);

  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback((currentClubDataKey: string | null, force = false) => {
    if (!currentClubDataKey) {
        setLoading(false);
        setData(initialData);
        return;
    }
    
    setLoading(true);

    if (!force && dataCache[currentClubDataKey] && dataCache[currentClubDataKey][key] !== undefined) {
      setData(dataCache[currentClubDataKey][key]);
      setLoading(false);
      return;
    }
    
    try {
      const storedClubData = localStorage.getItem(currentClubDataKey);
      let finalData: T;
      if (storedClubData) {
        const parsedData = JSON.parse(storedClubData);
        finalData = parsedData[key] !== undefined ? parsedData[key] : initialData;
        
        if (key === 'events' && Array.isArray(finalData)) {
             finalData = finalData.map((event: any) => ({
                ...event,
                date: new Date(event.date),
            })) as T;
        } else if (key === 'presentations' && Array.isArray(finalData)) {
            finalData = finalData.map((p: any) => ({
                ...p,
                slides: p.slides.map((s: any, index: number) => ({
                    ...s,
                    id: s.id || `${p.id}-${index}`
                }))
            })) as T;
        }
      } else {
        finalData = initialData;
      }

      if (!dataCache[currentClubDataKey]) {
        dataCache[currentClubDataKey] = {};
      }
      dataCache[currentClubDataKey][key] = finalData;
      
      setData(finalData);
    } catch (error) {
      console.error(`Error reading ${key} from localStorage`, error);
      setData(initialData);
    } finally {
      setLoading(false);
    }
  }, [key, initialData]);
  
  // Effect for initial load and when clubId changes
  useEffect(() => {
    const id = localStorage.getItem('selectedClubId');
    if (id !== clubId) {
        setClubId(id);
    }
    loadData(id ? `club_${id}` : null);
  }, [clubId, loadData]);

  // Effect to handle updates from broadcast channel
  useEffect(() => {
    const handleUpdate = () => {
        const id = localStorage.getItem('selectedClubId');
        if (id !== clubId) {
            setClubId(id);
        } else {
             loadData(clubDataKey, true);
        }
    };
    
    // Subscribe to all messages
    const unsubscribe = subscribe('all', handleUpdate);
    return () => unsubscribe();
  }, [clubId, clubDataKey, loadData]);


  const updateData = useCallback((newData: T | ((prevData: T) => T)) => {
    if (!clubDataKey || !channel) return;

    setData(currentData => {
      const valueToStore = typeof newData === 'function'
          ? (newData as (prevData: T) => T)(currentData)
          : newData;

      if (!dataCache[clubDataKey]) {
          dataCache[clubDataKey] = {};
      }
      dataCache[clubDataKey][key] = valueToStore;

      try {
          const storedClubData = localStorage.getItem(clubDataKey);
          const parsedData = storedClubData ? JSON.parse(storedClubData) : {};
          parsedData[key] = valueToStore;
          
          const newStorageValue = JSON.stringify(parsedData);
          localStorage.setItem(clubDataKey, newStorageValue);

          // Notify other tabs
          channel.postMessage({ type: 'update', key: clubDataKey });
          
      } catch (error) {
          console.error(`Error writing ${key} to localStorage`, error);
          if (error instanceof DOMException && error.name === 'QuotaExceededError') {
              console.error("Storage quota exceeded. Could not save new data.");
          }
      }

      return valueToStore;
    });

  }, [clubDataKey, key]);

  return { data, loading, updateData, clubId };
}

export function useAnnouncements() {
  const initialData = useMemo(() => [], []);
  return useClubData<Announcement[]>('announcements', initialData);
}

export function useEvents() {
    const initialData = useMemo(() => [], []);
    return useClubData<ClubEvent[]>('events', initialData);
}


export function useMembers() {
  const initialData = useMemo(() => [], []);
  return useClubData<Member[]>('members', initialData);
}

export function useSocialPosts() {
  const initialData = useMemo(() => [], []);
  return useClubData<SocialPost[]>('socialPosts', initialData);
}

export function useTransactions() {
  const initialData = useMemo(() => [], []);
  return useClubData<Transaction[]>('transactions', initialData);
}

export function usePresentations() {
    const initialData = useMemo(() => [], []);
    return useClubData<Presentation[]>('presentations', initialData);
}

export function useGalleryImages() {
    const initialData = useMemo(() => [], []);
    return useClubData<GalleryImage[]>('galleryImages', initialData);
}

export function useMessages() {
    const initialData = useMemo(() => ({}), []);
    return useClubData<{[key: string]: Message[]}>('messages', initialData);
}

export function useGroupChats() {
    const initialData = useMemo(() => [], []);
    return useClubData<GroupChat[]>('groupChats', initialData);
}

export function usePointEntries() {
  const initialData = useMemo(() => [], []);
  return useClubData<PointEntry[]>('pointEntries', initialData);
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
  }, [loadData]);

  useEffect(() => {
    if (typeof window === 'undefined' || !channel) return;
    const handleMessage = (event: MessageEvent) => {
        const { type, key: eventKey } = event.data;
        if (type === 'update' && eventKey === userDataKey) {
            loadData();
        }
    };
    channel.addEventListener('message', handleMessage);
    return () => {
      channel.removeEventListener('message', handleMessage);
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
    const { data: announcements, updateData: setAnnouncements, loading: announcementsLoading } = useAnnouncements();
    const { data: socialPosts, updateData: setSocialPosts, loading: socialPostsLoading } = useSocialPosts();
    const { data: allMessages, updateData: setAllMessages, loading: messagesLoading } = useMessages();
    const { data: groupChats, updateData: setGroupChats, loading: groupsLoading } = useGroupChats();
    const { data: events, updateData: setEvents, loading: eventsLoading } = useEvents();
    const { data: galleryImages, updateData: setGalleryImages, loading: galleryImagesLoading } = useGalleryImages();
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
                setAnnouncements(prev => prev.map(item => ({ ...item, read: true })));
                break;
            case 'social':
                setSocialPosts(prev => prev.map(item => ({ ...item, read: true })));
                break;
            case 'messages':
                 setAllMessages(prev => {
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
                setGroupChats(prev => prev.map(g => ({
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
                setEvents(prev => prev.map(item => ({...item, read: true } as any)));
                break;
            case 'gallery':
                setGalleryImages(prev => prev.map(item => ({ ...item, read: true })));
                break;
            case 'attendance':
                setEvents(prev => prev.map(item => ({...item, lastViewedAttendees: item.attendees?.length || 0 } as any)));
                break;
        }
    }, [user, setAnnouncements, setSocialPosts, setEvents, setGalleryImages, setAllMessages, setGroupChats]);

    return { unread, loading, markAllAsRead };
}
