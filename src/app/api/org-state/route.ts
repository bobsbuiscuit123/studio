import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createDashboardLogger,
  createDashboardRequestId,
  DASHBOARD_TIMEOUT_MS,
  withTimeout,
} from '@/lib/dashboard-load';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';
import { canEditGroupContent, canManageGroupRoles, displayGroupRole, normalizeGroupRole } from '@/lib/group-permissions';
import { sendPushToUsers } from '@/lib/send-push';
import { stableSerialize } from '@/lib/stable-serialize';
import { getDefaultOrgState } from '@/lib/org-state';
import { getPlaceholderImageUrl } from '@/lib/placeholders';
import { ensureOrgOwnerGroupMembership } from '@/lib/group-access';

export const dynamic = 'force-dynamic';
const apiLogger = createDashboardLogger('[Dashboard][API]');
const getRequestId = (request: Request) =>
  request.headers.get('x-request-id') || createDashboardRequestId('org-state');
const getErrorStatus = (error: unknown) =>
  error instanceof Error && error.name === 'TimeoutError' ? 504 : 500;
const getErrorCode = (error: unknown) =>
  error instanceof Error && error.name === 'TimeoutError' ? 'NETWORK_TIMEOUT' : 'NETWORK_HTTP_ERROR';

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const uniqueStrings = (values: unknown[]) =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map(value => value.trim())
    )
  );

const getMessageKey = (message: Record<string, any>) => {
  const sender = typeof message.sender === 'string' ? normalizeEmail(message.sender) : '';
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const timestamp = typeof message.timestamp === 'string' ? message.timestamp : '';
  if (!sender || !text || !timestamp) return '';
  return `${sender}__${timestamp}__${text}`;
};

const normalizeMessage = (message: Record<string, any>) => ({
  ...message,
  sender: typeof message.sender === 'string' ? message.sender.trim() : '',
  text: typeof message.text === 'string' ? message.text.trim() : '',
  timestamp: typeof message.timestamp === 'string' ? message.timestamp : '',
  readBy: uniqueStrings(Array.isArray(message.readBy) ? message.readBy : []).map(normalizeEmail),
});

const mergeMessageLists = (currentMessages: unknown, nextMessages: unknown) => {
  const currentList = Array.isArray(currentMessages) ? currentMessages : [];
  const nextList = Array.isArray(nextMessages) ? nextMessages : [];
  const mergedByKey = new Map<string, Record<string, any>>();

  const ingest = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    const normalized = normalizeMessage(item as Record<string, any>);
    const key = getMessageKey(normalized);
    if (!key) return;
    const existing = mergedByKey.get(key);
    if (!existing) {
      mergedByKey.set(key, normalized);
      return;
    }
    mergedByKey.set(key, {
      ...existing,
      ...normalized,
      readBy: uniqueStrings([
        ...(Array.isArray(existing.readBy) ? existing.readBy : []),
        ...(Array.isArray(normalized.readBy) ? normalized.readBy : []),
      ]).map(normalizeEmail),
    });
  };

  currentList.forEach(ingest);
  nextList.forEach(ingest);

  return Array.from(mergedByKey.values()).sort((left, right) => {
    const leftTime = new Date(left.timestamp).getTime();
    const rightTime = new Date(right.timestamp).getTime();
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return getMessageKey(left).localeCompare(getMessageKey(right));
  });
};

const mergeDirectMessages = (currentMessages: unknown, nextMessages: unknown) => {
  const currentMap =
    currentMessages && typeof currentMessages === 'object' ? (currentMessages as Record<string, unknown>) : {};
  const nextMap =
    nextMessages && typeof nextMessages === 'object' ? (nextMessages as Record<string, unknown>) : {};
  const merged: Record<string, ReturnType<typeof mergeMessageLists>> = {};
  const keys = Array.from(new Set([...Object.keys(currentMap), ...Object.keys(nextMap)]));

  keys.forEach(key => {
    merged[key] = mergeMessageLists(currentMap[key], nextMap[key]);
  });

  return merged;
};

const mergeGroupChats = (currentChats: unknown, nextChats: unknown) => {
  const currentList = Array.isArray(currentChats) ? currentChats : [];
  const nextList = Array.isArray(nextChats) ? nextChats : [];
  const currentById = new Map<string, Record<string, any>>();
  const nextById = new Map<string, Record<string, any>>();

  currentList.forEach(chat => {
    if (!chat || typeof chat !== 'object' || typeof (chat as { id?: unknown }).id !== 'string') return;
    currentById.set((chat as { id: string }).id, chat as Record<string, any>);
  });
  nextList.forEach(chat => {
    if (!chat || typeof chat !== 'object' || typeof (chat as { id?: unknown }).id !== 'string') return;
    nextById.set((chat as { id: string }).id, chat as Record<string, any>);
  });

  const orderedIds = [
    ...nextList
      .map(chat => (chat && typeof chat === 'object' && typeof (chat as { id?: unknown }).id === 'string'
        ? (chat as { id: string }).id
        : ''))
      .filter(Boolean),
    ...currentList
      .map(chat => (chat && typeof chat === 'object' && typeof (chat as { id?: unknown }).id === 'string'
        ? (chat as { id: string }).id
        : ''))
      .filter(Boolean),
  ];

  return Array.from(new Set(orderedIds)).map(chatId => {
    const currentChat = currentById.get(chatId) ?? {};
    const nextChat = nextById.get(chatId) ?? {};
    const currentMembers = uniqueStrings(Array.isArray(currentChat.members) ? currentChat.members : []);
    const nextMembers = uniqueStrings(Array.isArray(nextChat.members) ? nextChat.members : []);

    return {
      ...currentChat,
      ...nextChat,
      id: chatId,
      name:
        (typeof nextChat.name === 'string' && nextChat.name.trim()) ||
        (typeof currentChat.name === 'string' && currentChat.name.trim()) ||
        'Group chat',
      members: uniqueStrings([...currentMembers, ...nextMembers]),
      messages: mergeMessageLists(currentChat.messages, nextChat.messages),
    };
  });
};

