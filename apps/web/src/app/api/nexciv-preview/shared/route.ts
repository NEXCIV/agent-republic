import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { SharedPilotRuntime } from '../../../../lib/shared-pilot-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const state = globalThis as typeof globalThis & { nexcivSharedPilot?: { file: string; runtime: SharedPilotRuntime } };
const loopback = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export function GET(request: NextRequest) {
  // Private development-only monitor: no browser credential or write operation.
  const host = request.headers.get('host') ?? '';
  if (!loopback.test(host) || (request.headers.has('x-forwarded-host') && !loopback.test(request.headers.get('x-forwarded-host') ?? ''))
    || request.headers.get('sec-fetch-site') === 'cross-site' || request.headers.get('sec-fetch-site') === 'same-site') {
    return json({ error: '共享试玩仅允许本机查看。' }, 403);
  }
  const file = process.env.NEXCIV_SHARED_PILOT_DB;
  if (process.env.NODE_ENV === 'production' || !file || !path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.sqlite') {
    return json({ error: '本机共享试玩尚未启动。' }, 404);
  }
  try {
    const resolved = path.resolve(file);
    if (!state.nexcivSharedPilot || state.nexcivSharedPilot.file !== resolved || !(state.nexcivSharedPilot.runtime instanceof SharedPilotRuntime)) {
      state.nexcivSharedPilot?.runtime.close();
      state.nexcivSharedPilot = undefined;
      const pilot = new SharedPilotRuntime(resolved);
      pilot.start();
      state.nexcivSharedPilot = { file: resolved, runtime: pilot };
    }
    return json(state.nexcivSharedPilot.runtime.snapshot());
  } catch {
    return json({ error: '共享城市暂不可用，请确认本机试验配置。' }, 503);
  }
}
