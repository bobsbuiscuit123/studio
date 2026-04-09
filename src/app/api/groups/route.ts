import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  orgId: z.string().uuid(),
}).strict();

export async function GET(request: Request) {
  const ipLimiter = rateLimit(`groups-list:${getRequestIp(request.headers)}`, 60, 60_000);
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

  const userLimiter = rateLimit(`groups-list-user:${userId}`, 120, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const admin = createSupabaseAdmin();

  const { data: orgMembership } = await admin
    .from('memberships')
    .select('org_id')
    .eq('org_id', parsed.data.orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!orgMembership) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Organization missing.', source: 'app' }),
      { status: 403 }
    );
  }

  const { data: membershipRows, error: membershipError } = await admin
    .from('group_memberships')
    .select('group_id, role')
    .eq('org_id', parsed.data.orgId)
    .eq('user_id', userId);

  if (membershipError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: membershipError.message, source: 'network' }),
      { status: 500 }
    );
  }

  const groupIds = Array.from(
    new Set(
      (membershipRows ?? [])
        .map(row => row.group_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
  );

  if (groupIds.length === 0) {
    return NextResponse.json({
      ok: true,
      data: {
        groups: [],
      },
    });
  }

  const [{ data: groupRows, error: groupError }, { data: groupStateRows, error: groupStateError }] =
    await Promise.all([
      admin
        .from('groups')
        .select('id, name, description, join_code')
        .eq('org_id', parsed.data.orgId)
        .in('id', groupIds)
        .order('created_at', { ascending: true }),
      admin
        .from('group_state')
        .select('group_id, data')
        .eq('org_id', parsed.data.orgId)
        .in('group_id', groupIds),
    ]);

  if (groupError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: groupError.message, source: 'network' }),
      { status: 500 }
    );
  }

  if (groupStateError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: groupStateError.message, source: 'network' }),
      { status: 500 }
    );
  }

  const roleByGroupId = new Map<string, string>();
  (membershipRows ?? []).forEach(row => {
    if (typeof row.group_id === 'string') {
      roleByGroupId.set(row.group_id, row.role ?? 'member');
    }
  });

  const logoByGroupId = new Map<string, string>();
  (groupStateRows ?? []).forEach(row => {
    const logo = (row.data as { logo?: string } | null)?.logo;
    if (typeof logo === 'string' && logo.trim()) {
      logoByGroupId.set(row.group_id, logo);
    }
  });

  const groups = (groupRows ?? []).map(group => ({
    ...group,
    logo: logoByGroupId.get(group.id) ?? null,
    role: roleByGroupId.get(group.id) ?? null,
  }));

  return NextResponse.json({
    ok: true,
    data: {
      groups,
    },
  });
}