const normalizeAttendanceRecords = (value: unknown) => {
  if (!Array.isArray(value)) return [];

  const byEmail = new Map<string, { email: string; checkedInAt: string }>();
  value.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const email =
      typeof (item as { email?: unknown }).email === 'string'
        ? normalizeEmail((item as { email: string }).email)
        : '';
    const checkedInAt =
      typeof (item as { checkedInAt?: unknown }).checkedInAt === 'string'
        ? (item as { checkedInAt: string }).checkedInAt
        : '';
    if (!email || !checkedInAt) return;

    const existing = byEmail.get(email);
    if (!existing || checkedInAt > existing.checkedInAt) {
      byEmail.set(email, { email, checkedInAt });
    }
  });

  return Array.from(byEmail.values()).sort((left, right) =>
    left.email.localeCompare(right.email)
  );
};

const mergeAnnouncements = (
  currentAnnouncements: unknown,
  nextAnnouncements: unknown,
  deletedAnnouncementIds: Set<string>,
  actorEmail?: string | null
) => {
  const currentList = Array.isArray(currentAnnouncements) ? currentAnnouncements : [];
  const nextList = Array.isArray(nextAnnouncements) ? nextAnnouncements : [];
  const currentById = new Map<string, Record<string, any>>();
  const nextById = new Map<string, Record<string, any>>();
  const normalizedActorEmail = actorEmail ? normalizeEmail(actorEmail) : '';

  currentList.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const idValue = (item as { id?: unknown }).id;
    const announcementId =
      typeof idValue === 'string' || typeof idValue === 'number' ? String(idValue) : '';
    if (!announcementId) return;
    currentById.set(announcementId, item as Record<string, any>);
  });

  nextList.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const announcementId = getAnnouncementId(item as Record<string, unknown>);
    if (!announcementId) return;
    nextById.set(announcementId, item as Record<string, any>);
  });

  const orderedIds = [
    ...nextList
      .map(item => (item && typeof item === 'object' ? getAnnouncementId(item as Record<string, unknown>) : ''))
      .filter(Boolean),
    ...currentList
      .map(item => (item && typeof item === 'object' ? getAnnouncementId(item as Record<string, unknown>) : ''))
      .filter(Boolean),
  ];

  return Array.from(new Set(orderedIds)).flatMap(announcementId => {
    const currentAnnouncement = currentById.get(announcementId);
    const nextAnnouncement = nextById.get(announcementId);
    if (!nextAnnouncement) {
      if (!currentAnnouncement || deletedAnnouncementIds.has(announcementId)) {
        return [];
      }
      return [currentAnnouncement];
    }
    if (!currentAnnouncement) {
      return [nextAnnouncement];
    }

    const currentViewed = uniqueStrings(
      Array.isArray(currentAnnouncement.viewedBy) ? currentAnnouncement.viewedBy : []
    ).map(normalizeEmail);
    const nextViewed = uniqueStrings(
      Array.isArray(nextAnnouncement.viewedBy) ? nextAnnouncement.viewedBy : []
    ).map(normalizeEmail);

    const mergedViewed = uniqueStrings([...currentViewed, ...nextViewed]).map(normalizeEmail);
    if (normalizedActorEmail && !mergedViewed.includes(normalizedActorEmail)) {
      mergedViewed.push(normalizedActorEmail);
    }

    return [{
      ...currentAnnouncement,
      ...nextAnnouncement,
      viewedBy: mergedViewed,
      read: Boolean(nextAnnouncement.read) || Boolean(currentAnnouncement.read) || Boolean(normalizedActorEmail),
    }];
  });
};

