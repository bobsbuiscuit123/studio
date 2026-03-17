import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';
import { canEditGroupContent, canManageGroupRoles, normalizeGroupRole } from '@/lib/group-permissions';

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
    stableSerialize(currentData.announcements ?? null) !== stableSerialize(nextData.announcements ?? null);
  const eventContentChanged =
    stableSerialize(stripCollaborativeEventFields(currentData.events)) !==
    stableSerialize(stripCollaborativeEventFields(nextData.events));

  if ((announcementsChanged || eventContentChanged) && !canEditGroupContent(groupRole)) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Only group admins or officers can change announcements or events.', source: 'app' }),
      { status: 403, headers: getRateLimitHeaders(limiter) }
    );
  }

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

  return NextResponse.json({ ok: true }, { headers: getRateLimitHeaders(limiter) });
}
