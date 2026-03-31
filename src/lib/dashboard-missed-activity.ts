import type {
  Announcement,
  ClubEvent,
  ClubForm,
  GroupChat,
  Member,
  Message,
} from '@/lib/mock-data';
import {
  isMessageFromActor,
  messageIncludesReader,
  normalizeGroupChats,
  normalizeMessageMap,
} from '@/lib/message-state';
import {
  createEmptyGroupActivitySnapshot,
  type GroupActivitySnapshot,
} from '@/lib/notification-state';

export type DashboardMissedPopupItem = {
  keys: string[];
  type: string;
  title: string;
  date: Date;
  link: string;
  actor: string | null;
};

const normalizeEmail = (value?: string | null) => String(value ?? '').trim().toLowerCase();

const toDate = (value?: string | Date | null) => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const hasViewed = (viewedBy: string[] | undefined, userEmail: string) =>
  Array.isArray(viewedBy) &&
  viewedBy.some(email => normalizeEmail(email) === userEmail);

const hasSnapshotMember = (snapshot: GroupActivitySnapshot, email: string) =>
  snapshot.members.includes(email);

const hasSnapshotEvent = (snapshot: GroupActivitySnapshot, eventId: string) =>
  snapshot.events.includes(eventId);

const hasSnapshotRsvp = (
  snapshot: GroupActivitySnapshot,
  eventId: string,
  email: string
) => {
  const eventRsvps = snapshot.rsvps[eventId];
  if (!eventRsvps) return false;
  return (
    eventRsvps.yes.includes(email) ||
    eventRsvps.no.includes(email) ||
    eventRsvps.maybe.includes(email)
  );
};

const hasSnapshotAttendance = (
  snapshot: GroupActivitySnapshot,
  eventId: string,
  email: string
) => {
  return (snapshot.attendees[eventId] ?? []).includes(email);
};

type BuildDashboardMissedPopupItemsArgs = {
  announcements: Announcement[];
  events: ClubEvent[];
  forms: ClubForm[];
  groupChats: GroupChat[];
  members: Member[];
  messages: Record<string, Message[]>;
  persistedSnapshot?: GroupActivitySnapshot | null;
  resolveMemberName: (email: string) => string;
  sessionSnapshot?: GroupActivitySnapshot | null;
  groupSessionStartedAt: number;
  shownActivityKeys: Set<string>;
  userEmail: string;
};

