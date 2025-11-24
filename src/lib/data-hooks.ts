

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Member, User, Announcement, SocialPost, Presentation, GalleryImage, ClubEvent, Slide, Message, GroupChat, Transaction, PointEntry, MindMapData } from './mock-data';

// In-memory cache
const dataCache: { [key: string]: any } = {};

function useClubData<T>(key: string, initialData: T) {
  const [clubId, setClubId] = useState<string | null>(null);
  const clubDataKey = useMemo(() => clubId ? `club_${clubId}` : null, [clubId]);
  
  // Initialize state from cache if available, otherwise use initialData.
  const [data, setData] = useState<T>(() => {
    if (clubDataKey && dataCache[clubDataKey] && dataCache[clubDataKey][key] !== undefined) {
      return dataCache[clubDataKey][key];
    }
    return initialData;
  });

  const [loading, setLoading] = useState(!data); // Only show loading if there's no cached data
  const [tabId, setTabId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && !tabId) {
       setTabId(Math.random().toString());
    }
  }, [tabId]);

  useEffect(() => {
    const id = localStorage.getItem('selectedClubId');
    setClubId(id);
  }, []);
  
  const loadData = useCallback(() => {
    if (!clubDataKey) {
        if (clubId === null) {
          queueMicrotask(() => setLoading(false));
        }
        return;
    }
    
    // If data is already in cache, don't re-load unless forced
    if (dataCache[clubDataKey] && dataCache[clubDataKey][key] !== undefined) {
        setData(dataCache[clubDataKey][key]);
        queueMicrotask(() => setLoading(false));
        return;
    }

    try {
        const storedClubData = localStorage.getItem(clubDataKey);
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

        if (!dataCache[clubDataKey]) {
          dataCache[clubDataKey] = {};
        }
        dataCache[clubDataKey][key] = finalData;
        
        queueMicrotask(() => {
          setData(finalData);
        });

    } catch (error) {
        console.error(`Error reading ${key} from localStorage`, error);
        queueMicrotask(() => setData(initialData));
    } finally {
        queueMicrotask(() => setLoading(false));
    }
  }, [clubDataKey, key, initialData, clubId]);

  useEffect(() => {
    loadData();
  }, [loadData]);
  

  useEffect(() => {
    if (typeof window === 'undefined' || !tabId) return;

    const handleStorageChange = (event: StorageEvent & { sourceTabId?: string }) => {
      // Clear cache and reload if the key matches and the change happened in another tab
      if (event.key === clubDataKey && event.sourceTabId !== tabId) {
        if (clubDataKey && dataCache[clubDataKey]) {
          delete dataCache[clubDataKey][key];
        }
        loadData();
      }
    };

    window.addEventListener('storage', handleStorageChange as EventListener);

    return () => {
      window.removeEventListener('storage', handleStorageChange as EventListener);
    };
  }, [clubDataKey, loadData, tabId, key]);

  const updateData = useCallback((newData: T | ((prevData: T) => T)) => {
    if (!clubDataKey || !tabId) return;

    const valueToStore = typeof newData === 'function'
        ? (newData as (prevData: T) => T)(data)
        : newData;

    setData(valueToStore);
    
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
        
        const event = new StorageEvent('storage', {
            key: clubDataKey,
            newValue: newStorageValue,
            storageArea: localStorage,
        });
        Object.assign(event, { sourceTabId: tabId });
        window.dispatchEvent(event);

    } catch (error) {
        console.error(`Error writing ${key} to localStorage`, error);
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
            console.error("Storage quota exceeded. Could not save new data.");
        }
    }
  }, [clubDataKey, key, tabId, data]);

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
  const [tabId, setTabId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && !tabId) {
      setTabId(Math.random().toString());
    }
  }, [tabId]);

  const userDataKey = useMemo(() => user ? `${key}_${user.email}` : null, [user, key]);

  const loadData = useCallback(() => {
    if (userLoading || !userDataKey) {
        if (!userLoading) {
            queueMicrotask(() => setLoading(false));
        }
        return;
    }
    try {
        const storedData = localStorage.getItem(userDataKey);
        const finalData = storedData ? JSON.parse(storedData) : initialData;
        queueMicrotask(() => setData(finalData));
    } catch (error) {
        console.error(`Error reading ${key} from localStorage for user`, error);
        queueMicrotask(() => setData(initialData));
    } finally {
        queueMicrotask(() => setLoading(false));
    }
  }, [userDataKey, initialData, userLoading, key]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (typeof window === 'undefined' || !tabId) return;
    const handleStorageChange = (event: StorageEvent & { sourceTabId?: string }) => {
      if (event.key === userDataKey && event.sourceTabId !== tabId) {
        loadData();
      }
    };
    window.addEventListener('storage', handleStorageChange as EventListener);
    return () => {
      window.removeEventListener('storage', handleStorageChange as EventListener);
    };
  }, [userDataKey, loadData, tabId]);

  const updateData = useCallback((newData: T | ((prevData: T) => T)) => {
    if (!userDataKey || !tabId) return;

    setData(currentData => {
        const valueToStore = typeof newData === 'function'
            ? (newData as (prevData: T) => T)(currentData)
            : newData;

        try {
            const newStorageValue = JSON.stringify(valueToStore);
            localStorage.setItem(userDataKey, newStorageValue);

            const event = new StorageEvent('storage', {
                key: userDataKey,
                newValue: newStorageValue,
                storageArea: localStorage,
            });
            Object.assign(event, { sourceTabId: tabId });
            window.dispatchEvent(event);
        } catch (error) {
            console.error(`Error writing ${key} to localStorage for user`, error);
        }

        return valueToStore;
    });
  }, [userDataKey, key, tabId]);

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

  const saveUser = (newUser: Partial<User>) => {
    let updatedUser: User;
    setUser(currentUser => {
        updatedUser = { ...(currentUser || {}), ...newUser } as User;
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


    
