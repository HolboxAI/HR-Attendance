import { NextResponse, type NextRequest } from 'next/server';

import { ACCESS_COOKIE, API, REFRESH_COOKIE } from '@/lib/session';

/**
 * Every page except /login requires a session.
 *
 * Named proxy.ts because Next 16 renamed the middleware file convention;
 * this is that file, not to be confused with app/api/gateway, which is the
 * server-side pass-through browser code uses to reach the API.
 *
 * This is the fix for the worst of the three holes: until now the dashboard
 * had no auth at all, so anyone on the office WiFi could open :3000 and read
 * everyone's attendance, hours and lateness.
 *
 * It also does the token refresh. Access tokens last 30 minutes and middleware
 * is the one place in Next that can both see the request and set cookies on
 * the response, so an expiring token is renewed here rather than each page
 * having to cope with a 401.
 */
const PUBLIC = ['/login', '/signup', '/api/signup', '/holbox-logo.png', '/icon.png', '/favicon.ico'];

function expired(token: string): boolean {
  try {
    const [, payload] = token.split('.');
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    // 30s of slack, so a token that dies mid-request is renewed now rather
    // than producing one confusing 401.
    return typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
}

function toLogin(request: NextRequest) {
  // Browser code calling /api/* wants an answer it can parse. Redirecting it to
  // an HTML login page means fetch() succeeds, res.json() explodes, and the
  // real problem ("you are signed out") never reaches the user.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const res = NextResponse.json({ detail: 'Sign in to continue' }, { status: 401 });
    res.cookies.delete(ACCESS_COOKIE);
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  }

  const url = new URL('/login', request.url);
  const res = NextResponse.redirect(url);
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;

  if (access && !expired(access)) return NextResponse.next();
  if (!refresh) return toLogin(request);

  let upstream: Response;
  try {
    upstream = await fetch(`${API}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
  } catch {
    // API down. Send them to the login screen, which says so plainly, rather
    // than rendering a dashboard full of empty tables.
    return toLogin(request);
  }
  if (!upstream.ok) return toLogin(request);

  const body = await upstream.json();

  // The new cookies on the RESPONSE fix the next request; the request being
  // processed right now still carries the expired token in its cookie
  // header, and the gateway reads that header. Without this override, the
  // one call that triggered the refresh - typically the bell's minute poll,
  // 30 minutes into a tab left open - went upstream with the dead token and
  // logged a lone 401 before healing itself. Rewrite the header so
  // downstream sees the fresh token immediately.
  const reqHeaders = new Headers(request.headers);
  const kept = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => !c.startsWith(`${ACCESS_COOKIE}=`) && !c.startsWith(`${REFRESH_COOKIE}=`));
  kept.push(`${ACCESS_COOKIE}=${body.access_token}`, `${REFRESH_COOKIE}=${body.refresh_token}`);
  reqHeaders.set('cookie', kept.join('; '));

  const res = NextResponse.next({ request: { headers: reqHeaders } });
  const isHttps = request.headers.get('x-forwarded-proto') === 'https' || request.url.startsWith('https://');
  const secure = isHttps;
  res.cookies.set(ACCESS_COOKIE, body.access_token, {
    httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: body.expires_in,
  });
  res.cookies.set(REFRESH_COOKIE, body.refresh_token, {
    httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export const config = {
  // Everything except Next's own assets, static media/icons, and the session endpoint
  matcher: ['/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|svg|ico|webp|json)$|api/session).*)'],
};
