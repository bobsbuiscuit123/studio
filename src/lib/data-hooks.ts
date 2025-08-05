

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Member, User, Announcement, SocialPost, Presentation, GalleryImage, ClubEvent, Slide, Message, GroupChat } from './mock-data';

// A mock database object for demonstration. In a real app, you'd use a proper database.
const mockDatabase: { [key: string]: any } = {};

function useClubData<T>(key: string, initialData: T) {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const [clubId, setClubId] = useState<string | null>(null);

  useEffect(() => {
    const id = localStorage.getItem('selectedClubId');
    setClubId(id);
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (clubId) {
      const clubDataKey = `club_${clubId}`;
      try {
        const storedClubData = localStorage.getItem(clubDataKey);
        if (isMounted) {
          if (storedClubData) {
            const parsedData = JSON.parse(storedClubData);
            
            // Data migration for presentations to add slide IDs
            if (key === 'presentations' && parsedData[key]) {
              const presentations = parsedData[key] as Presentation[];
              const migratedPresentations = presentations.map(p => ({
                ...p,
                slides: p.slides.map((s, index) => ({
                  ...s,
                  id: s.id || `${p.id}-${index}`
                }))
              }));
              setData(migratedPresentations as T);
            } else {
              setData(parsedData[key] || initialData);
            }

          } else {
             setData(initialData);
          }
        }
      } catch (error) {
        console.error(`Error reading ${key} from localStorage`, error);
        if (isMounted) setData(initialData);
      }
      if (isMounted) setLoading(false);
    } else if (clubId === null) {
      // Handles the case where there is no selected club
      if (isMounted) setLoading(false);
    }
    return () => { isMounted = false; };
  }, [clubId, key]);

  const updateData = useCallback((newData: T | ((prevData: T) => T)) => {
    setData(prevData => {
        const valueToStore = newData instanceof Function ? newData(prevData) : newData;
        if (clubId) {
            const clubDataKey = `club_${clubId}`;
            try {
                const storedClubData = localStorage.getItem(clubDataKey);
                const parsedData = storedClubData ? JSON.parse(storedClubData) : {};
                parsedData[key] = valueToStore;
                localStorage.setItem(clubDataKey, JSON.stringify(parsedData));
            } catch (error) {
                console.error(`Error writing ${key} to localStorage`, error);
            }
        }
        return valueToStore;
    });
  }, [clubId, key]);

  const memoizedData = useMemo(() => data, [JSON.stringify(data)]);

  return { data: memoizedData, loading, updateData, clubId };
}

export function useAnnouncements() {
  return useClubData<Announcement[]>('announcements', []);
}

export function useEvents() {
    const { data, loading, updateData, clubId } = useClubData<ClubEvent[]>('events', []);
    
    const eventsWithDates = useMemo(() => (data || []).map((event: any) => ({
        ...event,
        date: new Date(event.date),
    })), [data]);

    const updateEventsWithStrings = useCallback((newEvents: any[] | ((prevEvents: any[]) => any[])) => {
        const valueToStore = newEvents instanceof Function 
            ? (prevEventsWithDates: any[]) => {
                const updatedEvents = newEvents(prevEventsWithDates);
                return updatedEvents.map(event => ({...event, date: event.date.toISOString()}));
            }
            : newEvents.map(event => ({ ...event, date: event.date.toISOString() }));
        
        updateData(valueToStore as any);
    }, [updateData]);
    
    return { data: eventsWithDates, loading, updateData: updateEventsWithStrings, clubId };
}


export function useMembers() {
  return useClubData<Member[]>('members', []);
}

export function useSocialPosts() {
  return useClubData<SocialPost[]>('socialPosts', []);
}

export function useTransactions() {
  return useClubData('transactions', []);
}

export function usePresentations() {
    return useClubData<Presentation[]>('presentations', []);
}

export function useGalleryImages() {
    return useClubData<GalleryImage[]>('galleryImages', []);
}

export function useMessages() {
    return useClubData<{[key: string]: Message[]}>('messages', {});
}

export function useGroupChats() {
    return useClubData<GroupChat[]>('groupChats', []);
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
                // This is now handled in the messages page component to prevent loops
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
    }, [user, setAnnouncements, setSocialPosts, setEvents, setGalleryImages]);

    return { unread, loading, markAllAsRead };
}
