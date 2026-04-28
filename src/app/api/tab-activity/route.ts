import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';
import { ensureOrgOwnerGroupMembership } from '@/lib/group-access';

const notificationKeys = ['announcements', 'social', 'messages', 'calendar', 'gallery', 'attendance', 'forms'] as const;

const querySchema = z.object({
  orgId: z.string().uuid(),
  groupId: z.string().uuid(),
});

const bodySchema = z.object({
  orgId: z.string().uuid(),
  groupId: z.string().uuid(),
  tab: z.enum(notificationKeys),
});

type NotificationKey = (typeof notificationKeys)[number];
type LastSeenByTab = Partial<Record<NotificationKey, string | null>>;
type GroupUserStateData = Record<string, unknown> & {
  tabActivity?: {
    lastSeenByTab?: LastSeenByTab;
  };
};

async function requireGroupMembership(orgId: string, groupId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
        { status: 401 }
      ),
    };
  }

  const admin = createSupabaseAdmin();
  const accessResult = await ensureOrgOwnerGroupMembership({
    admin,
    orgId,
    groupId,
    userId,
  });

  if (!accessResult.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(
        err({ code: 'VALIDATION', message: 'Access denied.', source: 'app' }),
        { status: 403 }
      ),
    };
  }

  return { ok: true as const, userId };
}

const readLastSeenByTab = (value: unknown): LastSeenByTab => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const lastSeen = (value as GroupUserStateData).tabActivity?.lastSeenByTab;
  if (!lastSeen || typeof lastSeen !== 'object') {
    return {};
  }

  return Object.fromEntries(
    notificationKeys
      .map(key => [key, typeof lastSeen[key] === 'string' ? lastSeen[key] : null] as const)
      .filter(([, timestamp]) => Boolean(timestamp))
  ) as LastSeenByTab;
};

const getExistingState = async (orgId: string, groupId: string, userId: string) => {
  const admin = createSupabaseAdmin();
  return admin
    .from('group_user_state')
    .select('data')
    .eq('org_id', orgId)
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    orgId: url.searchParams.get('orgId'),
    groupId: url.searchParams.get('groupId'),
  });

  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid request.', source: 'app' }),
      { status: 400 }
    );
  }

  const membershipResult = await requireGroupMembership(parsed.data.orgId, parsed.data.groupId);
  if (!membershipResult.ok) {
    return membershipResult.response;
  }

  const { data, error } = await getExistingState(
    parsed.data.orgId,
    parsed.data.groupId,
    membershipResult.userId
  );

  if (error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      lastSeenByTab: readLastSeenByTab(data?.data),
    },
    serverNow: new Date().toISOString(),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid request.', source: 'app' }),
      { status: 400 }
    );
  }

  const membershipResult = await requireGroupMembership(parsed.data.orgId, parsed.data.groupId);
  if (!membershipResult.ok) {
    return membershipResult.response;
  }

  const { data: existing, error: existingError } = await getExistingState(
    parsed.data.orgId,
    parsed.data.groupId,
    membershipResult.userId
  );

  if (existingError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: existingError.message, source: 'network' }),
      { status: 500 }
    );
  }

  const currentData = ((existing?.data as GroupUserStateData | null) ?? {}) as GroupUserStateData;
  const currentLastSeenByTab = readLastSeenByTab(currentData);
  const lastSeenAt = new Date().toISOString();
  const nextLastSeenByTab: LastSeenByTab = {
    ...currentLastSeenByTab,
    [parsed.data.tab]: lastSeenAt,
  };

  const admin = createSupabaseAdmin();
  const { error } = await admin.from('group_user_state').upsert(
    {
      org_id: parsed.data.orgId,
      group_id: parsed.data.groupId,
      user_id: membershipResult.userId,
      data: {
        ...currentData,
        tabActivity: {
          lastSeenByTab: nextLastSeenByTab,
        },
      },
      updated_at: lastSeenAt,
    },
    { onConflict: 'user_id,group_id' }
  );

  if (error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    lastSeenAt,
    data: {
      lastSeenByTab: nextLastSeenByTab,
    },
    serverNow: lastSeenAt,
  });
}
