
import { useState, useEffect } from 'react';

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
  }, [clubId, key, initialData]);

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
    const eventsWithDates = data.map((event: any) => ({
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
