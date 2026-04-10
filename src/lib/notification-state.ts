import type {
  Announcement,
  ClubEvent,
  ClubForm,
  GalleryImage,
  GroupChat,
  Member,
  Message,
  SocialPost,
  User,
} from '@/lib/mock-data';
import {
  isMessageFromActor,
  messageIncludesReader,
  normalizeGroupChats,
  normalizeMessageMap,
} from '@/lib/message-state';

export type NotificationKey =
  | 'announcements'
  | 'social'
  | 'messages'
  | 'calendar'
  | 'gallery'
  | 'attendance'
  | 'forms';

export const createEmptyNotificationActivity = (): Record<NotificationKey, number> => ({
  announcements: 0,
  social: 0,
  messages: 0,
  calendar: 0,
  gallery: 0,
  attendance: 0,
  forms: 0,
});

export const createEmptyUnreadNotifications = (): Record<NotificationKey, boolean> => ({
  announcements: false,
  social: false,
  messages: false,
  calendar: false,
  gallery: false,
  attendance: false,
  forms: false,
});

export type GroupActivitySnapshot = {
  members: string[];
  events: string[];
  rsvps: Record<string, { yes: string[]; no: string[]; maybe: string[] }>;
  attendees: Record<string, string[]>;
};

export const createEmptyGroupActivitySnapshot = (): GroupActivitySnapshot => ({
  members: [],
  events: [],
  rsvps: {},
  attendees: {},
});

export const isGroupActivitySnapshotEmpty = (snapshot?: GroupActivitySnapshot | null) => {
  if (!snapshot) return true;
  return (
    snapshot.members.length === 0 &&
    snapshot.events.length === 0 &&
    Object.keys(snapshot.rsvps).length === 0 &&
    Object.keys(snapshot.attendees).length === 0
  );
};

const normalizeActivityActor = (value?: string | null) =>
  String(value ?? '').trim().toLowerCase();

