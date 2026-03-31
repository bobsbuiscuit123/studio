import { NextResponse, type NextRequest } from 'next/server';

const isLocalhost = (hostname: string) =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '::1' ||
  hostname === '[::1]';

const hasSupabaseAuthCookie = (request: NextRequest) =>
  request.cookies
    .getAll()
    .some(({ name }) => name.startsWith('sb-') && name.includes('auth-token'));

export function middleware(request: NextRequest) {
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
  // Keep middleware cookie-only. Remote auth lookups here block every navigation.
  const authCookiePresent = hasSupabaseAuthCookie(request);

  if (!authCookiePresent && !isPublicRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    return NextResponse.redirect(redirectUrl);
  }

  if (authCookiePresent) {
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

  return NextResponse.next({ request });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.[^/]+$).*)'],
};
