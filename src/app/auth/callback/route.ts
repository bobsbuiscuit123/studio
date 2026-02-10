import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') ?? '/';
  const redirectPath = next.startsWith('/') ? next : '/';

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('[auth/callback] exchangeCodeForSession failed', error.message);
      const failureUrl = new URL('/', requestUrl.origin);
      failureUrl.searchParams.set('authError', error.message);
      return NextResponse.redirect(failureUrl);
    }
  }

  console.info(`[auth/callback] redirecting to ${redirectPath}`);
  return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
}
