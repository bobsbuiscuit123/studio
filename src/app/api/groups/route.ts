import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';
import { ensureOrgOwnerMembershipsForGroups } from '@/lib/group-access';
import { isInlineAssetString } from '@/lib/org-state-media';

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

  const [
    { data: orgMembership, error: orgMembershipError },
    { data: orgRow, error: orgError },
    { data: membershipRows, error: membershipError },
  ] = await Promise.all([
    admin
      .from('memberships')
      .select('org_id, role')
      .eq('org_id', parsed.data.orgId)
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('orgs')
      .select('owner_id')
      .eq('id', parsed.data.orgId)
      .maybeSingle(),
    admin
      .from('group_memberships')
      .select('group_id, role')
      .eq('org_id', parsed.data.orgId)
      .eq('user_id', userId),
  ]);

  if (orgMembershipError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: orgMembershipError.message, source: 'network' }),
      { status: 500 }
    );
  }

  if (orgError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: orgError.message, source: 'network' }),
      { status: 500 }
    );
  }

  if (!orgMembership) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Organization missing.', source: 'app' }),
      { status: 403 }
    );
  }

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

  const isOrgOwner = orgMembership.role === 'owner' || orgRow?.owner_id === userId;

  if (!isOrgOwner && groupIds.length === 0) {
    return NextResponse.json({
      ok: true,
      data: {
        groups: [],
      },
    });
  }

  const groupQuery = admin
    .from('groups')
    .select('id, name, description, join_code')
    .eq('org_id', parsed.data.orgId)
    .order('created_at', { ascending: true });
  const { data: groupRows, error: groupError } = isOrgOwner
    ? await groupQuery
    : await groupQuery.in('id', groupIds);

  if (groupError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: groupError.message, source: 'network' }),
      { status: 500 }
    );
  }

  const visibleGroupIds = (groupRows ?? [])
    .map(group => group.id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (isOrgOwner) {
    try {
      await ensureOrgOwnerMembershipsForGroups({
        admin,
        orgId: parsed.data.orgId,
        userId,
        groupIds: visibleGroupIds,
      });
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : 'Unable to sync owner group membership.';
      return NextResponse.json(
        err({ code: 'NETWORK_HTTP_ERROR', message, source: 'network' }),
        { status: 500 }
      );
    }
  }

  const { data: groupStateRows, error: groupStateError } = visibleGroupIds.length > 0
    ? await admin
        .from('group_state')
        .select('group_id, logo:data->>logo')
        .eq('org_id', parsed.data.orgId)
        .in('group_id', visibleGroupIds)
    : { data: [], error: null };

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
  if (isOrgOwner) {
    visibleGroupIds.forEach(groupId => {
      if (!roleByGroupId.has(groupId)) {
        roleByGroupId.set(groupId, 'member');
      }
    });
  }

  const logoByGroupId = new Map<string, string>();
  (groupStateRows ?? []).forEach(row => {
    const logo = typeof row.logo === 'string' ? row.logo.trim() : '';
    if (logo && !isInlineAssetString(logo)) {
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
