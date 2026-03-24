import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { grantTokenPurchaseCompat } from '@/lib/token-grants';
import { normalizeTokenProductId } from '@/lib/pricing';

const bodySchema = z.object({
  transactionId: z.string().min(1),
  productId: z.string().min(1),
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

  const purchaseBody = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!purchaseBody.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid token purchase confirmation.', source: 'app' }),
      { status: 400 }
    );
  }

  const admin = createSupabaseAdmin();
  const orgResponse = await admin
    .from('orgs')
    .select('owner_id')
    .eq('id', parsedOrgId.data)
    .maybeSingle();

  let ownerId = orgResponse.data?.owner_id ?? null;
  if (!ownerId && orgResponse.error && /owner_id/i.test(orgResponse.error.message)) {
    const legacyOrgResponse = await admin
      .from('orgs')
      .select('owner_user_id')
      .eq('id', parsedOrgId.data)
      .maybeSingle();
    ownerId = legacyOrgResponse.data?.owner_user_id ?? null;
  }

  if (!ownerId || ownerId !== userId) {
    return NextResponse.json(
      err({
        code: 'VALIDATION',
        message: 'Only organization owners can confirm token purchases.',
        source: 'app',
      }),
      { status: 403 }
    );
  }

  try {
    const grantResult = await grantTokenPurchaseCompat({
      admin,
      userId,
      orgId: parsedOrgId.data,
      productId: normalizeTokenProductId(purchaseBody.data.productId) || purchaseBody.data.productId.trim(),
      transactionId: purchaseBody.data.transactionId.trim(),
      provider: purchaseBody.data.provider?.trim() || 'revenuecat',
      environment: 'client_confirm',
      metadata: {
        source: 'client_confirm',
      },
    });

    return NextResponse.json({
      ok: true,
      granted: grantResult.granted,
      tokenBalance: grantResult.tokenBalance,
      tokensGranted: grantResult.tokensGranted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to confirm token purchase.';
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message, source: 'network' }),
      { status: 500 }
    );
  }
}
