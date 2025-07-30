

import { useState, useEffect, useCallback } from 'react';
import type { Member, User, Message, Announcement, SocialPost, Presentation, GalleryImage, ClubEvent, GroupChat, Slide } from './mock-data';

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
  }, [clubId, key, JSON.stringify(initialData)]);

  const updateData = useCallback((newData: T) => {
    if (clubId) {
      const clubDataKey = `club_${clubId}`;
      setData(newData);
      try {
        const storedClubData = localStorage.getItem(clubDataKey);
        const parsedData = storedClubData ? JSON.parse(storedClubData) : {};
        parsedData[key] = newData;
        localStorage.setItem(clubDataKey, JSON.stringify(parsedData));
      } catch (error) {
        console.error(`Error writing ${key} to localStorage`, error);
      }
    }
  }, [clubId, key]);

  return { data, loading, updateData, clubId };
}

export function useAnnouncements() {
  return useClubData<Announcement[]>('announcements', []);
}

export function useEvents() {
    const { data, loading, updateData, clubId } = useClubData<ClubEvent[]>('events', []);
    
    // The events are stored as strings, so we need to convert them to Date objects
    const eventsWithDates = (data || []).map((event: any) => ({
        ...event,
        date: new Date(event.date),
    }));

    const updateEventsWithStrings = (newEvents: any[]) => {
        const eventsWithStrings = newEvents.map(event => ({
            ...event,
            date: event.date.toISOString(),
        }));
        updateData(eventsWithStrings as any);
    }
    
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

export function useGroupChats() {
    const { data, loading, updateData, clubId } = useClubData<GroupChat[]>('groupChats', []);

    const groupsWithDates = (data || []).map(group => ({
        ...group,
        messages: (group.messages || []).map(message => ({
            ...message,
            timestamp: new Date(message.timestamp)
        })).sort((a,b) => a.timestamp.getTime() - b.timestamp.getTime())
    }));

    const updateGroupChatsWithStrings = (newGroups: any[]) => {
        const groupsWithStrings = newGroups.map(group => ({
            ...group,
            messages: (group.messages || []).map((message: any) => ({
                ...message,
                timestamp: message.timestamp.toISOString()
            }))
        }));
        updateData(groupsWithStrings as any);
    }

    return { data: groupsWithDates, loading, updateData: updateGroupChatsWithStrings, clubId };
}


export function useMessages(userEmail?: string | null) {
    const { data: allMessages, loading, updateData, clubId } = useClubData<Message[]>('messages', []);

    const [conversation, setConversation] = useState<Message[]>([]);
    const [recipientEmail, setRecipientEmail] = useState<string | null>(null);

    useEffect(() => {
        if (userEmail && recipientEmail && allMessages) {
            const currentConversation = allMessages.filter(
                (msg) =>
                    (msg.senderEmail === userEmail && msg.recipientEmail === recipientEmail) ||
                    (msg.senderEmail === recipientEmail && msg.recipientEmail === userEmail)
            );
            setConversation(currentConversation.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
        } else {
            setConversation([]);
        }
    }, [allMessages, userEmail, recipientEmail]);
    
    return { 
        data: conversation, 
        allMessages, 
        loading, 
        updateData: updateData, 
        setConversation: setRecipientEmail,
        clubId 
    };
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
    const [role, setRole] = useState<string | null>(null);
    const [canEditContent, setCanEditContent] = useState(false);
    const [canManageRoles, setCanManageRoles] = useState(false);
    const [loading, setLoading] = useState(true);


    useEffect(() => {
        if (!membersLoading && !userLoading) {
            let currentRole: string | null = null;
            if (user && members && members.length > 0) {
                const currentUserInClub = members.find((m: Member) => m.email === user.email);
                currentRole = currentUserInClub ? currentUserInClub.role : null;
            } else if (user) {
                 // If there are no members yet, the first user is the President
                 currentRole = 'President';
            }
            
            setRole(currentRole);
            const canEdit = currentRole === 'President' || currentRole === 'Admin' || currentRole === 'Officer';
            const canManage = currentRole === 'President' || currentRole === 'Admin';
            setCanEditContent(canEdit);
            setCanManageRoles(canManage);

            setLoading(false);
        }
    }, [members, user, membersLoading, userLoading]);

    return { role, canEditContent, canManageRoles, loading };
}