const mergeEvents = (
  currentEvents: unknown,
  nextEvents: unknown,
  deletedEventIds: Set<string>,
  actorEmail?: string | null
) => {
  const currentList = Array.isArray(currentEvents) ? currentEvents : [];
  const nextList = Array.isArray(nextEvents) ? nextEvents : [];
  const currentById = new Map<string, Record<string, any>>();
  const nextById = new Map<string, Record<string, any>>();
  const normalizedActorEmail = actorEmail ? normalizeEmail(actorEmail) : '';

  currentList.forEach(event => {
    if (!event || typeof event !== 'object') return;
    const eventId = typeof (event as { id?: unknown }).id === 'string' ? (event as { id: string }).id : '';
    if (!eventId) return;
    currentById.set(eventId, event as Record<string, any>);
  });

  nextList.forEach(event => {
    if (!event || typeof event !== 'object') return;
    const eventId = getEventId(event as Record<string, unknown>);
    if (!eventId) return;
    nextById.set(eventId, event as Record<string, any>);
  });

  const orderedIds = [
    ...nextList
      .map(event => (event && typeof event === 'object' ? getEventId(event as Record<string, unknown>) : ''))
      .filter(Boolean),
    ...currentList
      .map(event => (event && typeof event === 'object' ? getEventId(event as Record<string, unknown>) : ''))
      .filter(Boolean),
  ];

  return Array.from(new Set(orderedIds)).flatMap(eventId => {
    const currentEvent = currentById.get(eventId);
    const nextEvent = nextById.get(eventId);
    if (!nextEvent) {
      if (!currentEvent || deletedEventIds.has(eventId)) {
        return [];
      }
      return [currentEvent];
    }
    if (!currentEvent) {
      return [nextEvent];
    }

    const currentViewed = uniqueStrings(Array.isArray(currentEvent.viewedBy) ? currentEvent.viewedBy : []);
    const nextViewed = uniqueStrings(Array.isArray(nextEvent.viewedBy) ? nextEvent.viewedBy : []);
    const currentAttendees = uniqueStrings(Array.isArray(currentEvent.attendees) ? currentEvent.attendees : []);
    const nextAttendees = uniqueStrings(Array.isArray(nextEvent.attendees) ? nextEvent.attendees : []);
    const mergedAttendanceRecords = normalizeAttendanceRecords([
      ...normalizeAttendanceRecords(currentEvent.attendanceRecords),
      ...normalizeAttendanceRecords(nextEvent.attendanceRecords),
    ]);
    const mergedAttendees = uniqueStrings([
      ...currentAttendees,
      ...nextAttendees,
      ...mergedAttendanceRecords.map(record => record.email),
    ]);

    const currentRsvps = currentEvent.rsvps && typeof currentEvent.rsvps === 'object' ? currentEvent.rsvps : {};
    const nextRsvps = nextEvent.rsvps && typeof nextEvent.rsvps === 'object' ? nextEvent.rsvps : {};

    const currentYes = uniqueStrings(Array.isArray(currentRsvps.yes) ? currentRsvps.yes : []).map(normalizeEmail);
    const currentNo = uniqueStrings(Array.isArray(currentRsvps.no) ? currentRsvps.no : []).map(normalizeEmail);
    const currentMaybe = uniqueStrings(Array.isArray(currentRsvps.maybe) ? currentRsvps.maybe : []).map(normalizeEmail);
    const nextYes = uniqueStrings(Array.isArray(nextRsvps.yes) ? nextRsvps.yes : []).map(normalizeEmail);
    const nextNo = uniqueStrings(Array.isArray(nextRsvps.no) ? nextRsvps.no : []).map(normalizeEmail);
    const nextMaybe = uniqueStrings(Array.isArray(nextRsvps.maybe) ? nextRsvps.maybe : []).map(normalizeEmail);

    const actorRsvp =
      normalizedActorEmail && nextYes.includes(normalizedActorEmail)
        ? 'yes'
        : normalizedActorEmail && nextNo.includes(normalizedActorEmail)
          ? 'no'
          : normalizedActorEmail && nextMaybe.includes(normalizedActorEmail)
            ? 'maybe'
            : null;

    const baseYes = uniqueStrings([...currentYes, ...nextYes]).map(normalizeEmail);
    const baseNo = uniqueStrings([...currentNo, ...nextNo]).map(normalizeEmail);
    const baseMaybe = uniqueStrings([...currentMaybe, ...nextMaybe]).map(normalizeEmail);

    const withoutActor = (values: string[]) =>
      normalizedActorEmail ? values.filter(email => email !== normalizedActorEmail) : values;

    const mergedYes = withoutActor(baseYes);
    const mergedNo = withoutActor(baseNo).filter(email => !mergedYes.includes(email));
    const mergedMaybe = withoutActor(baseMaybe).filter(
      email => !mergedYes.includes(email) && !mergedNo.includes(email)
    );

    if (normalizedActorEmail && actorRsvp === 'yes') {
      mergedYes.push(normalizedActorEmail);
    } else if (normalizedActorEmail && actorRsvp === 'no') {
      mergedNo.push(normalizedActorEmail);
    } else if (normalizedActorEmail && actorRsvp === 'maybe') {
      mergedMaybe.push(normalizedActorEmail);
    }

    return [{
      ...currentEvent,
      ...nextEvent,
      viewedBy: uniqueStrings([...currentViewed, ...nextViewed]),
      attendees: mergedAttendees,
      attendanceRecords: mergedAttendanceRecords,
      rsvps: {
        yes: mergedYes,
        no: mergedNo,
        maybe: mergedMaybe,
      },
      read: Boolean(nextEvent.read) || Boolean(currentEvent.read),
      lastViewedAttendees:
        typeof nextEvent.lastViewedAttendees === 'number'
          ? nextEvent.lastViewedAttendees
          : currentEvent.lastViewedAttendees,
    }];
  });
};

const getGalleryImageId = (item: Record<string, unknown>) => {
  const value = item.id;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

const normalizeGalleryImageStatus = (image: Record<string, any>) => ({
  ...image,
  status: 'approved' as const,
});

const stripHeavyMediaFromOrgState = (data: unknown) => {
  if (!data || typeof data !== 'object') return data;
  const source = data as Record<string, any>;
  return {
    ...source,
    galleryImages: Array.isArray(source.galleryImages)
      ? source.galleryImages.map(image => {
          if (!image || typeof image !== 'object') return image;
          const { src: _src, ...rest } = image as Record<string, unknown>;
          return rest;
        })
      : source.galleryImages,
  };
};

const mergeGalleryImages = (
  currentGalleryImages: unknown,
  nextGalleryImages: unknown,
  deletedGalleryImageIds: Set<string>,
  actorEmail?: string | null
) => {
  const currentList = Array.isArray(currentGalleryImages) ? currentGalleryImages : [];
  const nextList = Array.isArray(nextGalleryImages) ? nextGalleryImages : [];
  const currentById = new Map<string, Record<string, any>>();
  const nextById = new Map<string, Record<string, any>>();
  const normalizedActorEmail = actorEmail ? normalizeEmail(actorEmail) : '';

  currentList.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const imageId = getGalleryImageId(item as Record<string, unknown>);
    if (!imageId) return;
    currentById.set(imageId, item as Record<string, any>);
  });

  nextList.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const imageId = getGalleryImageId(item as Record<string, unknown>);
    if (!imageId) return;
    nextById.set(imageId, item as Record<string, any>);
  });

  const orderedIds = [
    ...nextList
      .map(item => (item && typeof item === 'object' ? getGalleryImageId(item as Record<string, unknown>) : ''))
      .filter(Boolean),
    ...currentList
      .map(item => (item && typeof item === 'object' ? getGalleryImageId(item as Record<string, unknown>) : ''))
      .filter(Boolean),
  ];

  return Array.from(new Set(orderedIds)).flatMap(imageId => {
    const currentImage = currentById.get(imageId);
    const nextImage = nextById.get(imageId);
    if (!nextImage) {
      if (!currentImage || deletedGalleryImageIds.has(imageId)) {
        return [];
      }
      return [normalizeGalleryImageStatus(currentImage)];
    }
    if (!currentImage) {
      const nextLikedBy = uniqueStrings(Array.isArray(nextImage.likedBy) ? nextImage.likedBy : []).map(normalizeEmail);
      return [{
        ...normalizeGalleryImageStatus(nextImage),
        likedBy: nextLikedBy,
        likes: nextLikedBy.length > 0 ? nextLikedBy.length : Math.max(0, Number(nextImage.likes) || 0),
      }];
    }

    const currentLikedBy = uniqueStrings(Array.isArray(currentImage.likedBy) ? currentImage.likedBy : []).map(normalizeEmail);
    const nextLikedBy = uniqueStrings(Array.isArray(nextImage.likedBy) ? nextImage.likedBy : []).map(normalizeEmail);
    const actorLiked = normalizedActorEmail ? nextLikedBy.includes(normalizedActorEmail) : null;

    let mergedLikedBy = uniqueStrings([...currentLikedBy, ...nextLikedBy]).map(normalizeEmail);
    if (normalizedActorEmail) {
      mergedLikedBy = mergedLikedBy.filter(email => email !== normalizedActorEmail);
      if (actorLiked) {
        mergedLikedBy.push(normalizedActorEmail);
      }
    }

    return [{
      ...normalizeGalleryImageStatus(currentImage),
      ...normalizeGalleryImageStatus(nextImage),
      src:
        typeof nextImage.src === 'string' && nextImage.src
          ? nextImage.src
          : currentImage.src,
      likedBy: mergedLikedBy,
      likes: mergedLikedBy.length,
      read: Boolean(nextImage.read) || Boolean(currentImage.read),
    }];
  });
};

