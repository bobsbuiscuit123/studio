import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';

export async function GET() {
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
