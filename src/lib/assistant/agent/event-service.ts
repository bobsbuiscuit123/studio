import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { canEditGroupContent, normalizeGroupRole } from '@/lib/group-permissions';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';
import type { ClubEvent } from '@/lib/mock-data';

type CreateEventInput = {
  userId: string;
  orgId: string;
  groupId: string;
  title: string;
  description?: string;
  date: string;
  time: string;
  location?: string;
};

type UpdateEventInput = {
  userId: string;
  orgId: string;
  groupId: string;
  targetRef: string;
  title?: string;
  description?: string;
  date?: string;
  time?: string;
  location?: string;
};

const toEventDate = (date: string, time: string) => {
  const combined = `${date}T${time}`;
  const parsed = new Date(combined);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid event date or time.');
  }
  return parsed;
};

const ensureEventPermission = async (input: {
  userId: string;
  orgId: string;
  groupId: string;
}) => {
  const admin = createSupabaseAdmin();
  const { data: membership, error: membershipError } = await admin
    .from('group_memberships')
    .select('role')
    .eq('org_id', input.orgId)
    .eq('group_id', input.groupId)
    .eq('user_id', input.userId)
    .maybeSingle();

  if (membershipError) {
    throw new Error(membershipError.message);
  }
  if (!membership?.role || !canEditGroupContent(normalizeGroupRole(membership.role))) {
    throw new Error('Only group admins or officers can manage events.');
  }
};

const loadEventsState = async (input: {
  orgId: string;
  groupId: string;
}) => {
  const admin = createSupabaseAdmin();
  const { data: stateRow, error: stateError } = await admin
    .from('group_state')
    .select('data')
    .eq('org_id', input.orgId)
    .eq('group_id', input.groupId)
    .maybeSingle();

  if (stateError) {
    throw new Error(stateError.message);
  }

  const currentData = ((stateRow?.data as Record<string, unknown> | null) ?? {}) as Record<string, any>;
  const events = Array.isArray(currentData.events) ? currentData.events : [];

  return {
    currentData,
    events,
  };
};

const persistEventsState = async (input: {
  orgId: string;
  groupId: string;
  data: Record<string, unknown>;
}) => {
  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from('group_state')
    .upsert(
      {
        org_id: input.orgId,
        group_id: input.groupId,
        data: input.data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'group_id' }
    );

  if (error) {
    throw new Error(error.message);
  }
};

const resolveEventIndex = (events: ClubEvent[], targetRef: string) => {
  const normalizedTarget = targetRef.trim().toLowerCase();
  if (!normalizedTarget) {
    return -1;
  }

  const byId = events.findIndex(item => String(item.id).toLowerCase() === normalizedTarget);
  if (byId >= 0) {
    return byId;
  }

  const titleMatches = events
    .map((item, index) => ({
      index,
      title: typeof item.title === 'string' ? item.title.trim().toLowerCase() : '',
    }))
    .filter(item => item.title === normalizedTarget);

  return titleMatches.length === 1 ? titleMatches[0].index : -1;
};

export async function createEvent(input: CreateEventInput) {
  await ensureEventPermission(input);
  const { currentData, events } = await loadEventsState(input);
  const event: ClubEvent = {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    description: (input.description ?? '').trim(),
    date: toEventDate(input.date, input.time),
    location: (input.location ?? '').trim(),
    hasTime: true,
    rsvpRequired: false,
    read: false,
    viewedBy: [],
  };

  const violation = findPolicyViolation({
    ...event,
    date: event.date.toISOString(),
  });
  if (violation) {
    throw new Error(policyErrorMessage);
  }

  await persistEventsState({
    orgId: input.orgId,
    groupId: input.groupId,
    data: {
      ...currentData,
      events: [...events, event],
    },
  });

  return {
    entityId: event.id,
    entityType: 'event' as const,
    message: 'Event created successfully.',
    record: event,
  };
}

export async function updateEvent(input: UpdateEventInput) {
  await ensureEventPermission(input);
  const { currentData, events } = await loadEventsState(input);
  const eventIndex = resolveEventIndex(events, input.targetRef);

  if (eventIndex < 0) {
    throw new Error('I could not safely identify which event to update.');
  }

  const existing = events[eventIndex];
  const nextDate =
    typeof input.date === 'string' && input.date.trim()
      ? input.date.trim()
      : existing.date instanceof Date
        ? existing.date.toISOString().slice(0, 10)
        : new Date(existing.date).toISOString().slice(0, 10);
  const nextTime =
    typeof input.time === 'string' && input.time.trim()
      ? input.time.trim()
      : existing.date instanceof Date
        ? existing.date.toISOString().slice(11, 16)
        : new Date(existing.date).toISOString().slice(11, 16);

  const updatedEvent: ClubEvent = {
    ...existing,
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : existing.title,
    description:
      typeof input.description === 'string' && input.description.trim()
        ? input.description.trim()
        : existing.description,
    date: toEventDate(nextDate, nextTime),
    location:
      typeof input.location === 'string' && input.location.trim()
        ? input.location.trim()
        : existing.location,
    aiTagged: true,
  };

  const violation = findPolicyViolation({
    ...updatedEvent,
    date: updatedEvent.date.toISOString(),
  });
  if (violation) {
    throw new Error(policyErrorMessage);
  }

  const nextEvents = [...events];
  nextEvents[eventIndex] = updatedEvent;

  await persistEventsState({
    orgId: input.orgId,
    groupId: input.groupId,
    data: {
      ...currentData,
      events: nextEvents,
    },
  });

  return {
    entityId: updatedEvent.id,
    entityType: 'event' as const,
    message: 'Event updated successfully.',
    record: updatedEvent,
  };
}