const stripCollaborativeEventFields = (events: unknown) => {
  if (!Array.isArray(events)) return [];

  return events.map(event => {
    if (!event || typeof event !== 'object') return event;

    const {
      viewedBy: _viewedBy,
      attendees: _attendees,
      attendanceRecords: _attendanceRecords,
      rsvps: _rsvps,
      read: _read,
      lastViewedAttendees: _lastViewedAttendees,
      ...rest
    } = event as Record<string, unknown>;

    return rest;
  });
};

const stripCollaborativeAnnouncementFields = (announcements: unknown) => {
  if (!Array.isArray(announcements)) return [];

  return announcements.map(item => {
    if (!item || typeof item !== 'object') return item;

    const {
      viewedBy: _viewedBy,
      read: _read,
      ...rest
    } = item as Record<string, unknown>;

    return rest;
  });
};

const stripCollaborativeFormFields = (forms: unknown) => {
  if (!Array.isArray(forms)) return [];

  return forms.map(item => {
    if (!item || typeof item !== 'object') return item;

    const {
      viewedBy: _viewedBy,
      responses: _responses,
      ...rest
    } = item as Record<string, unknown>;

    return rest;
  });
};

const getRequestIp = (headerList: Headers) =>
  headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  headerList.get('x-real-ip') ||
  'unknown';

const getCollectionCount = (value: unknown) => (Array.isArray(value) ? value.length : 0);

const stripEventPushFields = (event: unknown) => {
  if (!event || typeof event !== 'object') return event;

  const {
    viewedBy: _viewedBy,
    attendees: _attendees,
    rsvps: _rsvps,
    read: _read,
    lastViewedAttendees: _lastViewedAttendees,
    ...rest
  } = event as Record<string, unknown>;

  return rest;
};

const getStateMemberEmails = (data: Record<string, any>) =>
  Array.from(
    new Set(
      (Array.isArray(data.members) ? data.members : [])
        .map(member => (typeof member?.email === 'string' ? member.email.trim().toLowerCase() : ''))
        .filter(Boolean)
    )
  );

const getMessagePreview = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return 'Open Caspo to view the latest message.';
  return text.length > 120 ? `${text.slice(0, 117).trimEnd()}...` : text;
};

