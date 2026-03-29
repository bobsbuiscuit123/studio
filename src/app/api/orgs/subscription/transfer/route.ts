import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';
import { syncRevenueCatSubscriber } from '@/lib/subscription-sync';

const bodySchema = z.object({
  targetOrgId: z.string().uuid(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid transfer target.', source: 'app' }),
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

  try {
    const result = await syncRevenueCatSubscriber({
      admin,
      appUserId: userId,
      targetOrgId: parsed.data.targetOrgId,
    });

    return NextResponse.json({
      ok: true,
      data: {
        subscribedOrgId: result.subscribedOrgId,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Unable to transfer the subscription to this organization.';
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message, source: 'network' }),
      { status: /subscription_assignment_conflict/i.test(message) ? 409 : 500 }
    );
  }
}
