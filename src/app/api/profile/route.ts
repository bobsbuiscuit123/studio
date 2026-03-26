import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';
import { getPlaceholderImageUrl } from '@/lib/placeholders';

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const schema = z.object({
    name: z.string().min(1).optional(),
    avatar: z.string().optional(),
  });
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

  const displayName =
    parsed.data.name ||
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
      ? parsed.data.avatar
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
