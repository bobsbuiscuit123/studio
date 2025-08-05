

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Member, User, Announcement, SocialPost, Presentation, GalleryImage, ClubEvent, Slide, Message, GroupChat, Transaction } from './mock-data';

// A mock database object for demonstration. In a real app, you'd use a proper database.
const mockDatabase: { [key: string]: any } = {};

function useClubData<T>(key: string, initialData: T) {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const [clubId, setClubId] = useState<string | null>(null);

  const clubDataKey = useMemo(() => clubId ? `club_${clubId}` : null, [clubId]);

  useEffect(() => {
    const id = localStorage.getItem('selectedClubId');
    setClubId(id);
  }, []);
  
  const loadData = useCallback(() => {
    if (clubDataKey) {
      try {
        const storedClubData = localStorage.getItem(clubDataKey);
        if (storedClubData) {
          const parsedData = JSON.parse(storedClubData);
          let finalData = parsedData[key] || initialData;
          
          if (key === 'presentations' && Array.isArray(finalData)) {
            finalData = finalData.map(p => ({
              ...p,
              slides: p.slides.map((s, index) => ({
                ...s,
                id: s.id || `${p.id}-${index}`
              }))
            })) as T;
          } else if (key === 'events' && Array.isArray(finalData)) {
               finalData = finalData.map((event: any) => ({
                  ...event,
                  date: new Date(event.date),
              })) as T;
          }
          setData(finalData);

        } else {
           setData(initialData);
        }
      } catch (error) {
        console.error(`Error reading ${key} from localStorage`, error);
        setData(initialData);
      }
      setLoading(false);
    } else if (clubId === null) {
      setLoading(false);
    }
  }, [clubDataKey, key, initialData]);

  useEffect(() => {
    loadData();

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === clubDataKey && event.newValue) {
        loadData();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [clubId, clubDataKey, loadData]);

  const updateData = useCallback((newData: T | ((prevData: T) => T)) => {
    if (!clubDataKey) return;

    setData(prevData => {
        const valueToStore = typeof newData === 'function'
            ? (newData as (prevData: T) => T)(prevData)
            : newData;

        try {
            const storedClubData = localStorage.getItem(clubDataKey);
            const parsedData = storedClubData ? JSON.parse(storedClubData) : {};
    
            parsedData[key] = valueToStore;
            localStorage.setItem(clubDataKey, JSON.stringify(parsedData));

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
    const updatedUser = { ...user, ...newUser } as User;
    setUser(updatedUser);
    localStorage.setItem('currentUser', JSON.stringify(updatedUser));
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
