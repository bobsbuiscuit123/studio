import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';

const bodySchema = z.object({
  transactionId: z.string().min(1),
  provider: z.string().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;

  const parsedOrgId = z.string().uuid().safeParse(orgId);
  if (!parsedOrgId.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid organization id.', source: 'app' }),
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: sessionData } = await supabase.auth.getUser();
  const userId = sessionData.user?.id;
  if (!userId) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401 }
    );
  }

  const intentBody = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!intentBody.success) {
    return NextResponse.json(
      err({
        code: 'VALIDATION',
        message: 'Invalid token purchase intent.',
        source: 'app',
      }),
      { status: 400 }
    );
  }

  const admin = createSupabaseAdmin();
  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('org_id', parsedOrgId.data)
    .eq('user_id', userId)
    .maybeSingle();

  if (!membership || membership.role !== 'owner') {
    return NextResponse.json(
      err({
        code: 'VALIDATION',
        message: 'Only organization owners can register token purchases.',
        source: 'app',
      }),
      { status: 403 }
    );
  }

  const normalizedProvider = intentBody.data.provider?.trim() || 'revenuecat';
  const { data: existingIntent } = await admin
    .from('token_purchase_intents')
    .select('id')
    .eq('provider', normalizedProvider)
    .eq('provider_transaction_id', intentBody.data.transactionId.trim())
    .maybeSingle();

  if (existingIntent) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await admin
    .from('token_purchase_intents')
    .insert({
      provider_transaction_id: intentBody.data.transactionId.trim(),
      provider: normalizedProvider,
      org_id: parsedOrgId.data,
    });

  if (error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
