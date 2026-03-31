import type { Announcement, ClubEvent, Member } from '@/lib/mock-data';
import type { OfficerInsights } from '@/lib/analytics/officerInsights';

type InsightsInput = {
  userId?: string | null;
  announcements?: Announcement[];
  events?: ClubEvent[];
  members?: Member[];
};

const startOfWeek = (date: Date) => {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = (day + 6) % 7;
  copy.setDate(copy.getDate() - diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

export const getMemberInsights = (input: InsightsInput): OfficerInsights => {
  const now = new Date();
  const announcements = Array.isArray(input.announcements) ? input.announcements : [];
  const events = Array.isArray(input.events) ? input.events : [];

  const actionNeeded: OfficerInsights['actionNeeded'] = [];
  const engagementWarnings: OfficerInsights['engagementWarnings'] = [];

  const userEmail = input.userId?.toLowerCase() ?? null;
  const unreadAnnouncements = userEmail
    ? announcements.filter(item => !item.viewedBy?.includes(userEmail))
    : [];

  {
    const text = userEmail
      ? unreadAnnouncements.length > 0
        ? `You have ${unreadAnnouncements.length} unread announcement${
            unreadAnnouncements.length === 1 ? '' : 's'
          }.`
        : 'You are all caught up on announcements.'
      : 'Sign in to track unread announcements.';
    actionNeeded.push({
      id: 'unread_announcements',
      text,
      actionLabel: 'Review',
      actionHref: '/announcements',
    });
  }

  const upcomingEvents = events.filter(event => event.date && event.date > now);
  {
    let text = 'No upcoming events scheduled.';
    if (upcomingEvents.length > 0) {
      const nextEvent = upcomingEvents.sort((a, b) => a.date.getTime() - b.date.getTime())[0];
      text = `Next event: ${nextEvent.title} on ${nextEvent.date.toLocaleDateString()}.`;
    }
    actionNeeded.push({
      id: 'upcoming_events',
      text,
      actionLabel: 'View',
      actionHref: '/calendar',
    });
  }

  const weekStart = startOfWeek(now);
  const announcementsThisWeek = announcements.filter(item => {
    const date = item.date ? new Date(item.date) : null;
    return date && date >= weekStart;
  });
  {
    const text =
      announcements.length === 0
        ? 'No announcements posted yet.'
        : announcementsThisWeek.length === 0
          ? 'No announcements posted this week.'
          : `${announcementsThisWeek.length} announcement${
              announcementsThisWeek.length === 1 ? '' : 's'
            } posted this week.`;
    engagementWarnings.push({
      id: 'announcements_this_week',
      text,
      actionLabel: 'Review',
      actionHref: '/announcements',
    });
  }

  const tipPool = [
    'Tip: RSVP early so organizers can plan.',
    'Tip: Check announcements weekly so you never miss updates.',
    'Tip: Add events to your calendar for reminders.',
  ];
  const tipSeed = Math.floor(now.getTime() / (1000 * 60 * 60 * 6));
  const tipIndex = tipSeed % tipPool.length;

  return {
    actionNeeded,
    engagementWarnings,
    bestPracticeNudge: tipPool[tipIndex],
    weeklySnapshot: undefined,
  };
};
