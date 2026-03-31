import type { Announcement, ClubEvent, Member, Transaction } from '@/lib/mock-data';

type InsightItem = {
  id?: string;
  text: string;
  actionLabel?: string;
  actionHref?: string;
};

export type OfficerInsights = {
  actionNeeded: InsightItem[];
  engagementWarnings: InsightItem[];
  bestPracticeNudge?: string;
  weeklySnapshot?: {
    upcomingEventsCount?: number;
    scheduledAnnouncementsCount?: number;
    pendingApprovalsCount?: number;
    currentBalance?: number;
  };
};

type InsightsInput = {
  userId?: string | null;
  clubId?: string | null;
  announcements?: Announcement[];
  events?: ClubEvent[];
  transactions?: Transaction[];
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

export const getOfficerInsights = (input: InsightsInput): OfficerInsights => {
  const now = new Date();
  const announcements = Array.isArray(input.announcements) ? input.announcements : [];
  const events = Array.isArray(input.events) ? input.events : [];
  const transactions = Array.isArray(input.transactions) ? input.transactions : [];
  const members = Array.isArray(input.members) ? input.members : [];

  const actionNeeded: InsightItem[] = [];
  const engagementWarnings: InsightItem[] = [];

  const formatEventTitle = (event: ClubEvent) =>
    event.title && event.title.trim() ? event.title.trim() : 'Untitled event';

  const formatAnnouncementTitle = (item: Announcement) =>
    item.title && item.title.trim() ? item.title.trim() : 'Untitled announcement';

  const eventsMissingLocation = events.filter(event => {
    const location = String(event.location ?? '').trim();
    return !location || location === 'NA' || location === '0';
  });
  {
    const missingNames = eventsMissingLocation.slice(0, 2).map(formatEventTitle);
    const hasMore = eventsMissingLocation.length > missingNames.length;
    const nameSuffix =
      missingNames.length > 0
        ? ` (${missingNames.join(', ')}${hasMore ? ', ...' : ''})`
        : '';
    const text =
      events.length === 0
        ? 'No events yet to check locations.'
        : eventsMissingLocation.length > 0
          ? `${eventsMissingLocation.length} event${
              eventsMissingLocation.length === 1 ? '' : 's'
            } missing a location${nameSuffix}.`
          : 'All events have a location set.';
    actionNeeded.push({
      id: 'events_missing_location',
      text,
      actionLabel: 'Review',
      actionHref: '/calendar',
    });
  }

  const upcomingEvents = events.filter(event => event.date && event.date > now);
  {
    let text = 'No upcoming events to check RSVPs.';
    if (upcomingEvents.length > 0) {
      const nextEvent = upcomingEvents.sort((a, b) => a.date.getTime() - b.date.getTime())[0];
      const rsvpCount = Array.isArray(nextEvent.rsvps?.yes) ? nextEvent.rsvps?.yes.length : 0;
      if (members.length === 0) {
        text = `RSVP tracking is unavailable for "${formatEventTitle(nextEvent)}" (no members).`;
      } else if (rsvpCount < Math.ceil(members.length / 3)) {
        text = `${members.length - rsvpCount} members haven't RSVP'd for "${
          formatEventTitle(nextEvent)
        }" (${rsvpCount}/${members.length} RSVPs).`;
      } else {
        text = `RSVPs for "${formatEventTitle(nextEvent)}" look healthy (${rsvpCount}/${members.length}).`;
      }
    }
    actionNeeded.push({
      id: 'low_rsvp_next_event',
      text,
      actionLabel: 'Review',
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
            } posted this week. Review for clarity.`;
    actionNeeded.push({
      id: 'announcements_this_week',
      text,
      actionLabel: 'Review',
      actionHref: '/announcements',
    });
  }

  const announcementWithDates = announcements
    .map(item => ({
      item,
      date: item.date ? new Date(item.date) : null,
    }))
    .filter(entry => entry.date && !Number.isNaN(entry.date.getTime()))
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

  const viewsPerAnnouncement = announcementWithDates.map(entry =>
    Array.isArray(entry.item.viewedBy) ? entry.item.viewedBy.length : 0
  );

  {
    let text = 'No announcements to measure engagement.';
    if (viewsPerAnnouncement.length >= 2) {
      const recentAnnouncement = announcementWithDates[0].item;
      const recentViews = viewsPerAnnouncement[0];
      const avg =
        viewsPerAnnouncement.reduce((sum, count) => sum + count, 0) / viewsPerAnnouncement.length;
      if (recentViews < avg * 0.8) {
        text = `"${formatAnnouncementTitle(recentAnnouncement)}" has ${recentViews} views vs an average of ${Math.round(
          avg
        )}.`;
      } else {
        text = `Announcement engagement is steady. "${formatAnnouncementTitle(
          recentAnnouncement
        )}" has ${recentViews} views vs an average of ${Math.round(avg)}.`;
      }
    } else if (viewsPerAnnouncement.length === 1) {
      text = `Only one announcement available to measure engagement ("${formatAnnouncementTitle(
        announcementWithDates[0].item
      )}").`;
    }
    engagementWarnings.push({
      id: 'announcement_engagement_drop',
      text,
      actionLabel: 'Review',
      actionHref: '/announcements',
    });
  }

  const recentEventHour = upcomingEvents[0]?.date?.getHours();
  {
    let text = 'No upcoming events scheduled to check timing.';
    if (upcomingEvents.length > 0) {
      const nextEvent = upcomingEvents[0];
      const hour = nextEvent.date?.getHours();
      if (typeof hour === 'number' && (hour < 8 || hour > 20)) {
        text = `The next event "${formatEventTitle(
          nextEvent
        )}" is scheduled outside the typical 6-8 PM window.`;
      } else if (typeof hour === 'number') {
        text = `The next event "${formatEventTitle(
          nextEvent
        )}" is within the typical 6-8 PM window.`;
      }
    }
    engagementWarnings.push({
      id: 'event_time_window',
      text,
    });
  }

  const pastEventsWithAttendance = events
    .filter(event => event.date && event.date <= now)
    .map(event => ({
      event,
      count: Array.isArray(event.attendees) ? event.attendees.length : 0,
    }))
    .filter(entry => entry.count > 0)
    .sort((a, b) => b.event.date.getTime() - a.event.date.getTime());

  {
    let text = 'No attendance data yet.';
    if (pastEventsWithAttendance.length >= 2) {
      const mostRecent = pastEventsWithAttendance[0];
      const avgAttendance =
        pastEventsWithAttendance.reduce((sum, entry) => sum + entry.count, 0) /
        pastEventsWithAttendance.length;
      text = `Most recent event "${formatEventTitle(mostRecent.event)}" had ${
        mostRecent.count
      } attendees vs an average of ${Math.round(avgAttendance)}.`;
    } else if (pastEventsWithAttendance.length === 1) {
      text = `Only one event has attendance recorded ("${formatEventTitle(
        pastEventsWithAttendance[0].event
      )}" with ${pastEventsWithAttendance[0].count} attendees).`;
    }
    engagementWarnings.push({
      id: 'attendance_vs_average',
      text,
      actionLabel: 'Review',
      actionHref: '/calendar',
    });
  }

  const balance = transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
  const income = transactions.filter(tx => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
  const expenses = transactions.filter(tx => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0);

  const tipPool = [
    'Tip: Announcements under 120 words tend to get higher engagement.',
    'Tip: Include a clear call-to-action in the first sentence.',
    'Tip: Posts sent between 6-8 PM typically get higher engagement.',
    'Tip: Add a short subject line to help members scan updates quickly.',
    'Tip: Use consistent event titles so members recognize recurring meetings.',
  ];
  const tipSeed = Math.floor(now.getTime() / (1000 * 60 * 60 * 6));
  const tipIndex = tipSeed % tipPool.length;
  const bestPracticeNudge = announcements.length > 0 ? tipPool[tipIndex] : undefined;

  const hasSnapshotData =
    announcements.length > 0 || events.length > 0 || transactions.length > 0;

  const weeklySnapshot = hasSnapshotData
    ? {
        upcomingEventsCount: events.length > 0 ? upcomingEvents.length : undefined,
        scheduledAnnouncementsCount:
          announcements.length > 0 ? announcementsThisWeek.length : undefined,
        pendingApprovalsCount: undefined,
        currentBalance:
          transactions.length > 0 && Number.isFinite(balance) ? balance : undefined,
      }
    : undefined;

  return {
    actionNeeded,
    engagementWarnings,
    bestPracticeNudge,
    weeklySnapshot,
  };
};
