import { NextResponse } from 'next/server';

/**
 * Same-origin proxy for the owner-protected agent console.
 *
 * The browser never learns the API base URL and the cookie header is forwarded
 * unchanged so the API can resolve the Web2 session. The proxy adds no identity
 * of its own: if the API answers 401/403, that answer is passed through.
 */

const API_BASE = (process.env.API_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');

export async function forwardToApi(request: Request, path: string): Promise<NextResponse> {
  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  if (cookie !== null) headers.set('cookie', cookie);
  const contentType = request.headers.get('content-type');
  if (contentType !== null) headers.set('content-type', contentType);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : await request.text(),
      cache: 'no-store',
    });
    const payload = await response.text();
    return new NextResponse(payload, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'API_UNAVAILABLE', message: 'agent console API is unavailable' } },
      { status: 503 },
    );
  }
}
