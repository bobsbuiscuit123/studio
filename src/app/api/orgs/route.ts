import { NextResponse } from 'next/server';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
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
  const { data, error } = await admin
    .from('memberships')
    .select('org_id, role, orgs ( id, name )')
    .eq('user_id', userId);

  if (error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
      { status: 500 }
    );
  }

  const orgs = (data ?? [])
    .map((row: any) => ({
      id: row.orgs?.id || row.org_id,
      name: row.orgs?.name || 'Organization',
      role: row.role,
    }))
    .filter((org: { id: string | null }) => Boolean(org.id));

  return NextResponse.json({
    ok: true,
    data: orgs,
  });
}
