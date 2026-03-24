import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';
import { canEditGroupContent, canManageGroupRoles, normalizeGroupRole } from '@/lib/group-permissions';
import { sendPushToUsers } from '@/lib/send-push';

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerialize(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const uniqueStrings = (values: unknown[]) =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map(value => value.trim())
    )
  );

const mergeAnnouncements = (
  currentAnnouncements: unknown,
  nextAnnouncements: unknown,
  actorEmail?: string | null
) => {
  const currentList = Array.isArray(currentAnnouncements) ? currentAnnouncements : [];
  const nextList = Array.isArray(nextAnnouncements) ? nextAnnouncements : [];
  const currentById = new Map<string, Record<string, any>>();
  const normalizedActorEmail = actorEmail ? normalizeEmail(actorEmail) : '';

  currentList.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const idValue = (item as { id?: unknown }).id;
    const announcementId =
      typeof idValue === 'string' || typeof idValue === 'number' ? String(idValue) : '';
    if (!announcementId) return;
    currentById.set(announcementId, item as Record<string, any>);
  });

  return nextList.map(item => {
    if (!item || typeof item !== 'object') return item;
    const nextAnnouncement = item as Record<string, any>;
    const idValue = nextAnnouncement.id;
    const announcementId =
      typeof idValue === 'string' || typeof idValue === 'number' ? String(idValue) : '';
    if (!announcementId) return item;

    const currentAnnouncement = currentById.get(announcementId);
    if (!currentAnnouncement) return item;

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

    return {
      ...nextAnnouncement,
      viewedBy: mergedViewed,
      read: Boolean(nextAnnouncement.read) || Boolean(currentAnnouncement.read) || Boolean(normalizedActorEmail),
    };
  });
};

const mergeEvents = (currentEvents: unknown, nextEvents: unknown, actorEmail?: string | null) => {
  const currentList = Array.isArray(currentEvents) ? currentEvents : [];
  const nextList = Array.isArray(nextEvents) ? nextEvents : [];
  const currentById = new Map<string, Record<string, any>>();
  const normalizedActorEmail = actorEmail ? normalizeEmail(actorEmail) : '';

  currentList.forEach(event => {
    if (!event || typeof event !== 'object') return;
    const eventId = typeof (event as { id?: unknown }).id === 'string' ? (event as { id: string }).id : '';
    if (!eventId) return;
    currentById.set(eventId, event as Record<string, any>);
  });

  return nextList.map(event => {
    if (!event || typeof event !== 'object') return event;
    const nextEvent = event as Record<string, any>;
    const eventId = typeof nextEvent.id === 'string' ? nextEvent.id : '';
    if (!eventId) return event;

    const currentEvent = currentById.get(eventId);
    if (!currentEvent) return event;

    const currentViewed = uniqueStrings(Array.isArray(currentEvent.viewedBy) ? currentEvent.viewedBy : []);
    const nextViewed = uniqueStrings(Array.isArray(nextEvent.viewedBy) ? nextEvent.viewedBy : []);
    const currentAttendees = uniqueStrings(Array.isArray(currentEvent.attendees) ? currentEvent.attendees : []);
    const nextAttendees = uniqueStrings(Array.isArray(nextEvent.attendees) ? nextEvent.attendees : []);

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

    return {
      ...nextEvent,
      viewedBy: uniqueStrings([...currentViewed, ...nextViewed]),
      attendees: uniqueStrings([...currentAttendees, ...nextAttendees]),
      rsvps: {
        yes: mergedYes,
        no: mergedNo,
        maybe: mergedMaybe,
      },
    };
  });
};

const stripCollaborativeEventFields = (events: unknown) => {
  if (!Array.isArray(events)) return [];

  return events.map(event => {
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

const resolveUserIdsByEmails = async (
  admin: ReturnType<typeof createSupabaseAdmin>,
  emails: string[],
  actorId: string
) => {
  const normalizedEmails = Array.from(
    new Set(emails.map(email => email.trim().toLowerCase()).filter(Boolean))
  );
  if (normalizedEmails.length === 0) return [];

  const { data, error } = await admin
    .from('profiles')
    .select('id, email')
    .in('email', normalizedEmails);

  if (error) {
    throw error;
  }

  return Array.from(
    new Set(
      (data ?? [])
        .filter(profile => profile.id !== actorId)
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
  currentData,
  nextData,
}: {
  admin: ReturnType<typeof createSupabaseAdmin>;
  actorId: string;
  actorEmail: string;
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
      const recipientIds = await resolveUserIdsByEmails(admin, [recipientEmail], actorId);
      if (recipientIds.length === 0) continue;
      const threadId = `dm__${encodeURIComponent(recipientEmail)}`;
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
      const recipientIds = await resolveUserIdsByEmails(admin, recipientEmails, actorId);
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
      route: `/announcements/${announcementId}`,
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

export async function POST(request: Request) {
  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headerList.get('x-real-ip') ||
    'unknown';
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
  });
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

  const { data: membership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', parsed.data.groupId)
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Access denied.', source: 'app' }),
      { status: 403, headers: getRateLimitHeaders(limiter) }
    );
  }

  const admin = createSupabaseAdmin();
  const { data: existingState } = await admin
    .from('group_state')
    .select('data')
    .eq('group_id', parsed.data.groupId)
    .maybeSingle();

  const currentData = (existingState?.data ?? {}) as Record<string, any>;
  const nextData = parsed.data.data as Record<string, any>;
  const mergedData = {
    ...nextData,
    announcements: mergeAnnouncements(currentData.announcements, nextData.announcements, userData.user.email),
    events: mergeEvents(currentData.events, nextData.events, userData.user.email),
  };
  const groupRole = normalizeGroupRole(membership.role);
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
    stableSerialize(stripCollaborativeAnnouncementFields(nextData.announcements));
  const eventContentChanged =
    stableSerialize(stripCollaborativeEventFields(currentData.events)) !==
    stableSerialize(stripCollaborativeEventFields(nextData.events));

  if ((announcementsChanged || eventContentChanged) && !canEditGroupContent(groupRole)) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Only group admins or officers can change announcements or events.', source: 'app' }),
      { status: 403, headers: getRateLimitHeaders(limiter) }
    );
  }

  const pendingPushJobs = await Promise.all([
    collectMessagePushJobs({
      admin,
      actorId: userData.user.id,
      actorEmail: userData.user.email ?? '',
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

  return NextResponse.json({ ok: true }, { headers: getRateLimitHeaders(limiter) });
}
