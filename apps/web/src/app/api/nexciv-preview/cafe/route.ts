import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { CafeDemoStore } from '../../../../lib/cafe-demo-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const cookie = 'nexciv_cafe_demo';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const local = globalThis as typeof globalThis & { nexcivCafeStore?: CafeDemoStore };

function store() {
  if (!local.nexcivCafeStore) {
    const file = process.env.NEXCIV_CAFE_DEMO_DB || path.resolve('cache/nexciv-cafe-v1.sqlite');
    mkdirSync(path.dirname(file), { recursive: true });
    local.nexcivCafeStore = new CafeDemoStore(file);
  }
  return local.nexcivCafeStore;
}
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
function disabled() { return process.env.NODE_ENV === 'production' && !process.env.NEXCIV_CAFE_DEMO_DB; }
function checkRuntime() {
  if (disabled()) return json({ error: '此环境未启用咖啡街试玩。' }, 404);
  if (!process.getBuiltinModule?.('node:sqlite')) return json({ error: '咖啡街试玩需要支持 SQLite 的 Node.js 22.13 或更高版本。' }, 503);
}

function snapshot(data: ReturnType<CafeDemoStore['read']>) {
  if (!data) return null;
  const { phase, since, until, place, energy, events } = data.run;
  return { ...data, run: { phase, since, until, place, energy, events } };
}

export function GET(request: NextRequest) {
  const unavailable = checkRuntime();
  if (unavailable) return unavailable;
  const id = request.cookies.get(cookie)?.value;
  return json(id && uuid.test(id) ? snapshot(store().read(id)) : null);
}

export async function POST(request: NextRequest) {
  const unavailable = checkRuntime();
  if (unavailable) return unavailable;
  if (request.headers.get('origin') !== new URL(request.url).origin &&
      request.headers.get('origin') !== `${request.nextUrl.protocol}//${request.headers.get('host')}`) {
    return json({ error: '请从本站试玩页操作。' }, 403);
  }
  const input = await request.json().catch(() => null);
  if (!input || typeof input.requestId !== 'string' || !uuid.test(input.requestId)) return json({ error: '无效的请求编号。' }, 400);
  if (input.action === 'start' && typeof input.busy === 'boolean') {
    const result = store().start(input.requestId, input.busy);
    if (result.accepted === false) return json({ error: result.feedback }, 409);
    const response = json(snapshot(result));
    response.cookies.set(cookie, input.requestId, {
      httpOnly: true, sameSite: 'strict', secure: request.nextUrl.protocol === 'https:',
      path: '/api/nexciv-preview/cafe', maxAge: 7 * 86400,
    });
    return response;
  }
  const id = request.cookies.get(cookie)?.value;
  if (!id || !uuid.test(id)) return json({ error: '请先开始一个班次。' }, 409);
  if (input.action !== 'note' || !['chat', 'rest', 'fish'].includes(input.suggestion)) return json({ error: '街区尚未开放这项动作。' }, 400);
  const result = store().note(id, input.requestId, input.suggestion);
  return result ? json(snapshot(result)) : json({ error: '班次已过期，请重新开始。' }, 410);
}
