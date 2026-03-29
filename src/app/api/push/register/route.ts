import { NextResponse } from 'next/server';
import { z } from 'zod';

import { err } from '@/lib/result';
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const registerSchema = z.object({
  token: z.string().trim().min(32).max(4096),
  platform: z.enum(['ios', 'android']),
}).strict();

const getRequestIp = (headers: Headers) =>
  headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  headers.get('x-real-ip') ||
  'unknown';

export async function POST(request: Request) {
  const ip = getRequestIp(request.headers);
  const limiter = rateLimit(`push-register:${ip}`, 20, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: 'Too many requests. Please slow down.', source: 'network' }),
      { status: 429, headers: getRateLimitHeaders(limiter) }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid push token payload.', source: 'app' }),
      { status: 400, headers: getRateLimitHeaders(limiter) }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401, headers: getRateLimitHeaders(limiter) }
    );
  }

  const userLimiter = rateLimit(`push-register-user:${userData.user.id}`, 30, 60_000);
  if (!userLimiter.allowed) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: 'Too many requests. Please slow down.', source: 'network' }),
      { status: 429, headers: getRateLimitHeaders(userLimiter) }
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
      { status: 500, headers: getRateLimitHeaders(userLimiter) }
    );
  }

  return NextResponse.json({ ok: true }, { headers: getRateLimitHeaders(userLimiter) });
}