const getAnnouncementId = (item: Record<string, unknown>) => {
  const value = item.id;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

const getEventId = (item: Record<string, unknown>) => {
  return typeof item.id === 'string' ? item.id : '';
};

const getFormId = (item: Record<string, unknown>) => {
  const value = item.id;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

const toDeletedIdSet = (ids: unknown) =>
  new Set(
    (Array.isArray(ids) ? ids : [])
      .map(value =>
        typeof value === 'string' || typeof value === 'number' ? String(value) : ''
      )
      .filter(Boolean)
  );

const resolveUserIdsByEmails = async (
  admin: ReturnType<typeof createSupabaseAdmin>,
  orgId: string,
  groupId: string,
  emails: string[],
  actorId: string
) => {
  const normalizedEmails = Array.from(
    new Set(emails.map(email => email.trim().toLowerCase()).filter(Boolean))
  );
  if (normalizedEmails.length === 0) return [];

  const { data: memberships, error: membershipsError } = await admin
    .from('group_memberships')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('group_id', groupId);

  if (membershipsError) {
    throw membershipsError;
  }

  const candidateUserIds = Array.from(
    new Set(
      (memberships ?? [])
        .map(row => row.user_id)
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0 && value !== actorId
        )
    )
  );
  if (candidateUserIds.length === 0) return [];

  const { data, error } = await admin
    .from('profiles')
    .select('id, email')
    .in('id', candidateUserIds);

  if (error) {
    throw error;
  }

  return Array.from(
    new Set(
      (data ?? [])
        .filter(profile => {
          const email = typeof profile.email === 'string' ? normalizeEmail(profile.email) : '';
          return Boolean(email) && normalizedEmails.includes(email);
        })
        .map(profile => profile.id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
  );
};

const resolveOrgMemberUserIds = async (
  admin: ReturnType<typeof createSupabaseAdmin>,
  orgId: string,
  actorId: string
) => {
  const { data, error } = await admin
    .from('memberships')
    .select('user_id')
    .eq('org_id', orgId);

  if (error) {
    throw error;
  }

  return Array.from(
    new Set(
      (data ?? [])
        .map(row => row.user_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0 && value !== actorId)
    )
  );
};

const resolveGroupMemberUserIds = async (
  admin: ReturnType<typeof createSupabaseAdmin>,
  orgId: string,
  groupId: string,
  actorId: string
) => {
  const { data, error } = await admin
    .from('group_memberships')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('group_id', groupId);

  if (error) {
    throw error;
  }

  return Array.from(
    new Set(
      (data ?? [])
        .map(row => row.user_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0 && value !== actorId)
    )
  );
};

const resolveDmParticipants = (conversationKey: string, memberEmails: string[]) => {
  for (let left = 0; left < memberEmails.length; left += 1) {
    for (let right = left + 1; right < memberEmails.length; right += 1) {
      const candidate = [memberEmails[left], memberEmails[right]].sort().join('_');
      if (candidate === conversationKey) {
        return [memberEmails[left], memberEmails[right]];
      }
    }
  }
  return [];
};

const collectMessagePushJobs = async ({
  admin,
  actorId,
  actorEmail,
  orgId,
  groupId,
  currentData,
  nextData,
}: {
  admin: ReturnType<typeof createSupabaseAdmin>;
  actorId: string;
  actorEmail: string;
  orgId: string;
  groupId: string;
  currentData: Record<string, any>;
  nextData: Record<string, any>;
}) => {
  const jobs: Array<Parameters<typeof sendPushToUsers>[0]> = [];
  const normalizedActorEmail = normalizeEmail(actorEmail);
  const memberEmails = getStateMemberEmails(nextData);
  const currentMessages = currentData.messages && typeof currentData.messages === 'object' ? currentData.messages : {};
  const nextMessages = nextData.messages && typeof nextData.messages === 'object' ? nextData.messages : {};

  for (const [conversationKey, nextListRaw] of Object.entries(nextMessages)) {
    const nextList = Array.isArray(nextListRaw) ? nextListRaw : [];
    const currentList = Array.isArray(currentMessages[conversationKey]) ? currentMessages[conversationKey] : [];
    if (nextList.length <= currentList.length) continue;

    const participants = resolveDmParticipants(conversationKey, memberEmails);
    if (participants.length !== 2) continue;

    const addedMessages = nextList.slice(currentList.length);
    for (const message of addedMessages) {
      if (!message || typeof message !== 'object') continue;
      const sender = typeof message.sender === 'string' ? normalizeEmail(message.sender) : '';
      if (!sender || sender !== normalizedActorEmail) continue;
      const recipientEmail = participants.find(email => email !== sender);
      if (!recipientEmail) continue;
      const recipientIds = await resolveUserIdsByEmails(
        admin,
        orgId,
        groupId,
        [recipientEmail],
        actorId
      );
      if (recipientIds.length === 0) continue;
      const threadId = `dm__${encodeURIComponent(sender)}`;
      jobs.push({
        userIds: recipientIds,
        title: 'New message',
        body: getMessagePreview((message as { text?: unknown }).text),
        route: `/messages/${threadId}`,
        params: { threadId },
        type: 'message',
        entityId: threadId,
      });
    }
  }

  const currentGroupChats = Array.isArray(currentData.groupChats) ? currentData.groupChats : [];
  const nextGroupChats = Array.isArray(nextData.groupChats) ? nextData.groupChats : [];
  const currentGroupMap = new Map<string, Record<string, any>>();
  currentGroupChats.forEach(chat => {
    if (chat && typeof chat === 'object' && typeof chat.id === 'string') {
      currentGroupMap.set(chat.id, chat);
    }
  });

  for (const chat of nextGroupChats) {
    if (!chat || typeof chat !== 'object' || typeof chat.id !== 'string') continue;
    const currentChat = currentGroupMap.get(chat.id) ?? {};
    const currentList = Array.isArray(currentChat.messages) ? currentChat.messages : [];
    const nextList = Array.isArray(chat.messages) ? chat.messages : [];
    if (nextList.length <= currentList.length) continue;

    const groupMembers = Array.isArray(chat.members)
      ? chat.members
          .map((member: unknown) => (typeof member === 'string' ? normalizeEmail(member) : ''))
          .filter(Boolean)
      : [];
    const addedMessages = nextList.slice(currentList.length);
    for (const message of addedMessages) {
      if (!message || typeof message !== 'object') continue;
      const sender = typeof message.sender === 'string' ? normalizeEmail(message.sender) : '';
      if (!sender || sender !== normalizedActorEmail) continue;
      const recipientEmails = groupMembers.filter((email: string) => email !== sender);
      const recipientIds = await resolveUserIdsByEmails(
        admin,
        orgId,
        groupId,
        recipientEmails,
        actorId
      );
      if (recipientIds.length === 0) continue;
      const threadId = `group__${encodeURIComponent(chat.id)}`;
      jobs.push({
        userIds: recipientIds,
        title: 'New message',
        body: getMessagePreview((message as { text?: unknown }).text),
        route: `/messages/${threadId}`,
        params: { threadId },
        type: 'message',
        entityId: threadId,
      });
    }
  }

  return jobs;
};

const collectAnnouncementPushJobs = async ({
  admin,
  actorId,
  orgId,
  currentData,
  nextData,
}: {
  admin: ReturnType<typeof createSupabaseAdmin>;
  actorId: string;
  orgId: string;
  currentData: Record<string, any>;
  nextData: Record<string, any>;
}) => {
  const jobs: Array<Parameters<typeof sendPushToUsers>[0]> = [];
  const currentAnnouncements = Array.isArray(currentData.announcements) ? currentData.announcements : [];
  const nextAnnouncements = Array.isArray(nextData.announcements) ? nextData.announcements : [];
  const currentIds = new Set(
    currentAnnouncements
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map(getAnnouncementId)
      .filter(Boolean)
  );
  const recipientIds = await resolveOrgMemberUserIds(admin, orgId, actorId);
  if (recipientIds.length === 0) return jobs;

  nextAnnouncements.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const announcementId = getAnnouncementId(item);
    if (!announcementId || currentIds.has(announcementId)) return;
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'New announcement';
    jobs.push({
      userIds: recipientIds,
      title: 'New announcement',
      body: title,
      route: `/announcements?announcementId=${encodeURIComponent(announcementId)}`,
      params: { announcementId },
      type: 'announcement',
      entityId: announcementId,
    });
  });

  return jobs;
};

const collectEventPushJobs = async ({
  admin,
  actorId,
  orgId,
  groupId,
  currentData,
  nextData,
}: {
  admin: ReturnType<typeof createSupabaseAdmin>;
  actorId: string;
  orgId: string;
  groupId: string;
  currentData: Record<string, any>;
  nextData: Record<string, any>;
}) => {
  const jobs: Array<Parameters<typeof sendPushToUsers>[0]> = [];
  const currentEvents = Array.isArray(currentData.events) ? currentData.events : [];
  const nextEvents = Array.isArray(nextData.events) ? nextData.events : [];
  const currentById = new Map<string, Record<string, unknown>>();

  currentEvents.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const eventId = getEventId(item);
    if (!eventId) return;
    currentById.set(eventId, item);
  });

  const recipientIds = await resolveGroupMemberUserIds(admin, orgId, groupId, actorId);
  if (recipientIds.length === 0) return jobs;

  nextEvents.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const eventId = getEventId(item);
    if (!eventId) return;
    const currentEvent = currentById.get(eventId);
    const changed =
      !currentEvent ||
      stableSerialize(stripEventPushFields(currentEvent)) !== stableSerialize(stripEventPushFields(item));
    if (!changed) return;

    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'Event update';
    jobs.push({
      userIds: recipientIds,
      title: 'Event update',
      body: title,
      route: `/calendar?eventId=${encodeURIComponent(eventId)}`,
      params: { eventId },
      type: 'event',
      entityId: eventId,
    });
  });

  return jobs;
};

