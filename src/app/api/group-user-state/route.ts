import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createDashboardLogger,
  createDashboardRequestId,
  DASHBOARD_TIMEOUT_MS,
  withTimeout,
} from '@/lib/dashboard-load';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';
import { ensureOrgOwnerGroupMembership } from '@/lib/group-access';

const querySchema = z.object({
  orgId: z.string().uuid(),
  groupId: z.string().uuid(),
}).strict();

const bodySchema = z.object({
  orgId: z.string().uuid(),
  groupId: z.string().uuid(),
  section: z.enum(['mindmap', 'assistant', 'aiInsights', 'dashboard']),
  value: z.unknown(),
}).strict();

const apiLogger = createDashboardLogger('[Dashboard][API]');
const getRequestId = (request: Request) =>
  request.headers.get('x-request-id') || createDashboardRequestId('group-user-state');
const getErrorStatus = (error: unknown) =>
  error instanceof Error && error.name === 'TimeoutError' ? 504 : 500;
const getErrorCode = (error: unknown) =>
  error instanceof Error && error.name === 'TimeoutError' ? 'NETWORK_TIMEOUT' : 'NETWORK_HTTP_ERROR';

async function requireGroupMembership(orgId: string, groupId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await withTimeout(
    () => supabase.auth.getUser(),
    DASHBOARD_TIMEOUT_MS,
    { label: 'Group user state auth lookup' }
  );
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
  const accessResult = await withTimeout(
    () =>
      ensureOrgOwnerGroupMembership({
        admin,
        orgId,
        groupId,
        userId,
      }),
    DASHBOARD_TIMEOUT_MS,
    { label: 'Group user state membership lookup' }
  );

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

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const ipLimiter = rateLimit(`group-user-state-get:${getRequestIp(request.headers)}`, 120, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

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

  apiLogger.log('Group user state load start', {
    groupId: parsed.data.groupId,
    orgId: parsed.data.orgId,
    requestId,
  });

  try {
    const membershipResult = await requireGroupMembership(parsed.data.orgId, parsed.data.groupId);
    if (!membershipResult.ok) {
      return membershipResult.response;
    }

    const userLimiter = rateLimit(`group-user-state-get-user:${membershipResult.userId}`, 180, 60_000);
    if (!userLimiter.allowed) {
      return rateLimitExceededResponse(userLimiter);
    }

    const admin = createSupabaseAdmin();
    const { data, error } = await withTimeout(
      () =>
        admin
          .from('group_user_state')
          .select('data')
          .eq('org_id', parsed.data.orgId)
          .eq('group_id', parsed.data.groupId)
          .eq('user_id', membershipResult.userId)
          .maybeSingle(),
      DASHBOARD_TIMEOUT_MS,
      { label: 'Group user state row lookup' }
    );

    if (error) {
      return NextResponse.json(
        err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
        { status: 500 }
      );
    }

    apiLogger.log('Group user state load success', {
      groupId: parsed.data.groupId,
      orgId: parsed.data.orgId,
      requestId,
      hasData: Boolean(data?.data),
    });

    return NextResponse.json({ ok: true, data: data?.data ?? {} });
  } catch (error) {
    apiLogger.error('Group user state load failed', error, {
      groupId: parsed.data.groupId,
      orgId: parsed.data.orgId,
      requestId,
    });
    return NextResponse.json(
      err({
        code: getErrorCode(error),
        message:
          error instanceof Error && error.message
            ? error.message
            : 'Group user state could not be loaded.',
        source: 'network',
      }),
      { status: getErrorStatus(error) }
    );
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const ipLimiter = rateLimit(`group-user-state-post:${getRequestIp(request.headers)}`, 60, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid request.', source: 'app' }),
      { status: 400 }
    );
  }

  apiLogger.log('Group user state save start', {
    groupId: parsed.data.groupId,
    orgId: parsed.data.orgId,
    requestId,
    section: parsed.data.section,
  });

  try {
    const membershipResult = await requireGroupMembership(parsed.data.orgId, parsed.data.groupId);
    if (!membershipResult.ok) {
      return membershipResult.response;
    }

    const userLimiter = rateLimit(`group-user-state-post-user:${membershipResult.userId}`, 120, 60_000);
    if (!userLimiter.allowed) {
      return rateLimitExceededResponse(userLimiter);
    }

    const admin = createSupabaseAdmin();
    const { data: existing, error: existingError } = await withTimeout(
      () =>
        admin
          .from('group_user_state')
          .select('data')
          .eq('org_id', parsed.data.orgId)
          .eq('group_id', parsed.data.groupId)
          .eq('user_id', membershipResult.userId)
          .maybeSingle(),
      DASHBOARD_TIMEOUT_MS,
      { label: 'Group user state existing lookup' }
    );

    if (existingError) {
      return NextResponse.json(
        err({ code: 'NETWORK_HTTP_ERROR', message: existingError.message, source: 'network' }),
        { status: 500 }
      );
    }

    const nextData = {
      ...((existing?.data as Record<string, unknown> | null) ?? {}),
      [parsed.data.section]: parsed.data.value,
    };

    const currentSectionValue =
      ((existing?.data as Record<string, unknown> | null) ?? {})[parsed.data.section];
    if (JSON.stringify(currentSectionValue) === JSON.stringify(parsed.data.value)) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const { error } = await withTimeout(
      () =>
        admin
          .from('group_user_state')
          .upsert(
            {
              org_id: parsed.data.orgId,
              group_id: parsed.data.groupId,
              user_id: membershipResult.userId,
              data: nextData,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,group_id' }
          ),
      DASHBOARD_TIMEOUT_MS,
      { label: 'Group user state upsert' }
    );

    if (error) {
      return NextResponse.json(
        err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
        { status: 500 }
      );
    }

    apiLogger.log('Group user state save success', {
      groupId: parsed.data.groupId,
      orgId: parsed.data.orgId,
      requestId,
      section: parsed.data.section,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    apiLogger.error('Group user state save failed', error, {
      groupId: parsed.data.groupId,
      orgId: parsed.data.orgId,
      requestId,
      section: parsed.data.section,
    });
    return NextResponse.json(
      err({
        code: getErrorCode(error),
        message:
          error instanceof Error && error.message
            ? error.message
            : 'Group user state could not be saved.',
        source: 'network',
      }),
      { status: getErrorStatus(error) }
    );
  }
}