const getActivityTimestamp = (value?: string | Date | null) => {
  if (!value) return 0;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const viewedByCurrentUser = (viewedBy: string[] | undefined, userEmail: string) =>
  Array.isArray(viewedBy) &&
  viewedBy.some(email => normalizeActivityActor(email) === userEmail);

export const getRoleFromMembers = (
  members: Member[],
  userEmail?: string | null
) => {
  const normalizedUserEmail = normalizeActivityActor(userEmail);
  if (!normalizedUserEmail) {
    return null;
  }

  const member = members.find(candidate => normalizeActivityActor(candidate.email) === normalizedUserEmail);
  return member?.role ?? null;
};

export const createGroupActivitySnapshot = ({
  members,
  events,
}: {
  members: Member[];
  events: ClubEvent[];
}): GroupActivitySnapshot => {
  const safeMembers = Array.isArray(members) ? members : [];
  const safeEvents = Array.isArray(events) ? events : [];

  return {
    members: safeMembers
      .map(member => normalizeActivityActor(member.email))
      .filter(Boolean),
    events: safeEvents
      .map(event => (typeof event.id === 'string' ? event.id : ''))
      .filter(Boolean),
    rsvps: Object.fromEntries(
      safeEvents
        .map(event => {
          const eventId = typeof event.id === 'string' ? event.id : '';
          if (!eventId) {
            return null;
          }
          return [
            eventId,
            {
              yes: (event.rsvps?.yes ?? []).map(normalizeActivityActor).filter(Boolean),
              no: (event.rsvps?.no ?? []).map(normalizeActivityActor).filter(Boolean),
              maybe: (event.rsvps?.maybe ?? []).map(normalizeActivityActor).filter(Boolean),
            },
          ] as const;
        })
        .filter((entry): entry is readonly [string, { yes: string[]; no: string[]; maybe: string[] }] => Boolean(entry))
    ),
    attendees: Object.fromEntries(
      safeEvents
        .map(event => {
          const eventId = typeof event.id === 'string' ? event.id : '';
          if (!eventId) {
            return null;
          }
          return [
            eventId,
            (event.attendees ?? []).map(normalizeActivityActor).filter(Boolean),
          ] as const;
        })
        .filter((entry): entry is readonly [string, string[]] => Boolean(entry))
    ),
  };
};

export const getNotificationActivityByKey = ({
  announcements,
  socialPosts,
  allMessages,
  groupChats,
  events,
  galleryImages,
  forms,
  user,
  role,
  loading,
}: {
  announcements: Announcement[];
  socialPosts: SocialPost[];
  allMessages: Record<string, Message[]>;
  groupChats: GroupChat[];
  events: ClubEvent[];
  galleryImages: GalleryImage[];
  forms: ClubForm[];
  user: Pick<User, 'email' | 'name'> | null;
  role: string | null;
  loading: boolean;
}): Record<NotificationKey, number> => {
  if (loading || !user) {
    return createEmptyNotificationActivity();
  }

  const safeAnnouncements = Array.isArray(announcements) ? announcements : [];
  const safeSocialPosts = Array.isArray(socialPosts) ? socialPosts : [];
  const safeEvents = Array.isArray(events) ? events : [];
  const safeGalleryImages = Array.isArray(galleryImages) ? galleryImages : [];
  const safeGroupChats = normalizeGroupChats(groupChats);
  const safeAllMessages = normalizeMessageMap(allMessages);
  const safeForms = Array.isArray(forms) ? forms : [];
  const currentUserEmail = normalizeActivityActor(user.email);
  const currentUserName = normalizeActivityActor(user.name);
  const isCurrentUserActor = (actor?: string | null) => {
    const normalizedActor = normalizeActivityActor(actor);
    if (!normalizedActor) return false;
    return normalizedActor === currentUserEmail || normalizedActor === currentUserName;
  };

  const latestAnnouncementTimestamp = safeAnnouncements.reduce((latest: number, announcement: Announcement) => {
    if (isCurrentUserActor(announcement.author) || viewedByCurrentUser(announcement.viewedBy, currentUserEmail)) {
      return latest;
    }
    return Math.max(latest, getActivityTimestamp(announcement.date));
  }, 0);
  const latestSocialTimestamp = safeSocialPosts.reduce((latest: number, post: SocialPost) => {
    if (isCurrentUserActor(post.author)) {
      return latest;
    }
    return Math.max(latest, getActivityTimestamp(post.date));
  }, 0);
  const latestDmTimestamp = Object.values(safeAllMessages)
    .flat()
    .filter((message: Message) => !isMessageFromActor(message, currentUserEmail))
    .reduce((latest, message) => {
      if (messageIncludesReader(message, currentUserEmail)) {
        return latest;
      }
      return Math.max(latest, getActivityTimestamp(message.timestamp));
    }, 0);
  const latestGroupTimestamp = safeGroupChats.reduce((latestChatTimestamp: number, chat: GroupChat) => {
    const chatLatest = chat.messages
      .filter(message => !isMessageFromActor(message, currentUserEmail))
      .reduce((latestMessageTimestamp, message) => {
        if (messageIncludesReader(message, currentUserEmail)) {
          return latestMessageTimestamp;
        }
        return Math.max(latestMessageTimestamp, getActivityTimestamp(message.timestamp));
      }, 0);
    return Math.max(latestChatTimestamp, chatLatest);
  }, 0);
  const latestMessageTimestamp = Math.max(latestDmTimestamp, latestGroupTimestamp);
  const latestEventTimestamp = safeEvents.reduce((latest: number, event: ClubEvent) => {
    if (viewedByCurrentUser(event.viewedBy, currentUserEmail)) {
      return latest;
    }
    return Math.max(latest, getActivityTimestamp(event.date));
  }, 0);
  const latestGalleryTimestamp = safeGalleryImages.reduce((latest: number, image: GalleryImage) => {
    if (isCurrentUserActor(image.author)) {
      return latest;
    }
    return Math.max(latest, getActivityTimestamp(image.date));
  }, 0);
  const latestFormTimestamp = safeForms.reduce((latest: number, form: ClubForm) => {
    const createdAt =
      !isCurrentUserActor(form.createdBy) && !viewedByCurrentUser(form.viewedBy, currentUserEmail)
        ? getActivityTimestamp(form.createdAt)
        : 0;
    const latestResponse = form.responses.reduce((responseLatest, response) => {
      if (normalizeActivityActor(response.respondentEmail) === currentUserEmail) {
        return responseLatest;
      }
      return Math.max(responseLatest, getActivityTimestamp(response.submittedAt));
    }, 0);
    return Math.max(latest, createdAt, latestResponse);
  }, 0);
  const attendanceActivity =
    role === 'Admin'
      ? safeEvents.reduce(
          (count, event) =>
            count +
            (Array.isArray(event.attendees)
              ? event.attendees.filter(email => normalizeActivityActor(email) !== currentUserEmail).length
              : 0),
          0
        )
      : 0;

  return {
    announcements: latestAnnouncementTimestamp,
    social: latestSocialTimestamp,
    messages: latestMessageTimestamp,
    calendar: latestEventTimestamp,
    gallery: latestGalleryTimestamp,
    forms: latestFormTimestamp,
    attendance: attendanceActivity,
  };
};

export const getUnreadNotifications = ({
  activityByKey,
  tabLastViewed,
  loading,
  user,
  role,
}: {
  activityByKey: Record<NotificationKey, number>;
  tabLastViewed: Record<NotificationKey, number>;
  loading: boolean;
  user: Pick<User, 'email' | 'name'> | null;
  role: string | null;
}): Record<NotificationKey, boolean> => {
  if (loading || !user) {
    return createEmptyUnreadNotifications();
  }

  return {
    announcements: activityByKey.announcements > tabLastViewed.announcements,
    social: activityByKey.social > tabLastViewed.social,
    messages: activityByKey.messages > tabLastViewed.messages,
    calendar: activityByKey.calendar > tabLastViewed.calendar,
    gallery: activityByKey.gallery > tabLastViewed.gallery,
    forms: activityByKey.forms > tabLastViewed.forms,
    attendance: role === 'Admin' && activityByKey.attendance > tabLastViewed.attendance,
  };
};
