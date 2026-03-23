import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';

export async function GET(request: Request) {
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
  const url = new URL(request.url);
  const orgId = url.searchParams.get('orgId');

  if (orgId) {
    const [{ data: profile }, { data: org }, { data: activity }] = await Promise.all([
      admin
        .from('profiles')
        .select('has_used_trial')
        .eq('id', userId)
        .maybeSingle(),
      admin
        .from('orgs')
        .select('token_balance, owner_id')
        .eq('id', orgId)
        .maybeSingle(),
      admin
        .from('token_transactions')
        .select('id, amount, type, description, metadata, created_at')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    if (!org) {
      return NextResponse.json(
        err({ code: 'VALIDATION', message: 'Organization not found.', source: 'app' }),
        { status: 404 }
      );
    }

    if (org.owner_id !== userId) {
      return NextResponse.json(
        err({ code: 'VALIDATION', message: 'Not the organization owner.', source: 'app' }),
        { status: 403 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        tokenBalance: Number(org.token_balance ?? 0),
        hasUsedTrial: Boolean(profile?.has_used_trial),
        recentTokenActivity: activity ?? [],
      },
    });
  }

  const [{ data: profile }, { data: activity }] = await Promise.all([
    admin
      .from('profiles')
      .select('token_balance, has_used_trial')
      .eq('id', userId)
      .maybeSingle(),
    admin
      .from('token_transactions')
      .select('id, amount, type, description, metadata, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      tokenBalance: Number(profile?.token_balance ?? 0),
      hasUsedTrial: Boolean(profile?.has_used_trial),
      recentTokenActivity: activity ?? [],
    },
  });
}
