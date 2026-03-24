import { NextResponse } from 'next/server';
import { z } from 'zod';

import { err } from '@/lib/result';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const registerSchema = z.object({
  token: z.string().min(1),
  platform: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid push token payload.', source: 'app' }),
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401 }
    );
  }

  const admin = createSupabaseAdmin();
  const now = new Date().toISOString();
  const { error } = await admin
    .from('device_push_tokens')
    .upsert(
      {
        user_id: userData.user.id,
        token: parsed.data.token,
        platform: parsed.data.platform,
        last_seen_at: now,
        disabled_at: null,
      },
      { onConflict: 'token' }
    );

  if (error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
