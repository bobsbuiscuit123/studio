import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';
import { ensureOrgOwnerGroupMembership } from '@/lib/group-access';

const bodySchema = z.object({
  orgId: z.string().uuid(),
  groupId: z.string().uuid(),
  eventId: z.string().min(1),
  code: z.string().length(4),
});

const normalizeEmail = (value: string) => value.trim().toLowerCase();

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid attendance check-in request.', source: 'app' }),
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const authUser = userData.user;

  if (!authUser?.id || !authUser.email) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401 }
    );
  }

  const admin = createSupabaseAdmin();
  const accessResult = await ensureOrgOwnerGroupMembership({
    admin,
    orgId: parsed.data.orgId,
    groupId: parsed.data.groupId,
    userId: authUser.id,
  });

  if (!accessResult.ok) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Access denied.', source: 'app' }),
      { status: 403 }
    );
  }

  const { data: stateRow, error: stateError } = await admin
    .from('group_state')
    .select('data')
    .eq('org_id', parsed.data.orgId)
    .eq('group_id', parsed.data.groupId)
    .maybeSingle();

  if (stateError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: stateError.message, source: 'network' }),
      { status: 500 }
    );
  }

  const state = (stateRow?.data ?? {}) as Record<string, unknown>;
  const events = Array.isArray(state.events) ? state.events : [];
  const normalizedEmail = normalizeEmail(authUser.email);
  const checkedInAt = new Date().toISOString();
  let checkedInEvent: Record<string, unknown> | null = null;

  const nextEvents = events.map(item => {
    if (!item || typeof item !== 'object') return item;
    const event = item as Record<string, unknown>;
    if (event.id !== parsed.data.eventId) {
      return item;
    }

    if (typeof event.checkInCode !== 'string' || event.checkInCode.toUpperCase() !== parsed.data.code.toUpperCase()) {
      checkedInEvent = null;
      return item;
    }

    const attendees = Array.isArray(event.attendees)
      ? event.attendees.filter((value): value is string => typeof value === 'string')
      : [];
    if (attendees.map(normalizeEmail).includes(normalizedEmail)) {
      checkedInEvent = {
        ...event,
        attendees,
      };
      return checkedInEvent;
    }

    const attendanceRecords = Array.isArray(event.attendanceRecords)
      ? event.attendanceRecords.filter(
          (record): record is { email: string; checkedInAt: string } =>
            Boolean(
              record &&
                typeof record === 'object' &&
                typeof (record as { email?: unknown }).email === 'string' &&
                typeof (record as { checkedInAt?: unknown }).checkedInAt === 'string'
            )
        )
      : [];

    checkedInEvent = {
      ...event,
      attendees: [...attendees, authUser.email],
      attendanceRecords: [...attendanceRecords, { email: authUser.email, checkedInAt }],
    };

    return checkedInEvent;
  });

  const targetEvent = nextEvents.find(
    item => item && typeof item === 'object' && (item as { id?: unknown }).id === parsed.data.eventId
  ) as Record<string, unknown> | undefined;

  if (!targetEvent) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Event not found.', source: 'app' }),
      { status: 404 }
    );
  }

  if (typeof targetEvent.checkInCode !== 'string') {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'This event does not have a check-in code.', source: 'app' }),
      { status: 400 }
    );
  }

  if (String(targetEvent.checkInCode).toUpperCase() !== parsed.data.code.toUpperCase()) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'The check-in code is incorrect.', source: 'app' }),
      { status: 400 }
    );
  }

  const { error: updateError } = await admin
    .from('group_state')
    .upsert(
      {
        org_id: parsed.data.orgId,
        group_id: parsed.data.groupId,
        data: {
          ...state,
          events: nextEvents,
        },
        updated_at: checkedInAt,
      },
      { onConflict: 'group_id' }
    );

  if (updateError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: updateError.message, source: 'network' }),
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      checkedInAt,
      event: checkedInEvent ?? targetEvent,
    },
  });
}
