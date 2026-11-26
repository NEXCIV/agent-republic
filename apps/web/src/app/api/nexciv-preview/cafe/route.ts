import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { CAFE_RETENTION_DAYS, CafeDemoStore } from '../../../../lib/cafe-demo-store';
import { OBSERVER_ACTIONS, type ObserverAction } from '../../../../lib/cafe-observer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const residentCookie = 'nexciv_cafe_resident';
const legacyCookie = 'nexciv_cafe_demo';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const local = globalThis as typeof globalThis & { nexcivCafeStore?: CafeDemoStore };

function store() {
  if (local.nexcivCafeStore && !(local.nexcivCafeStore instanceof CafeDemoStore)) {
    // Refresh the scheduler when Next replaces the module in development.
    const previous: CafeDemoStore = local.nexcivCafeStore;
    previous.close();
    local.nexcivCafeStore = undefined;
  }
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
  const { phase, since, until, place, energy, events, requestedActivity, fishResult, observer } = data.run;
  return { ...data, run: { phase, since, until, place, energy, events, requestedActivity, fishResult, observer } };
}

function setResident(response: NextResponse, request: NextRequest, resident: string) {
  response.cookies.set(residentCookie, resident, {
    httpOnly: true, sameSite: 'strict', secure: request.nextUrl.protocol === 'https:',
    path: '/api/nexciv-preview/cafe', maxAge: CAFE_RETENTION_DAYS * 86400,
  });
}

export function GET(request: NextRequest) {
  const unavailable = checkRuntime();
  if (unavailable) return unavailable;
  const resident = request.cookies.get(residentCookie)?.value;
  if (request.nextUrl.searchParams.get('control') === 'observer') {
    return resident && uuid.test(resident)
      ? json(store().observeExternal(resident))
      : json({ error: '此班次需要本地试玩凭据。' }, 401);
  }
  const newspaper = request.nextUrl.searchParams.get('newspaper');
  if (newspaper !== null) {
    const requested = newspaper === 'latest' ? undefined : newspaper;
    if (requested !== undefined && !uuid.test(requested)) return json({ error: '找不到这期早报。' }, 404);
    if (resident && uuid.test(resident)) {
      const edition = store().newspaper(resident, requested);
      return edition ? json(edition) : json({ error: '找不到这期早报。' }, 404);
    }
    return requested ? json({ error: '找不到这期早报。' }, 404) : json({ issues: [], current: null });
  }
  if (resident && uuid.test(resident)) {
    const cursor = request.nextUrl.searchParams.get('seenAt');
    const seenAt = cursor && /^\d{1,15}$/.test(cursor) ? Number(cursor) : undefined;
    return json(snapshot(store().read(resident, false, seenAt)));
  }
  const legacy = request.cookies.get(legacyCookie)?.value;
  const migrated = legacy && uuid.test(legacy) ? store().read(legacy, true) : null;
  const response = json(snapshot(migrated));
  setResident(response, request, migrated ? legacy! : randomUUID());
  return response;
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
  const resident = request.cookies.get(residentCookie)?.value;
  if (!resident || !uuid.test(resident)) return json({ error: '请刷新试玩页后重试。' }, 409);
  if (input.action === 'start' && typeof input.busy === 'boolean') {
    if (input.kind !== undefined && input.kind !== 'cafe' && input.kind !== 'observer') return json({ error: '这个班次尚未开放。' }, 400);
    if (input.driver !== undefined && (input.kind !== 'observer' || input.driver !== 'external')) return json({ error: '无效的采访控制方式。' }, 400);
    const result = store().start(input.requestId, input.busy, resident, input.kind, input.driver);
    if ('error' in result) return json({ error: result.error }, 409);
    const response = json(snapshot(result));
    setResident(response, request, resident);
    return response;
  }
  const note = input.action === 'note' && ['chat', 'rest', 'fish', 'aheFirst', 'regularFirst', 'askSafety', 'askImpact'].includes(input.suggestion);
  const choice = input.action === 'choose' && typeof input.choice === 'string' && Object.hasOwn(OBSERVER_ACTIONS, input.choice);
  if (!note && !choice) {
    return json({ error: '街区尚未开放这项动作。' }, 400);
  }
  if (!Number.isSafeInteger(input.shiftStartedAt)) return json({ error: '纸条缺少班次信息，请刷新后重试。' }, 400);
  const suggestion = choice ? OBSERVER_ACTIONS[input.choice as ObserverAction] : input.suggestion;
  const result = store().note(resident, input.shiftStartedAt, input.requestId, suggestion);
  return result ? json(snapshot(result)) : json({ error: '班次已过期，请重新开始。' }, 410);
}
