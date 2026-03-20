import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const revenueCatWebhookSchema = z.object({
  api_version: z.string().optional(),
  event: z.object({
    id: z.string().optional(),
    type: z.string(),
    app_user_id: z.string().nullable().optional(),
    original_app_user_id: z.string().nullable().optional(),
    aliases: z.array(z.string()).optional(),
    product_id: z.string().nullable().optional(),
    transaction_id: z.string().nullable().optional(),
    original_transaction_id: z.string().nullable().optional(),
    environment: z.string().nullable().optional(),
    store: z.string().nullable().optional(),
    presented_offering_id: z.string().nullable().optional(),
    purchased_at_ms: z.number().nullable().optional(),
    event_timestamp_ms: z.number().nullable().optional(),
    entitlement_ids: z.array(z.string()).nullable().optional(),
    price_in_purchased_currency: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
  }),
});

const validateWebhookAuthorization = (request: Request) => {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH?.trim();
  if (!expected) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: 'Missing REVENUECAT_WEBHOOK_AUTH.' },
        { status: 500 }
      ),
    };
  }

  const authorization = request.headers.get('authorization')?.trim() ?? '';
  if (authorization !== expected && authorization !== `Bearer ${expected}`) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: 'Unauthorized RevenueCat webhook.' },
        { status: 401 }
      ),
    };
  }

  return { ok: true as const };
};

const resolveRevenueCatUserId = (
  appUserId?: string | null,
  originalAppUserId?: string | null,
  aliases?: string[]
) => {
  const candidates = [appUserId, originalAppUserId, ...(aliases ?? [])];
  return (
    candidates.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0) ??
    null
  );
};

export async function POST(request: Request) {
  const authResult = validateWebhookAuthorization(request);
  if (!authResult.ok) {
    return authResult.response;
  }

  const rawBody = await request.text();
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid RevenueCat webhook payload.' }, { status: 400 });
  }

  const parsed = revenueCatWebhookSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Malformed RevenueCat webhook payload.' }, { status: 400 });
  }

  const { event } = parsed.data;

  if (event.type === 'TEST') {
    return NextResponse.json({ ok: true, ignored: true, reason: 'test_event' });
  }

  if (event.type !== 'NON_RENEWING_PURCHASE') {
    return NextResponse.json({ ok: true, ignored: true, reason: `ignored_${event.type.toLowerCase()}` });
  }

  const userId = resolveRevenueCatUserId(
    event.app_user_id,
    event.original_app_user_id,
    event.aliases
  );
  const productId = event.product_id?.trim() ?? '';
  const transactionId =
    event.transaction_id?.trim() || event.original_transaction_id?.trim() || '';

  if (!userId || !productId || !transactionId) {
    return NextResponse.json(
      { ok: false, error: 'RevenueCat webhook is missing app user id, product id, or transaction id.' },
      { status: 400 }
    );
  }

  const metadata = {
    provider: 'revenuecat',
    revenuecat_event_id: event.id ?? null,
    provider_transaction_id: transactionId,
    app_user_id: userId,
    original_app_user_id: event.original_app_user_id ?? null,
    aliases: event.aliases ?? [],
    product_id: productId,
    event_type: event.type,
    environment: event.environment ?? null,
    store: event.store ?? null,
    presented_offering_id: event.presented_offering_id ?? null,
    purchased_at_ms: event.purchased_at_ms ?? null,
    event_timestamp_ms: event.event_timestamp_ms ?? null,
    entitlement_ids: event.entitlement_ids ?? [],
    price_in_purchased_currency: event.price_in_purchased_currency ?? null,
    currency: event.currency ?? null,
  };

  const admin = createSupabaseAdmin();
  const { data, error } = await admin.rpc('grant_token_purchase', {
    p_user_id: userId,
    p_product_id: productId,
    p_provider_transaction_id: transactionId,
    p_provider: 'revenuecat',
    p_environment: event.environment ?? null,
    p_metadata: metadata,
  });

  if (error) {
    console.error('RevenueCat webhook token grant failed', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to grant token purchase.' },
      { status: 500 }
    );
  }

  const grantResult = Array.isArray(data) ? data[0] : data;

  return NextResponse.json({
    ok: true,
    granted: Boolean(grantResult?.granted),
    tokenBalance: Number(grantResult?.token_balance ?? 0),
    tokensGranted: Number(grantResult?.tokens_granted ?? 0),
  });
}
