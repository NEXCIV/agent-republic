import { NextResponse } from 'next/server';

/**
 * E6-04 — same-origin proxy for the public WorldFrame.
 *
 * Keeping the API base URL server-side avoids CORS and keeps the browser on
 * one origin. Failures return 503 and no partial frame; the client keeps its
 * last fully validated frame.
 */

export const dynamic = 'force-dynamic';

const API_BASE = (process.env.API_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');

export async function GET() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/world/frame`, { cache: 'no-store' });
    if (!response.ok) {
      return NextResponse.json({ error: 'WORLD_FRAME_UNAVAILABLE' }, { status: 503 });
    }
    const body: unknown = await response.json();
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'WORLD_FRAME_UNAVAILABLE' }, { status: 503 });
  }
}
