/**
 * Signing in, refreshing, and attaching credentials to a request.
 *
 * The refresh dance lives here rather than in api.ts so that every call site
 * gets it automatically. An access token lasts 30 minutes; nobody is going to
 * accept being thrown back to a login screen mid-morning, and nobody should
 * accept a 30-day access token as the alternative.
 */
import { apiBase } from './config';
import {
  clearSession, installId, loadSession, platformName, saveSession,
  type Identity, type Session,
} from './auth';

export type SignInResult =
  | { ok: true; identity: Identity }
  | { ok: false; message: string };

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  if (!email.trim() || !password) {
    return { ok: false, message: 'Enter your email and password' };
  }

  let res: Response;
  try {
    res = await post('/api/v1/auth/login', {
      email: email.trim().toLowerCase(),
      password,
      // Sending the install id is what registers this handset to this person.
      install_id: await installId(),
      platform: platformName(),
      device_model: null,
    });
  } catch {
    return { ok: false, message: 'Could not reach the server. Check the WiFi.' };
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, message: body?.detail ?? `Sign in failed (${res.status})` };
  }

  await saveSession({
    access: body.access_token,
    refresh: body.refresh_token,
    identity: body.identity as Identity,
  });
  return { ok: true, identity: body.identity as Identity };
}

/** Exchange the stored refresh token for a fresh pair. */
async function refresh(session: Session): Promise<Session | null> {
  let res: Response;
  try {
    res = await post('/api/v1/auth/refresh', { refresh_token: session.refresh });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = await res.json();
  const next: Session = {
    access: body.access_token,
    refresh: body.refresh_token,
    identity: body.identity as Identity,
  };
  await saveSession(next);
  return next;
}

function expired(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(
      decodeURIComponent(
        atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
          .split('')
          .map((ch) => `%${`00${ch.charCodeAt(0).toString(16)}`.slice(-2)}`)
          .join(''),
      ),
    );
    return typeof json.exp !== 'number' || json.exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
}

/**
 * Headers for an authenticated call: the bearer token, and the handset id.
 *
 * X-Install-Id is a header rather than a form field on purpose. It is a fact
 * about the device, not a claim the user gets to make about themselves, and
 * keeping it out of the punch body keeps that distinction visible.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  let session = await loadSession();
  if (!session) return {};
  if (expired(session.access)) {
    const renewed = await refresh(session);
    if (!renewed) {
      await clearSession();
      return {};
    }
    session = renewed;
  }
  return {
    Authorization: `Bearer ${session.access}`,
    'X-Install-Id': await installId(),
  };
}

export async function currentIdentity(): Promise<Identity | null> {
  const session = await loadSession();
  return session?.identity ?? null;
}

export async function restore(): Promise<Identity | null> {
  const session = await loadSession();
  if (!session) return null;
  // Reopening the app must not ask for a password. If the refresh token is
  // still good this is silent; if HR has cleared the phone, it is not, and
  // we drop them at the login screen rather than failing later at the punch.
  if (expired(session.access)) {
    const renewed = await refresh(session);
    if (!renewed) {
      await clearSession();
      return null;
    }
    return renewed.identity;
  }
  return session.identity;
}

export async function signOut(): Promise<void> {
  const session = await loadSession();
  if (session) {
    await post('/api/v1/auth/logout', { refresh_token: session.refresh }).catch(
      () => undefined,
    );
  }
  await clearSession();
}
