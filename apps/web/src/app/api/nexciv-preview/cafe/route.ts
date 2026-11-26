import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { CAFE_RETENTION_DAYS, CafeDemoStore, InvalidCafeMcpConnection, type CafeActor } from '../../../../lib/cafe-demo-store';
import { OBSERVER_ACTIONS, type ObserverAction } from '../../../../lib/cafe-observer';
import type { CityDestination } from '../../../../lib/city-movement';

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

function loopback(request: NextRequest) {
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(request.headers.get('host') ?? '');
}

function mcpAction(request: NextRequest, perform: (actor: CafeActor) => NextResponse) {
  const token = /^Bearer (nxc_mcp_[A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token || !loopback(request)) return json({ error: '请在本机咖啡街重新配对。' }, 401);
  try {
    return perform({ mcpToken: token });
  } catch (error) {
    if (!(error instanceof InvalidCafeMcpConnection)) throw error;
    return json({ error: 'Agent 连接已过期或断开，请在咖啡街重新配对。' }, 401);
  }
}

export function GET(request: NextRequest) {
  const unavailable = checkRuntime();
  if (unavailable) return unavailable;
  const resident = request.cookies.get(residentCookie)?.value;
  const params = request.nextUrl.searchParams;
  const control = params.get('control');
  const newspaper = params.get('newspaper');
  if (request.headers.has('authorization')) {
    return mcpAction(request, (actor) => {
      if (control === 'city-map') return json(store().cityMap(actor));
      if (control === 'city') return json(store().cityObservation(actor));
      if (control === 'observer') return json(store().observeExternal(actor));
      if (newspaper === 'latest') return json(store().newspaper(actor));
      if (!request.nextUrl.search) return json(snapshot(store().read(actor)));
      return json({ error: '此连接仅限本机城市试走、观察员班次和最新早报。' }, 403);
    });
  }
  if (control === 'city-map' || control === 'city') {
    if (!loopback(request)) return json({ error: '全城试走仅用于本机试玩。' }, 403);
    if (!resident || !uuid.test(resident)) return json({ error: '请刷新试玩页后重试。' }, 409);
    return json(control === 'city-map' ? store().cityMap(resident) : store().cityObservation(resident));
  }
  if (control === 'pairing') {
    if (!loopback(request)) return json({ error: '配对仅用于本机咖啡街试玩。' }, 403);
    return resident && uuid.test(resident)
      ? json(store().mcpStatus(resident))
      : json({ error: '请刷新试玩页后重试。' }, 409);
  }
  if (control === 'observer') {
    return resident && uuid.test(resident)
      ? json(store().observeExternal(resident))
      : json({ error: '此班次需要本地试玩凭据。' }, 401);
  }
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
    const cursor = params.get('seenAt');
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
  if (request.headers.has('authorization')) {
    return mcpAction(request, (actor) => {
      if (input.action === 'moveTo') return move(actor, input.requestId, input.destination);
      if (input.action === 'interactCity') return interact(actor, input.requestId, input.actionId);
      if (input.action === 'start' && input.kind === 'observer' && input.driver === 'external' && typeof input.busy === 'boolean') {
        const result = store().start(input.requestId, input.busy, actor, 'observer', 'external');
        return 'error' in result ? json(result, 409) : json(snapshot(result));
      }
      if (input.action === 'choose') return applyNote(actor, input);
      return json({ error: '此连接仅允许试走、现场交互和观察员班次。' }, 403);
    });
  }
  if (input.action === 'redeemMcpCode') {
    if (!loopback(request)) return json({ error: '配对仅用于本机咖啡街试玩。' }, 403);
    if (typeof input.code !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(input.code)) return json({ error: '配对码格式不正确。' }, 400);
    const redeemed = store().redeemMcpCode(input.code);
    return redeemed ? json(redeemed) : json({ error: '配对码已使用或过期，请在咖啡街生成新的配对码。' }, 410);
  }
  const resident = request.cookies.get(residentCookie)?.value;
  if (!resident || !uuid.test(resident)) return json({ error: '请刷新试玩页后重试。' }, 409);
  if (input.action === 'moveTo' || input.action === 'interactCity') {
    if (!loopback(request)) return json({ error: '城市行动仅用于本机试玩。' }, 403);
    return input.action === 'moveTo' ? move(resident, input.requestId, input.destination)
      : interact(resident, input.requestId, input.actionId);
  }
  if (input.action === 'issueMcpCode' || input.action === 'disconnectMcp') {
    if (!loopback(request)) return json({ error: '配对仅用于本机咖啡街试玩。' }, 403);
    return json(input.action === 'issueMcpCode' ? store().issueMcpCode(resident) : store().disconnectMcp(resident));
  }
  if (input.action === 'start' && typeof input.busy === 'boolean') {
    if (input.kind !== undefined && input.kind !== 'cafe' && input.kind !== 'observer') return json({ error: '这个班次尚未开放。' }, 400);
    if (input.driver !== undefined && (input.kind !== 'observer' || input.driver !== 'external')) return json({ error: '无效的采访控制方式。' }, 400);
    const result = store().start(input.requestId, input.busy, resident, input.kind, input.driver);
    if ('error' in result) return json({ error: result.error }, 409);
    const response = json(snapshot(result));
    setResident(response, request, resident);
    return response;
  }
  return applyNote(resident, input);
}

function move(actor: CafeActor, requestId: string, input: unknown) {
  let destination: CityDestination | undefined;
  if (input && typeof input === 'object') {
    const values = Object.keys(input);
    if (values.length === 1 && 'place' in input && typeof input.place === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(input.place)) {
      destination = { place: input.place };
    } else if (values.length === 2 && 'x' in input && 'z' in input
      && typeof input.x === 'number' && typeof input.z === 'number'
      && Number.isFinite(input.x) && Number.isFinite(input.z)) {
      destination = { x: input.x, z: input.z };
    }
  }
  if (!destination) return json({ error: '目的地需使用地点 ID 或一组有限的 X、Z 坐标。' }, 400);
  const result = store().moveTo(actor, requestId, destination);
  return 'error' in result ? json({ error: result.error }, result.code) : json(result);
}

function interact(actor: CafeActor, requestId: string, actionId: unknown) {
  if (typeof actionId !== 'string' || !/^[a-z][a-z0-9_-]{0,23}\.[a-z][a-z0-9_-]{0,23}$/.test(actionId)) {
    return json({ error: '请选择现场观测返回的动作 ID。' }, 400);
  }
  const result = store().interactCity(actor, requestId, actionId);
  return 'error' in result ? json({ error: result.error }, result.code) : json(result);
}

function applyNote(
  actor: CafeActor,
  input: { action?: unknown; suggestion?: unknown; choice?: unknown; shiftStartedAt?: unknown; requestId: string },
) {
  const note = input.action === 'note' && typeof input.suggestion === 'string'
    && ['chat', 'rest', 'fish', 'aheFirst', 'regularFirst', 'askSafety', 'askImpact'].includes(input.suggestion)
    ? input.suggestion : undefined;
  const choice = input.action === 'choose' && typeof input.choice === 'string' && Object.hasOwn(OBSERVER_ACTIONS, input.choice)
    ? OBSERVER_ACTIONS[input.choice as ObserverAction] : undefined;
  const suggestion = choice ?? note;
  if (!suggestion) {
    return json({ error: '街区尚未开放这项动作。' }, 400);
  }
  if (typeof input.shiftStartedAt !== 'number' || !Number.isSafeInteger(input.shiftStartedAt)) {
    return json({ error: '纸条缺少班次信息，请刷新后重试。' }, 400);
  }
  const result = store().note(actor, input.shiftStartedAt, input.requestId, suggestion);
  return result ? json(snapshot(result)) : json({ error: '班次已过期，请重新开始。' }, 410);
}
