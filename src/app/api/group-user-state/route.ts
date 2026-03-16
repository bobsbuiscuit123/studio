import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';

const querySchema = z.object({
  orgId: z.string().uuid(),
  groupId: z.string().uuid(),
});

const bodySchema = z.object({
  orgId: z.string().uuid(),
  groupId: z.string().uuid(),
  section: z.enum(['mindmap', 'assistant', 'aiInsights', 'dashboard']),
  value: z.any(),
});

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
  const { data: membership } = await admin
    .from('group_memberships')
    .select('group_id')
    .eq('org_id', orgId)
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!membership) {
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

  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('group_user_state')
    .select('data')
    .eq('org_id', parsed.data.orgId)
    .eq('group_id', parsed.data.groupId)
    .eq('user_id', membershipResult.userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, data: data?.data ?? {} });
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

  const admin = createSupabaseAdmin();
  const { data: existing, error: existingError } = await admin
    .from('group_user_state')
    .select('data')
    .eq('org_id', parsed.data.orgId)
    .eq('group_id', parsed.data.groupId)
    .eq('user_id', membershipResult.userId)
    .maybeSingle();

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

  if (process.env.NODE_ENV !== 'production') {
    console.log('[group-user-state]', {
      section: parsed.data.section,
      orgId: parsed.data.orgId,
      groupId: parsed.data.groupId,
      referer: request.headers.get('referer'),
    });
  }

  const { error } = await admin
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
    );

  if (error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
