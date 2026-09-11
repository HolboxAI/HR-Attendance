import { cookies } from 'next/headers';

export const API = process.env.NEXT_PUBLIC_API ?? 'http://127.0.0.1:8000';

/**
 * Tokens live in httpOnly cookies, never in localStorage and never in a
 * variable the page can read. An XSS bug on the dashboard should not hand
 * someone a working admin session, and anything JavaScript can read, injected
 * JavaScript can exfiltrate.
 *
 * The consequence is that browser-side code cannot call the API directly - it
 * goes through /api/proxy, which attaches the token on the server. That is the
 * trade being made deliberately.
 */
export const ACCESS_COOKIE = 'bx_access';
export const REFRESH_COOKIE = 'bx_refresh';

export type Identity = {
  user_id: string;
  email: string;
  role: string;
  employee_id: string | null;
  employee_code: string | null;
  full_name: string | null;
  can_punch: boolean;
  is_admin: boolean;
  correction_limit: number;
  avatar_url?: string | null;
  face_enrolled?: boolean;
};

export async function accessToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

/**
 * Fetch from the API as the signed-in user.
 *
 * Returns WHY it failed, not just that it did. Collapsing "you don't have
 * access" and "the server is down" into a single null is how an employee ends
 * up being told the API isn't running when the truth is that the page was
 * never theirs to see.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unauthorised' | 'forbidden' | 'unreachable' | 'error'; status: number };

export async function apiFetch<T>(path: string): Promise<ApiResult<T>> {
  const token = await accessToken();
  if (!token) return { ok: false, reason: 'unauthorised', status: 401 };
  try {
    const res = await fetch(`${API}${path}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return { ok: true, data: (await res.json()) as T };
    if (res.status === 401) return { ok: false, reason: 'unauthorised', status: 401 };
    if (res.status === 403) return { ok: false, reason: 'forbidden', status: 403 };
    return { ok: false, reason: 'error', status: res.status };
  } catch {
    return { ok: false, reason: 'unreachable', status: 0 };
  }
}

/** Convenience for callers that genuinely only care whether they got data. */
export async function apiGet<T>(path: string): Promise<T | null> {
  const r = await apiFetch<T>(path);
  return r.ok ? r.data : null;
}

import { cache } from 'react';

export const currentIdentity = cache(async (): Promise<Identity | null> => {
  return apiGet<Identity>('/api/v1/auth/me');
});
