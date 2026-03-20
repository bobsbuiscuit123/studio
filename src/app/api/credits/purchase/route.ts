import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { getCreditPackByProductId } from '@/lib/credit-packs';
import { err } from '@/lib/result';

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = z
    .object({
      productId: z.string().min(1),
      orgId: z.string().uuid().optional(),
    })
    .safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid credit purchase payload.', source: 'app' }),
      { status: 400 }
    );
  }

  const pack = getCreditPackByProductId(parsed.data.productId);
  if (!pack) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unknown credit pack.', source: 'app' }),
      { status: 404 }
    );
  }

  const admin = createSupabaseAdmin();
  if (parsed.data.orgId) {
    const { data: membership } = await admin
      .from('memberships')
      .select('role')
      .eq('org_id', parsed.data.orgId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership || membership.role !== 'owner') {
      return NextResponse.json(
        err({ code: 'VALIDATION', message: 'Only the organization owner can add credits.', source: 'app' }),
        { status: 403 }
      );
    }

    const { data: currentOrg } = await admin
      .from('orgs')
      .select('credit_balance')
      .eq('id', parsed.data.orgId)
      .maybeSingle();
    const nextBalance = Number(currentOrg?.credit_balance ?? 0) + pack.credits;
    const { data: org, error: orgError } = await admin
      .from('orgs')
      .update({
        credit_balance: nextBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.orgId)
      .select('credit_balance')
      .single();

    if (orgError) {
      return NextResponse.json(
        err({ code: 'NETWORK_HTTP_ERROR', message: orgError.message, source: 'network' }),
        { status: 500 }
      );
    }

    await admin.from('credit_transactions').insert({
      organization_id: parsed.data.orgId,
      actor_user_id: userId,
      type: 'purchase',
      amount: pack.credits,
      description: `${pack.displayName} purchase`,
      metadata: { productId: pack.productId, provider: 'revenuecat' },
    });

    return NextResponse.json({
        ok: true,
      data: {
        creditsAdded: pack.credits,
        newBalance: Number(org?.credit_balance ?? nextBalance),
        scope: 'organization' as const,
      },
    });
  }

  const { data: profile } = await admin.from('profiles').select('credit_balance').eq('id', userId).maybeSingle();
  const nextBalance = Number(profile?.credit_balance ?? 0) + pack.credits;
  const { error: profileError } = await admin
    .from('profiles')
    .upsert({ id: userId, credit_balance: nextBalance }, { onConflict: 'id' });

  if (profileError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: profileError.message, source: 'network' }),
      { status: 500 }
    );
  }

  await admin.from('credit_transactions').insert({
    actor_user_id: userId,
    type: 'purchase',
    amount: pack.credits,
    description: `${pack.displayName} purchase`,
    metadata: { productId: pack.productId, provider: 'revenuecat', scope: 'wallet' },
  });

  return NextResponse.json({
    ok: true,
    data: {
      creditsAdded: pack.credits,
      newBalance: nextBalance,
      scope: 'wallet' as const,
    },
  });
}
