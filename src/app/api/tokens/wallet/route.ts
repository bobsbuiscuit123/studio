import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { isMissingColumnError, readBalance } from '@/lib/org-balance';

export const dynamic = 'force-dynamic';

const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
};

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401, headers: noStoreHeaders }
    );
  }

  const admin = createSupabaseAdmin();
  const url = new URL(request.url);
  const orgId = url.searchParams.get('orgId');

  if (!orgId) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Organization id is required.', source: 'app' }),
      { status: 400, headers: noStoreHeaders }
    );
  }

  const [{ data: profile }, orgResponse, { data: activity }] = await Promise.all([
    admin
      .from('profiles')
      .select('has_used_trial')
      .eq('id', userId)
      .maybeSingle(),
    admin
      .from('orgs')
      .select('token_balance, credit_balance, owner_id')
      .eq('id', orgId)
      .maybeSingle(),
    admin
      .from('token_transactions')
      .select('id, amount, type, description, metadata, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  let normalizedOrg = orgResponse.data;
  let orgError = orgResponse.error;
  if (orgError && isMissingColumnError(orgError, 'credit_balance')) {
    const modernWithoutCredit = await admin
      .from('orgs')
      .select('token_balance, owner_id')
      .eq('id', orgId)
      .maybeSingle();

    if (modernWithoutCredit.error) {
      return NextResponse.json(
        err({ code: 'NETWORK_HTTP_ERROR', message: modernWithoutCredit.error.message, source: 'network' }),
        { status: 500, headers: noStoreHeaders }
      );
    }

    normalizedOrg = modernWithoutCredit.data
      ? {
          ...modernWithoutCredit.data,
          credit_balance: null,
        }
      : null;
    orgError = null;
  }

  if (orgError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: orgError.message, source: 'network' }),
      { status: 500, headers: noStoreHeaders }
    );
  }

  if (!normalizedOrg) {
    const legacyOrgResponse = await admin
      .from('orgs')
      .select('credit_balance, owner_user_id')
      .eq('id', orgId)
      .maybeSingle();
    if (legacyOrgResponse.data) {
      normalizedOrg = {
        ...legacyOrgResponse.data,
        token_balance: legacyOrgResponse.data.credit_balance,
        credit_balance: legacyOrgResponse.data.credit_balance,
        owner_id: legacyOrgResponse.data.owner_user_id,
      };
    }
  }

  if (!normalizedOrg) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Organization not found.', source: 'app' }),
      { status: 404, headers: noStoreHeaders }
    );
  }

  if (normalizedOrg.owner_id !== userId) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Not the organization owner.', source: 'app' }),
      { status: 403, headers: noStoreHeaders }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      tokenBalance: readBalance(normalizedOrg).balance,
      hasUsedTrial: Boolean(profile?.has_used_trial),
      recentTokenActivity: activity ?? [],
    },
  }, { headers: noStoreHeaders });
}
