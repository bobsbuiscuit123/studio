import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
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
