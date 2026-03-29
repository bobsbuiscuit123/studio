import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const ipLimiter = rateLimit(`org-cancel:${getRequestIp(request.headers)}`, 10, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const { orgId } = await params;
  const parsed = z.string().uuid().safeParse(orgId);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid org id.', source: 'app' }),
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

  const userLimiter = rateLimit(`org-cancel-user:${userId}`, 10, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const admin = createSupabaseAdmin();
  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('org_id', parsed.data)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership || membership.role !== 'owner') {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Only the organization owner can delete it.', source: 'app' }),
      { status: 403 }
    );
  }

  const [{ data: orgRow, error: orgError }, { data: profileRow, error: profileError }] =
    await Promise.all([
      admin
        .from('orgs')
        .select('id, subscription_product_id')
        .eq('id', parsed.data)
        .maybeSingle(),
      admin
        .from('profiles')
        .select('subscribed_org_id')
        .eq('id', userId)
        .maybeSingle(),
    ]);

  if (orgError || profileError) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: orgError?.message || profileError?.message || 'Unable to verify billing state.',
        source: 'network',
      }),
      { status: 500 }
    );
  }

  if (
    orgRow?.subscription_product_id ||
    profileRow?.subscribed_org_id === parsed.data
  ) {
    return NextResponse.json(
      err({
        code: 'VALIDATION',
        message:
          'Transfer or cancel the active subscription before deleting this organization.',
        source: 'app',
      }),
      { status: 409 }
    );
  }

  const { error: deleteError } = await admin.from('orgs').delete().eq('id', parsed.data);
  if (deleteError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: deleteError.message, source: 'network' }),
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      orgId: parsed.data,
      deletedAt: new Date().toISOString(),
    },
  });
}
