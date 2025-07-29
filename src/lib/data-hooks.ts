
import { useState, useEffect } from 'react';
import type { Member, User } from './mock-data';

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
    if (clubId) {
      const clubDataKey = `club_${clubId}`;
      try {
        const storedClubData = localStorage.getItem(clubDataKey);
        if (storedClubData) {
          const parsedData = JSON.parse(storedClubData);
          setData(parsedData[key] || initialData);
        } else {
           setData(initialData);
        }
      } catch (error) {
        console.error(`Error reading ${key} from localStorage`, error);
        setData(initialData);
      }
      setLoading(false);
    } else if (clubId === null) {
      // Handles the case where there is no selected club
      setLoading(false);
    }
  }, [clubId, key, JSON.stringify(initialData)]);

  const updateData = (newData: T) => {
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
  };

  return { data, loading, updateData, clubId };
}

export function useAnnouncements() {
  return useClubData('announcements', []);
}

export function useEvents() {
    const { data, loading, updateData, clubId } = useClubData('events', []);
    
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
        updateData(eventsWithStrings);
    }
    
    return { data: eventsWithDates, loading, updateData: updateEventsWithStrings, clubId };
}


export function useMembers() {
  return useClubData('members', []);
}

export function useSocialPosts() {
  return useClubData('socialPosts', []);
}

export function useTransactions() {
  return useClubData('transactions', []);
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
    const [loading, setLoading] = useState(true);


    useEffect(() => {
        if (!membersLoading && !userLoading) {
            if (user && members && members.length > 0) {
                const currentUserInClub = members.find((m: Member) => m.email === user.email);
                if (currentUserInClub) {
                    setRole(currentUserInClub.role);
                } else {
                    // If user is not in the member list, they can't have a role
                    setRole('Member');
                }
            } else if (user) {
                // If there's a user but no members list (e.g. new club), default to President
                 setRole('President');
            }
            setLoading(false);
        }
    }, [members, user, membersLoading, userLoading]);

    return { role, loading };
}