const collectFormPushJobs = async ({
  admin,
  actorId,
  orgId,
  groupId,
  currentData,
  nextData,
}: {
  admin: ReturnType<typeof createSupabaseAdmin>;
  actorId: string;
  orgId: string;
  groupId: string;
  currentData: Record<string, any>;
  nextData: Record<string, any>;
}) => {
  const jobs: Array<Parameters<typeof sendPushToUsers>[0]> = [];
  const currentForms = Array.isArray(currentData.forms) ? currentData.forms : [];
  const nextForms = Array.isArray(nextData.forms) ? nextData.forms : [];
  const currentIds = new Set(
    currentForms
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map(getFormId)
      .filter(Boolean)
  );

  const recipientIds = await resolveGroupMemberUserIds(admin, orgId, groupId, actorId);
  if (recipientIds.length === 0) return jobs;

  nextForms.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const formId = getFormId(item);
    if (!formId || currentIds.has(formId)) return;
    const formTitle = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'Open Caspo to fill it out.';
    jobs.push({
      userIds: recipientIds,
      title: 'New form',
      body: formTitle,
      route: `/forms?formId=${encodeURIComponent(formId)}`,
      params: { formId },
      type: 'form',
      entityId: formId,
    });
  });

  return jobs;
};

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const ip = getRequestIp(request.headers);
  const limiter = rateLimit(`org-state:${ip}`, 60, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many requests. Please slow down.',
        source: 'network',
      }),
      { status: 429, headers: getRateLimitHeaders(limiter) }
    );
  }

  const url = new URL(request.url);
  const includeMedia = url.searchParams.get('media') === '1';
  const schema = z.object({
    orgId: z.string().uuid(),
    groupId: z.string().uuid(),
  }).strict();
  const parsed = schema.safeParse({
    orgId: url.searchParams.get('orgId'),
    groupId: url.searchParams.get('groupId'),
  });
  if (!parsed.success) {
    return NextResponse.json(
      err({
        code: 'VALIDATION',
        message: 'Invalid org payload.',
        source: 'app',
      }),
      { status: 400, headers: getRateLimitHeaders(limiter) }
    );
  }

  apiLogger.log('Org state load start', {
    groupId: parsed.data.groupId,
    includeMedia,
    orgId: parsed.data.orgId,
    requestId,
  });

  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData } = await withTimeout(
      () => supabase.auth.getUser(),
      DASHBOARD_TIMEOUT_MS,
      { label: 'Org state auth lookup' }
    );
    if (!userData.user) {
      return NextResponse.json(
        err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
        { status: 401, headers: getRateLimitHeaders(limiter) }
      );
    }

    const userLimiter = rateLimit(`org-state-read-user:${userData.user.id}`, 180, 60_000);
    if (!userLimiter.allowed) {
      return NextResponse.json(
        err({
          code: 'NETWORK_HTTP_ERROR',
          message: 'Too many requests. Please slow down.',
          source: 'network',
        }),
        { status: 429, headers: getRateLimitHeaders(userLimiter) }
      );
    }

    const admin = createSupabaseAdmin();
    const accessResult = await withTimeout(
      () =>
        ensureOrgOwnerGroupMembership({
          admin,
          orgId: parsed.data.orgId,
          groupId: parsed.data.groupId,
          userId: userData.user.id,
        }),
      DASHBOARD_TIMEOUT_MS,
      { label: 'Org state membership lookup' }
    );
    if (!accessResult.ok) {
      return NextResponse.json(
        err({ code: 'VALIDATION', message: 'Access denied.', source: 'app' }),
        { status: 403, headers: getRateLimitHeaders(limiter) }
      );
    }

    const { data: existingState, error } = await withTimeout(
      () =>
        admin
          .from('group_state')
          .select('data')
          .eq('group_id', parsed.data.groupId)
          .eq('org_id', parsed.data.orgId)
          .maybeSingle(),
      DASHBOARD_TIMEOUT_MS,
      { label: 'Org state row lookup' }
    );

    if (error) {
      return NextResponse.json(
        err({
          code: 'NETWORK_HTTP_ERROR',
          message: error.message,
          source: 'network',
        }),
        { status: 500, headers: getRateLimitHeaders(limiter) }
      );
    }

    if (!existingState?.data) {
      apiLogger.warn('Org state missing row, attempting repair', {
        groupId: parsed.data.groupId,
        orgId: parsed.data.orgId,
        requestId,
        userId: userData.user.id,
      });

      const { data: membershipRows, error: membershipRowsError } = await withTimeout(
        () =>
          admin
            .from('group_memberships')
            .select('user_id, role')
            .eq('org_id', parsed.data.orgId)
            .eq('group_id', parsed.data.groupId),
        DASHBOARD_TIMEOUT_MS,
        { label: 'Org state repair membership lookup' }
      );

      if (membershipRowsError) {
        return NextResponse.json(
          err({
            code: 'NETWORK_HTTP_ERROR',
            message: membershipRowsError.message,
            source: 'network',
          }),
          { status: 500, headers: getRateLimitHeaders(limiter) }
        );
      }

      const memberIds = (membershipRows ?? [])
        .map(row => row.user_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0);

      const profileById = new Map<
        string,
        { email?: string | null; display_name?: string | null; avatar_url?: string | null }
      >();

      if (memberIds.length > 0) {
        const { data: profileRows, error: profileRowsError } = await withTimeout(
          () =>
            admin
              .from('profiles')
              .select('id, email, display_name, avatar_url')
              .in('id', memberIds),
          DASHBOARD_TIMEOUT_MS,
          { label: 'Org state repair profile lookup' }
        );

        if (profileRowsError) {
          return NextResponse.json(
            err({
              code: 'NETWORK_HTTP_ERROR',
              message: profileRowsError.message,
              source: 'network',
            }),
            { status: 500, headers: getRateLimitHeaders(limiter) }
          );
        }

        (profileRows ?? []).forEach(profile => {
          profileById.set(profile.id, {
            email: profile.email,
            display_name: profile.display_name,
            avatar_url: profile.avatar_url,
          });
        });
      }

      const repairedData = {
        ...getDefaultOrgState(),
        members: (membershipRows ?? []).map(row => {
          const profile = profileById.get(row.user_id);
          const name = profile?.display_name || profile?.email || 'Member';
          return {
            id: row.user_id,
            name,
            email: profile?.email || '',
            role: displayGroupRole(row.role),
            avatar: profile?.avatar_url || getPlaceholderImageUrl({ label: name.charAt(0) || 'M' }),
          };
        }),
      };

      const { error: repairError } = await withTimeout(
        () =>
          admin
            .from('group_state')
            .upsert(
              {
                org_id: parsed.data.orgId,
                group_id: parsed.data.groupId,
                data: repairedData,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'group_id' }
            ),
        DASHBOARD_TIMEOUT_MS,
        { label: 'Org state repair upsert' }
      );

      if (repairError) {
        return NextResponse.json(
          err({
            code: 'NETWORK_HTTP_ERROR',
            message: repairError.message,
            source: 'network',
          }),
          { status: 500, headers: getRateLimitHeaders(limiter) }
        );
      }

      apiLogger.log('Org state load success', {
        groupId: parsed.data.groupId,
        mode: 'repaired',
        orgId: parsed.data.orgId,
        requestId,
      });

      return NextResponse.json(
        { ok: true, data: includeMedia ? repairedData : stripHeavyMediaFromOrgState(repairedData) },
        { headers: getRateLimitHeaders(limiter) }
      );
    }

    apiLogger.log('Org state load success', {
      groupId: parsed.data.groupId,
      mode: 'existing',
      orgId: parsed.data.orgId,
      requestId,
    });

    return NextResponse.json(
      { ok: true, data: includeMedia ? existingState.data : stripHeavyMediaFromOrgState(existingState.data) },
      { headers: getRateLimitHeaders(limiter) }
    );
  } catch (error) {
    apiLogger.error('Org state load failed', error, {
      groupId: parsed.data.groupId,
      includeMedia,
      orgId: parsed.data.orgId,
      requestId,
    });
    return NextResponse.json(
      err({
        code: getErrorCode(error),
        message:
          error instanceof Error && error.message
            ? error.message
            : 'Group content could not be loaded.',
        source: 'network',
      }),
      { status: getErrorStatus(error), headers: getRateLimitHeaders(limiter) }
    );
  }
}

