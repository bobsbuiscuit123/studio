import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const isLocalhost = (hostname: string) =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '::1' ||
  hostname === '[::1]';

const MIDDLEWARE_AUTH_TIMEOUT_MS = 2500;

const hasSupabaseAuthCookie = (request: NextRequest) =>
  request.cookies
    .getAll()
    .some(({ name }) => name.startsWith('sb-') && name.includes('auth-token'));

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Middleware auth lookup timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

export async function middleware(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl;
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }
  const isDemoRoute = pathname === '/demo' || pathname.startsWith('/demo/');
  const demoModeEnabled = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
  const demoAllowRemote = process.env.DEMO_ALLOW_REMOTE === 'true';

  if (demoModeEnabled && (pathname === '/' || pathname === '/login')) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/demo';
    return NextResponse.redirect(redirectUrl);
  }

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
  const publicRoutes = ['/login', '/auth/callback', '/reset-password'];
  const isPublicRoute =
    publicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  const isRootRoute = pathname === '/';
  const orgRoute =
    pathname === '/orgs' ||
    pathname.startsWith('/orgs/') ||
    pathname === '/org' ||
    pathname.startsWith('/org/');
  const clubsRoute = pathname === '/clubs' || pathname.startsWith('/clubs/');
  const authCookiePresent = hasSupabaseAuthCookie(request);

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

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null;
  if (authCookiePresent) {
    try {
      const {
        data: { user: nextUser },
      } = await withTimeout(supabase.auth.getUser(), MIDDLEWARE_AUTH_TIMEOUT_MS);
      user = nextUser;
    } catch (error) {
      console.error('Middleware auth lookup failed', {
        pathname,
        message: error instanceof Error ? error.message : String(error),
      });
      return response;
    }
  }

  if (!user && !isPublicRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    const redirectResponse = NextResponse.redirect(redirectUrl);
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }

  if (user) {
    const selectedOrgId = request.cookies.get('selectedOrgId')?.value;
    const selectedGroupId = request.cookies.get('selectedGroupId')?.value;

    if (pathname === '/login' || isRootRoute) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = selectedOrgId ? '/clubs' : '/orgs';
      return NextResponse.redirect(redirectUrl);
    }

    if (!selectedOrgId && !orgRoute && !isPublicRoute) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/orgs';
      return NextResponse.redirect(redirectUrl);
    }

    if (selectedOrgId && !selectedGroupId && !orgRoute && !clubsRoute && !isPublicRoute) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/clubs';
      return NextResponse.redirect(redirectUrl);
    }
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.[^/]+$).*)'],
};
