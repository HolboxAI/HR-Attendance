import { NextResponse } from 'next/server';

import { ACCESS_COOKIE, API, REFRESH_COOKIE } from '@/lib/session';

/**
 * The dashboard's half of logging in.
 *
 * The browser posts credentials here, this route talks to the API, and the
 * tokens go straight into httpOnly cookies without ever being handed to page
 * JavaScript. The password does not touch any storage on this side.
 */
export async function POST(request: Request) {
  const { email, password } = await request.json();

  let upstream: Response;
  try {
    upstream = await fetch(`${API}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No install_id: a browser is not a phone and must not consume the
      // employee's one device binding.
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return NextResponse.json({ detail: 'Could not reach the API' }, { status: 503 });
  }

  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json(
      { detail: body?.detail ?? 'Sign in failed' },
      { status: upstream.status },
    );
  }

  const res = NextResponse.json({ identity: body.identity });
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

/** Sign out: revoke the refresh token upstream, then drop both cookies. */
export async function DELETE(request: Request) {
  const refresh = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${REFRESH_COOKIE}=`))
    ?.slice(REFRESH_COOKIE.length + 1);

  if (refresh) {
    // Best effort: if the API is unreachable we still clear the cookies, so
    // the person is signed out here even if the token outlives us.
    await fetch(`${API}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    }).catch(() => undefined);
  }

  const res = NextResponse.json({ signed_out: true });
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}
