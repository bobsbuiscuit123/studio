import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  buildOrgDashboardPayload,
  type AssistantActionLogInput,
  type RawGroupInput,
} from '@/lib/command-center-analytics';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';
import { rateLimit } from '@/lib/rate-limit';
import { err } from '@/lib/result';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  orgId: z.string().uuid(),
}).strict();

const loadAssistantLogs = async ({
  admin,
  orgId,
  groupIds,
}: {
  admin: ReturnType<typeof createSupabaseAdmin>;
  orgId: string;
  groupIds: string[];
}): Promise<AssistantActionLogInput[]> => {
  if (groupIds.length === 0) return [];
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('assistant_action_logs')
    .select('id, org_id, group_id, action_type, result, error_message, created_at')
    .eq('org_id', orgId)
    .in('group_id', groupIds)
    .gte('created_at', since);

  if (error) {
    console.error('[org-dashboard] assistant logs unavailable', error);
    return [];
  }

  return data ?? [];
};

export async function GET(request: Request) {
  const ipLimiter = rateLimit(`org-dashboard:${getRequestIp(request.headers)}`, 60, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    orgId: url.searchParams.get('orgId'),
  });
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid organization id.', source: 'app' }),
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401 }
    );
  }

  const userLimiter = rateLimit(`org-dashboard-user:${userId}`, 120, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const admin = createSupabaseAdmin();
  const [{ data: org, error: orgError }, { data: membership, error: membershipError }] =
    await Promise.all([
      admin
        .from('orgs')
        .select('id, name, owner_id, usage_estimate_members')
        .eq('id', parsed.data.orgId)
        .maybeSingle(),
      admin
        .from('memberships')
        .select('role')
        .eq('org_id', parsed.data.orgId)
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

  if (orgError || membershipError) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: orgError?.message || membershipError?.message || 'Unable to load organization.',
        source: 'network',
      }),
      { status: 500 }
    );
  }
  if (!org) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Organization not found.', source: 'app' }),
      { status: 404 }
    );
  }

  const isOwner = org.owner_id === userId || membership?.role === 'owner';
  if (!isOwner) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Owners only.', source: 'app' }),
      { status: 403 }
    );
  }

  const { data: groupRows, error: groupError } = await admin
    .from('groups')
    .select('id, name')
    .eq('org_id', parsed.data.orgId)
    .order('created_at', { ascending: true });
  if (groupError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: groupError.message, source: 'network' }),
      { status: 500 }
    );
  }

  const groupIds = (groupRows ?? [])
    .map(group => group.id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const [{ data: stateRows, error: stateError }, assistantLogs] = await Promise.all([
    groupIds.length > 0
      ? admin
          .from('group_state')
          .select('group_id, data')
          .eq('org_id', parsed.data.orgId)
          .in('group_id', groupIds)
      : Promise.resolve({ data: [], error: null }),
    loadAssistantLogs({ admin, orgId: parsed.data.orgId, groupIds }),
  ]);

  if (stateError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: stateError.message, source: 'network' }),
      { status: 500 }
    );
  }

  const stateByGroupId = new Map<string, Record<string, unknown>>();
  (stateRows ?? []).forEach(row => {
    if (typeof row.group_id === 'string') {
      stateByGroupId.set(row.group_id, (row.data ?? {}) as Record<string, unknown>);
    }
  });

  const groups: RawGroupInput[] = (groupRows ?? []).map(group => ({
    id: group.id,
    name: group.name || 'Group',
    state: stateByGroupId.get(group.id) ?? {},
  }));

  const payload = buildOrgDashboardPayload({
    org: {
      id: org.id,
      name: org.name || 'Organization',
      usageEstimateMembers: Number(org.usage_estimate_members ?? 0),
    },
    groups,
    assistantLogs,
  });

  return NextResponse.json({
    ok: true,
    data: payload,
  });
}
