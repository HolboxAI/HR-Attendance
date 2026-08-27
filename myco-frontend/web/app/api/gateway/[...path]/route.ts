import { NextResponse } from 'next/server';

import { ACCESS_COOKIE, API } from '@/lib/session';

/**
 * Server-side pass-through so browser code can reach the API without ever
 * holding a token.
 *
 * It forwards ONLY to the API base and only the method and body it was given;
 * it adds the bearer token and nothing else. There is no path here that lets
 * the caller choose a different upstream host - that would turn the dashboard
 * into an open proxy sitting inside the office network.
 */
async function forward(request: Request, path: string[]) {
  const cookie = request.headers.get('cookie') ?? '';
  const token = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ACCESS_COOKIE}=`))
    ?.slice(ACCESS_COOKIE.length + 1);

  if (!token) {
    return NextResponse.json({ detail: 'Sign in to continue' }, { status: 401 });
  }

  const search = new URL(request.url).search;
  const target = `${API}/${path.join('/')}${search}`;

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const contentType = request.headers.get('content-type');
  // Multipart bodies carry a generated boundary, so the header has to be
  // passed through verbatim rather than rebuilt.
  if (contentType) headers['Content-Type'] = contentType;
  const installId = request.headers.get('x-install-id');
  if (installId) headers['X-Install-Id'] = installId;

  const init: RequestInit = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'DELETE') {
    init.body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return NextResponse.json({ detail: 'Could not reach the API' }, { status: 503 });
  }

  const buffer = await upstream.arrayBuffer();
  return new NextResponse(buffer, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function POST(request: Request, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function DELETE(request: Request, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function PUT(request: Request, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function PATCH(request: Request, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
