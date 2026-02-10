import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const isLocalhost = (hostname: string) =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '::1' ||
  hostname === '[::1]';

export async function middleware(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl;
  const isDemoRoute = pathname === '/demo' || pathname.startsWith('/demo/');
  const demoModeEnabled = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
  const demoAllowRemote = process.env.DEMO_ALLOW_REMOTE === 'true';

  if (isDemoRoute) {
    if (!demoModeEnabled || (!demoAllowRemote && !isLocalhost(hostname))) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/';
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.next({ request });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const privateRoutePrefixes = [
    '/dashboard',
    '/announcements',
    '/assistant',
    '/attendance',
    '/calendar',
    '/email',
    '/finances',
    '/forms',
    '/gallery',
    '/members',
    '/messages',
    '/metrics',
    '/mindmap',
    '/points',
    '/slides',
    '/social',
  ];
  const isPrivateRoute = privateRoutePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isPrivateRoute && !user) {
    console.info(`[middleware] unauthenticated request to private route: ${pathname}`);
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/';
    const redirectResponse = NextResponse.redirect(redirectUrl);
    response.cookies.getAll().forEach(cookie => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
