import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';
import { getPlaceholderImageUrl } from '@/lib/placeholders';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';

const avatarSchema = z.string().trim().max(2_000_000).refine(
  (value) => value.length === 0 || value.startsWith('data:image/') || /^https?:\/\//.test(value),
  'Invalid avatar.'
);

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  avatar: avatarSchema.optional(),
}).strict();

export async function PATCH(request: Request) {
  const ipLimiter = rateLimit(`profile-patch:${getRequestIp(request.headers)}`, 30, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid profile payload.', source: 'app' }),
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401 }
    );
  }

  const userLimiter = rateLimit(`profile-patch-user:${user.id}`, 30, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const displayName =
    parsed.data.name?.trim() ||
    (user.user_metadata?.display_name as string | undefined) ||
    user.email ||
    'Member';
  const { data: existingProfile, error: existingProfileError } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', user.id)
    .maybeSingle();
  if (existingProfileError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: existingProfileError.message, source: 'network' }),
      { status: 500 }
    );
  }

  const requestedAvatar =
    typeof parsed.data.avatar === 'string' && parsed.data.avatar.trim().length > 0
      ? parsed.data.avatar.trim()
      : null;
  const existingAvatar =
    typeof existingProfile?.avatar_url === 'string' && existingProfile.avatar_url.trim().length > 0
      ? existingProfile.avatar_url
      : null;
  const avatarUrl =
    requestedAvatar ||
    existingAvatar ||
    getPlaceholderImageUrl({ label: displayName.charAt(0) });

  const { error } = await supabase.from('profiles').upsert({
    id: user.id,
    email: user.email || null,
    display_name: displayName,
    avatar_url: avatarUrl,
  });
  if (error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      name: displayName,
      email: user.email || '',
      avatar: avatarUrl,
    },
  });
}
