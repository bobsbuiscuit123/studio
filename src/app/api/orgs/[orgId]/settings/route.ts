import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { parseOptionalPositiveInt, type OrgSettings } from '@/lib/org-settings';
import { err } from '@/lib/result';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';

export const dynamic = 'force-dynamic';

const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
};

const paramsSchema = z.string().uuid();

const bodySchema = z.object({
  logoUrl: z.string().trim().url().nullable().optional(),
  memberLimitOverride: z.number().int().positive().nullable().optional(),
  aiTokenLimitOverride: z.number().int().positive().nullable().optional(),
}).strict();

async function loadOwnerContext(orgId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
        { status: 401, headers: noStoreHeaders }
      ),
    };
  }

  const admin = createSupabaseAdmin();
  const [{ data: membership, error: membershipError }, { data: org, error: orgError }] =
    await Promise.all([
      admin
        .from('memberships')
        .select('role')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .maybeSingle(),
      admin
        .from('orgs')
        .select('*')
        .eq('id', orgId)
        .maybeSingle(),
    ]);

  if (membershipError || orgError) {
    return {
      ok: false as const,
      response: NextResponse.json(
        err({
          code: 'NETWORK_HTTP_ERROR',
          message: membershipError?.message || orgError?.message || 'Unable to load organization settings.',
          source: 'network',
        }),
        { status: 500, headers: noStoreHeaders }
      ),
    };
  }

  if (!membership || !org) {
    return {
      ok: false as const,
      response: NextResponse.json(
        err({ code: 'VALIDATION', message: 'Organization not found.', source: 'app' }),
        { status: 404, headers: noStoreHeaders }
      ),
    };
  }

  const isOwner = String((org as { owner_id?: string | null }).owner_id ?? '') === userId || membership.role === 'owner';
  if (!isOwner) {
    return {
      ok: false as const,
      response: NextResponse.json(
        err({ code: 'VALIDATION', message: 'Owner access required.', source: 'app' }),
        { status: 403, headers: noStoreHeaders }
      ),
    };
  }

  return {
    ok: true as const,
    admin,
    userId,
    org,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const ipLimiter = rateLimit(`org-settings-get:${getRequestIp(request.headers)}`, 30, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const { orgId } = await params;
  const parsed = paramsSchema.safeParse(orgId);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid org id.', source: 'app' }),
      { status: 400, headers: noStoreHeaders }
    );
  }

  const context = await loadOwnerContext(parsed.data);
  if (!context.ok) {
    return context.response;
  }

  const userLimiter = rateLimit(`org-settings-get-user:${context.userId}`, 60, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const orgRecord = context.org as Record<string, unknown>;
  const payload: OrgSettings = {
    joinCode: typeof orgRecord.join_code === 'string' ? orgRecord.join_code : null,
    logoUrl: typeof orgRecord.logo_url === 'string' ? orgRecord.logo_url : null,
    memberLimitOverride: parseOptionalPositiveInt(orgRecord.member_limit_override),
    aiTokenLimitOverride: parseOptionalPositiveInt(orgRecord.ai_token_limit_override),
  };

  return NextResponse.json(
    {
      ok: true,
      data: payload,
    },
    { headers: noStoreHeaders }
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const ipLimiter = rateLimit(`org-settings-patch:${getRequestIp(request.headers)}`, 20, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const { orgId } = await params;
  const parsedParams = paramsSchema.safeParse(orgId);
  if (!parsedParams.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid org id.', source: 'app' }),
      { status: 400, headers: noStoreHeaders }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid organization settings.', source: 'app' }),
      { status: 400, headers: noStoreHeaders }
    );
  }

  const context = await loadOwnerContext(parsedParams.data);
  if (!context.ok) {
    return context.response;
  }

  const userLimiter = rateLimit(`org-settings-patch-user:${context.userId}`, 40, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const updatePayload = {
    ...(Object.prototype.hasOwnProperty.call(parsedBody.data, 'logoUrl')
      ? { logo_url: parsedBody.data.logoUrl ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(parsedBody.data, 'memberLimitOverride')
      ? { member_limit_override: parsedBody.data.memberLimitOverride ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(parsedBody.data, 'aiTokenLimitOverride')
      ? { ai_token_limit_override: parsedBody.data.aiTokenLimitOverride ?? null }
      : {}),
    updated_at: new Date().toISOString(),
  };

  const { data: updatedOrg, error: updateError } = await context.admin
    .from('orgs')
    .update(updatePayload)
    .eq('id', parsedParams.data)
    .select('*')
    .maybeSingle();

  if (updateError || !updatedOrg) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: updateError?.message || 'Failed to save organization settings.',
        source: 'network',
      }),
      { status: 500, headers: noStoreHeaders }
    );
  }

  const updatedRecord = updatedOrg as Record<string, unknown>;
  const payload: OrgSettings = {
    joinCode: typeof updatedRecord.join_code === 'string' ? updatedRecord.join_code : null,
    logoUrl: typeof updatedRecord.logo_url === 'string' ? updatedRecord.logo_url : null,
    memberLimitOverride: parseOptionalPositiveInt(updatedRecord.member_limit_override),
    aiTokenLimitOverride: parseOptionalPositiveInt(updatedRecord.ai_token_limit_override),
  };

  return NextResponse.json(
    {
      ok: true,
      data: payload,
    },
    { headers: noStoreHeaders }
  );
}