export const buildDashboardMissedPopupItems = ({
  announcements,
  events,
  forms,
  groupChats,
  members,
  messages,
  persistedSnapshot,
  resolveMemberName,
  sessionSnapshot,
  groupSessionStartedAt,
  shownActivityKeys,
  userEmail,
}: BuildDashboardMissedPopupItemsArgs) => {
  const baselineSnapshot = persistedSnapshot ?? createEmptyGroupActivitySnapshot();
  const activeSessionSnapshot = sessionSnapshot ?? createEmptyGroupActivitySnapshot();
  const popupItems: DashboardMissedPopupItem[] = [];
  const now = new Date();
  const normalizedUserEmail = normalizeEmail(userEmail);

  const safeMembers = Array.isArray(members) ? members : [];
  const safeEvents = Array.isArray(events) ? events : [];
  const safeAnnouncements = Array.isArray(announcements) ? announcements : [];
  const safeForms = Array.isArray(forms) ? forms : [];
  const safeGroupChats = normalizeGroupChats(groupChats);
  const safeMessages = normalizeMessageMap(messages);

  const firstMemberTime = new Date(now);
  const currentMemberEmails = safeMembers
    .map(member => normalizeEmail(member.email))
    .filter(Boolean);
  const unseenMemberEmails = currentMemberEmails.filter(email => {
    const key = `member:${email}`;
    return (
      !baselineSnapshot.members.includes(email) &&
      hasSnapshotMember(activeSessionSnapshot, email) &&
      !shownActivityKeys.has(key)
    );
  });
  if (unseenMemberEmails.length > 0) {
    const displayNames = unseenMemberEmails.map(email => resolveMemberName(email)).slice(0, 3);
    const suffix = unseenMemberEmails.length > 3 ? ', ...' : '';
    popupItems.push({
      keys: unseenMemberEmails.map(email => `member:${email}`),
      type: 'member',
      title: `New members: ${displayNames.join(', ')}${suffix}`,
      date: firstMemberTime,
      link: '/members',
      actor: null,
    });
  }

  safeEvents.forEach(event => {
    const eventId = typeof event.id === 'string' ? event.id : '';
    if (!eventId) return;

    const eventKey = `event:${eventId}`;
    if (
      !baselineSnapshot.events.includes(eventId) &&
      hasSnapshotEvent(activeSessionSnapshot, eventId) &&
      !shownActivityKeys.has(eventKey)
    ) {
      popupItems.push({
        keys: [eventKey],
        type: 'event',
        title: `New event: ${event.title}`,
        date: now,
        link: '/calendar',
        actor: null,
      });
    }

    const currentYes = (event.rsvps?.yes ?? []).map(normalizeEmail).filter(Boolean);
    const currentNo = (event.rsvps?.no ?? []).map(normalizeEmail).filter(Boolean);
    const currentMaybe = (event.rsvps?.maybe ?? []).map(normalizeEmail).filter(Boolean);
    const baselineRsvps = baselineSnapshot.rsvps[eventId] ?? { yes: [], no: [], maybe: [] };

    const newRsvpEmails = Array.from(
      new Set([...currentYes, ...currentNo, ...currentMaybe])
    ).filter(email => {
      const key = `rsvp:${eventId}:${email}`;
      return (
        !baselineRsvps.yes.includes(email) &&
        !baselineRsvps.no.includes(email) &&
        !baselineRsvps.maybe.includes(email) &&
        hasSnapshotRsvp(activeSessionSnapshot, eventId, email) &&
        !shownActivityKeys.has(key)
      );
    });

    if (newRsvpEmails.length > 0) {
      popupItems.push({
        keys: newRsvpEmails.map(email => `rsvp:${eventId}:${email}`),
        type: 'rsvp',
        title: `${newRsvpEmails.length} new RSVP${newRsvpEmails.length === 1 ? '' : 's'} for ${
          event.title
        }`,
        date: now,
        link: '/calendar',
        actor: null,
      });
    }

    const currentAttendees = (event.attendees ?? []).map(normalizeEmail).filter(Boolean);
    const baselineAttendees = baselineSnapshot.attendees[eventId] ?? [];
    const newAttendanceEmails = currentAttendees.filter(email => {
      const key = `attendance:${eventId}:${email}`;
      return (
        !baselineAttendees.includes(email) &&
        hasSnapshotAttendance(activeSessionSnapshot, eventId, email) &&
        !shownActivityKeys.has(key)
      );
    });

    if (newAttendanceEmails.length > 0) {
      popupItems.push({
        keys: newAttendanceEmails.map(email => `attendance:${eventId}:${email}`),
        type: 'attendance',
        title: `${newAttendanceEmails.length} new check-in${
          newAttendanceEmails.length === 1 ? '' : 's'
        } for ${event.title}`,
        date: now,
        link: '/attendance',
        actor: null,
      });
    }
  });

  safeAnnouncements.forEach(announcement => {
    const announcementId =
      typeof announcement.id === 'string' || typeof announcement.id === 'number'
        ? String(announcement.id)
        : '';
    const announcementDate = toDate(announcement.date);
    const authorEmail = normalizeEmail(announcement.author);
    const key = `announcement:${announcementId}`;

    if (
      !announcementId ||
      !announcementDate ||
      !authorEmail ||
      authorEmail === normalizedUserEmail ||
      shownActivityKeys.has(key) ||
      hasViewed(announcement.viewedBy, normalizedUserEmail) ||
      announcementDate.getTime() >= groupSessionStartedAt
    ) {
      return;
    }

    popupItems.push({
      keys: [key],
      type: 'announcement',
      title: announcement.title,
      date: announcementDate,
      link: '/announcements',
      actor: authorEmail,
    });
  });

  Object.entries(safeMessages).forEach(([conversationKey, conversationMessages]) => {
    conversationMessages.forEach(message => {
      const messageDate = toDate(message.timestamp);
      const senderEmail = normalizeEmail(message.sender);
      const key = `message:dm:${conversationKey}:${message.timestamp}:${senderEmail}`;

      if (
        !messageDate ||
        !senderEmail ||
        shownActivityKeys.has(key) ||
        isMessageFromActor(message, normalizedUserEmail) ||
        messageIncludesReader(message, normalizedUserEmail) ||
        messageDate.getTime() >= groupSessionStartedAt
      ) {
        return;
      }

      popupItems.push({
        keys: [key],
        type: 'message',
        title: `Message from ${resolveMemberName(senderEmail)}`,
        date: messageDate,
        link: '/messages',
        actor: senderEmail,
      });
    });
  });

  safeGroupChats.forEach(chat => {
    chat.messages.forEach(message => {
      const messageDate = toDate(message.timestamp);
      const senderEmail = normalizeEmail(message.sender);
      const key = `message:group:${chat.id}:${message.timestamp}:${senderEmail}`;

      if (
        !messageDate ||
        !senderEmail ||
        shownActivityKeys.has(key) ||
        isMessageFromActor(message, normalizedUserEmail) ||
        messageIncludesReader(message, normalizedUserEmail) ||
        messageDate.getTime() >= groupSessionStartedAt
      ) {
        return;
      }

      popupItems.push({
        keys: [key],
        type: 'message',
        title: `${chat.name} message from ${resolveMemberName(senderEmail)}`,
        date: messageDate,
        link: '/messages',
        actor: senderEmail,
      });
    });
  });

  safeForms.forEach(form => {
    const formId = typeof form.id === 'string' ? form.id : '';
    const createdAt = toDate(form.createdAt);
    const creatorEmail = normalizeEmail(form.createdBy);
    const key = `form:${formId}`;

    if (
      !formId ||
      !createdAt ||
      !creatorEmail ||
      creatorEmail === normalizedUserEmail ||
      shownActivityKeys.has(key) ||
      hasViewed(form.viewedBy, normalizedUserEmail) ||
      createdAt.getTime() >= groupSessionStartedAt
    ) {
      return;
    }

    popupItems.push({
      keys: [key],
      type: 'form',
      title: `New form: ${form.title}`,
      date: createdAt,
      link: '/forms',
      actor: creatorEmail,
    });
  });

  return popupItems.sort((left, right) => right.date.getTime() - left.date.getTime());
};