export async function POST(request: Request) {
  const returnMode = new URL(request.url).searchParams.get('return');
  const ip = getRequestIp(request.headers);
  const limiter = rateLimit(`org-state:${ip}`, 60, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many requests. Please slow down.',
        source: 'network',
      }),
      { status: 429, headers: getRateLimitHeaders(limiter) }
    );
  }

  const body = await request.json().catch(() => ({}));
  const schema = z.object({
    orgId: z.string().uuid(),
    groupId: z.string().uuid(),
    data: z.record(z.any()),
    deletedIds: z
      .object({
        announcements: z.array(z.string()).optional(),
        events: z.array(z.string()).optional(),
        galleryImages: z.array(z.string()).optional(),
      })
      .partial()
      .optional(),
  }).strict();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({
        code: 'VALIDATION',
        message: 'Invalid org payload.',
        source: 'app',
      }),
      { status: 400, headers: getRateLimitHeaders(limiter) }
    );
  }

  const violation = findPolicyViolation(parsed.data.data);
  if (violation) {
    return NextResponse.json(
      err({
        code: 'VALIDATION',
        message: policyErrorMessage,
        source: 'app',
        detail: `${violation.path}:${violation.match}`,
      }),
      { status: 400, headers: getRateLimitHeaders(limiter) }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401, headers: getRateLimitHeaders(limiter) }
    );
  }
  const userLimiter = rateLimit(`org-state-user:${userData.user.id}`, 120, 60_000);
  if (!userLimiter.allowed) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many requests. Please slow down.',
        source: 'network',
      }),
      { status: 429, headers: getRateLimitHeaders(userLimiter) }
    );
  }

  const admin = createSupabaseAdmin();
  const accessResult = await ensureOrgOwnerGroupMembership({
    admin,
    orgId: parsed.data.orgId,
    groupId: parsed.data.groupId,
    userId: userData.user.id,
  });
  if (!accessResult.ok) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Access denied.', source: 'app' }),
      { status: 403, headers: getRateLimitHeaders(limiter) }
    );
  }

  const { data: existingState } = await admin
    .from('group_state')
    .select('data')
    .eq('group_id', parsed.data.groupId)
    .eq('org_id', parsed.data.orgId)
    .maybeSingle();

  const currentData = (existingState?.data ?? {}) as Record<string, any>;
  const nextData = parsed.data.data as Record<string, any>;
  const deletedIds = parsed.data.deletedIds ?? {};
  const mergedData: Record<string, any> = {
    ...currentData,
    ...nextData,
    messages: mergeDirectMessages(currentData.messages, nextData.messages),
    groupChats: mergeGroupChats(currentData.groupChats, nextData.groupChats),
    announcements: mergeAnnouncements(
      currentData.announcements,
      nextData.announcements,
      toDeletedIdSet(deletedIds.announcements),
      userData.user.email
    ),
    events: mergeEvents(
      currentData.events,
      nextData.events,
      toDeletedIdSet(deletedIds.events),
      userData.user.email
    ),
    galleryImages: mergeGalleryImages(
      currentData.galleryImages,
      nextData.galleryImages,
      toDeletedIdSet(deletedIds.galleryImages),
      userData.user.email
    ),
  };
  const groupRole = normalizeGroupRole(accessResult.role);
  const currentMembers = stableSerialize(Array.isArray(currentData.members) ? currentData.members : []);
  const nextMembers = stableSerialize(Array.isArray(nextData.members) ? nextData.members : []);
  if (currentMembers !== nextMembers && !canManageGroupRoles(groupRole)) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Only group admins can manage member roles.', source: 'app' }),
      { status: 403, headers: getRateLimitHeaders(limiter) }
    );
  }

  const announcementsChanged =
    stableSerialize(stripCollaborativeAnnouncementFields(currentData.announcements)) !==
    stableSerialize(stripCollaborativeAnnouncementFields(mergedData.announcements));
  const eventContentChanged =
    stableSerialize(stripCollaborativeEventFields(currentData.events)) !==
    stableSerialize(stripCollaborativeEventFields(mergedData.events));
  const formsChanged =
    stableSerialize(stripCollaborativeFormFields(currentData.forms)) !==
    stableSerialize(stripCollaborativeFormFields(mergedData.forms));

  if ((announcementsChanged || eventContentChanged || formsChanged) && !canEditGroupContent(groupRole)) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Only group admins or officers can change announcements, events, or forms.', source: 'app' }),
      { status: 403, headers: getRateLimitHeaders(limiter) }
    );
  }

  const pendingPushJobs = await Promise.all([
    collectMessagePushJobs({
      admin,
      actorId: userData.user.id,
      actorEmail: userData.user.email ?? '',
      orgId: parsed.data.orgId,
      groupId: parsed.data.groupId,
      currentData,
      nextData: mergedData,
    }),
    collectAnnouncementPushJobs({
      admin,
      actorId: userData.user.id,
      orgId: parsed.data.orgId,
      currentData,
      nextData: mergedData,
    }),
    collectEventPushJobs({
      admin,
      actorId: userData.user.id,
      orgId: parsed.data.orgId,
      groupId: parsed.data.groupId,
      currentData,
      nextData: mergedData,
    }),
    collectFormPushJobs({
      admin,
      actorId: userData.user.id,
      orgId: parsed.data.orgId,
      groupId: parsed.data.groupId,
      currentData,
      nextData: mergedData,
    }),
  ]).then(results => results.flat());

  const { error } = await admin
    .from('group_state')
    .upsert(
      {
        org_id: parsed.data.orgId,
        group_id: parsed.data.groupId,
        data: mergedData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'group_id' }
    );
  if (error) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: error.message,
        source: 'network',
      }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  if (pendingPushJobs.length > 0) {
    const pushResults = await Promise.allSettled(
      pendingPushJobs.map(pushJob => sendPushToUsers(pushJob))
    );
    pushResults.forEach(result => {
      if (result.status === 'rejected') {
        console.error('Push dispatch failed', result.reason);
      }
    });
  }

  console.info('group_state POST merged counts', {
    orgId: parsed.data.orgId,
    groupId: parsed.data.groupId,
    announcements: getCollectionCount(mergedData.announcements),
    events: getCollectionCount(mergedData.events),
    forms: getCollectionCount(mergedData.forms),
    galleryImages: getCollectionCount(mergedData.galleryImages),
  });

  return NextResponse.json(
    {
      ok: true,
      data: returnMode === 'minimal' ? null : mergedData,
      counts:
        returnMode === 'minimal'
          ? {
              announcements: getCollectionCount(mergedData.announcements),
              events: getCollectionCount(mergedData.events),
              forms: getCollectionCount(mergedData.forms),
              galleryImages: getCollectionCount(mergedData.galleryImages),
            }
          : undefined,
    },
    { headers: getRateLimitHeaders(limiter) }
  );
}
