import { NextResponse } from 'next/server';

import { API } from '@/lib/session';

/**
 * Public proxy for candidate employee registration requests.
 * Does not require existing authentication or cookies.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const upstream = await fetch(`${API}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return NextResponse.json(
        { detail: data?.detail ?? 'Registration request failed' },
        { status: upstream.status }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json(
      { detail: 'Could not reach the authentication service' },
      { status: 503 }
    );
  }
}
