import { NextRequest, NextResponse } from 'next/server';
import { cafeSnapshot } from '../../../../lib/cafe-http';
import { CITY_PLACES } from '../../../../lib/city-movement';
import { COUNCIL_LIGHTING_ACTIONS, INSTALL_LIGHT } from '../../../../lib/city-activities';
import {
  GUEST_COOKIE, GUEST_COOKIE_AGE, GUEST_ENDPOINT, GUEST_UUID, GuestDemoSessions,
  guestCookie, guestDemoConfig, verifyGuestCookie, type GuestConfig,
} from '../../../../lib/guest-demo-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const local = globalThis as typeof globalThis & { nexcivGuestStore?: { file: string; sessions: GuestDemoSessions } };
const ACTIONS = new Set(['works.chat', 'works.rest', 'works.patrol', ...COUNCIL_LIGHTING_ACTIONS, INSTALL_LIGHT.id]);
const NOTES = new Set(['chat', 'rest', 'fish', 'aheFirst', 'regularFirst', 'askSafety', 'askImpact']);
const BODY_LIMIT = 8192;

function json(body: unknown, status = 200, retryAfter?: number) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  if (retryAfter) headers.set('Retry-After', String(retryAfter));
  return NextResponse.json(body, { status, headers });
}

function check(request: NextRequest): GuestConfig | NextResponse {
  const config = guestDemoConfig();
  if (!config) return json({ error: '此环境未开放游客试玩。' }, 404);
  if (!process.getBuiltinModule?.('node:sqlite')) return json({ error: '试玩服务暂不可用。' }, 503);
  const host = new URL(config.origin).host;
  // Next can normalize nextUrl.host to its private listener when behind the
  // trusted HTTPS reverse proxy. Validate the canonical HTTP Host and HTTPS
  // protocol separately; the deployment must bind Next to loopback and have
  // the proxy overwrite forwarding headers.
  if (request.nextUrl.protocol !== 'https:' || request.headers.get('host') !== host
    || (request.headers.has('origin') && request.headers.get('origin') !== config.origin)) {
    return json({ error: '请从本站试玩页访问。' }, 403);
  }
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return json({ error: '请从本站试玩页访问。' }, 403);
  if (request.headers.has('authorization')) return json({ error: '游客试玩仅支持本站浏览器会话。' }, 403);
  return config;
}

function sessionsFor(config: GuestConfig) {
  try {
    if (local.nexcivGuestStore && (local.nexcivGuestStore.file !== config.file
      || !(local.nexcivGuestStore.sessions instanceof GuestDemoSessions))) {
      local.nexcivGuestStore.sessions.close();
      local.nexcivGuestStore = undefined;
    }
    if (!local.nexcivGuestStore) {
      local.nexcivGuestStore = { file: config.file, sessions: new GuestDemoSessions(config.file) };
    }
    return local.nexcivGuestStore.sessions;
  } catch {
    return null;
  }
}

function limited(retryAfter: number) {
  return json({ error: '试玩请求较多，请稍后再试。' }, 429, retryAfter);
}

function readSession(request: NextRequest, config: GuestConfig, sessions: GuestDemoSessions) {
  const session = verifyGuestCookie(config, request.cookies.get(GUEST_COOKIE)?.value);
  return session && sessions.exists(session) ? session : null;
}

export function GET(request: NextRequest) {
  const config = check(request);
  if (config instanceof NextResponse) return config;
  const params = request.nextUrl.searchParams;
  const control = params.get('control');
  const newspaper = params.get('newspaper');
  if ((control !== null && !['city', 'city-map'].includes(control)) || (control !== null && newspaper !== null)
    || [...params.keys()].some((key) => !['control', 'newspaper', 'seenAt'].includes(key))) {
    return json({ error: '游客试玩尚未开放此项请求。' }, 403);
  }
  const placement = newspaper === 'latest' ? undefined : newspaper ?? undefined;
  if (placement !== undefined && !GUEST_UUID.test(placement.replace(/^city-/, ''))) {
    return json({ error: '找不到这期早报。' }, 404);
  }
  const sessions = sessionsFor(config);
  if (!sessions) return json({ error: '试玩服务暂不可用。' }, 503);
  const session = readSession(request, config, sessions);
  if (!session) {
    if (control !== null) return json({ error: '请刷新试玩页后重试。' }, 409);
    if (newspaper !== null) return placement ? json({ error: '找不到这期早报。' }, 404) : json({ issues: [], current: null });
    const created = sessions.create();
    if ('retryAfter' in created) return limited(created.retryAfter);
    const response = json(null);
    response.cookies.set(GUEST_COOKIE, guestCookie(config, created), {
      httpOnly: true, sameSite: 'strict', secure: true, path: GUEST_ENDPOINT, maxAge: GUEST_COOKIE_AGE,
    });
    return response;
  }
  const rate = sessions.read(session);
  if (rate) return limited(rate.retryAfter);
  if (control === 'city') return json(sessions.city.cityObservation(session.id));
  if (control === 'city-map') return json(sessions.city.cityMap(session.id));
  if (newspaper !== null) {
    const edition = sessions.city.newspaper(session.id, placement);
    return edition ? json(edition) : json({ error: '找不到这期早报。' }, 404);
  }
  const cursor = params.get('seenAt');
  const seenAt = cursor && /^\d{1,15}$/.test(cursor) ? Number(cursor) : undefined;
  return json(cafeSnapshot(sessions.city.read(session.id, false, seenAt)));
}

async function boundedBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json' || !request.body) return null;
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > BODY_LIMIT)) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > BODY_LIMIT) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const body: unknown = JSON.parse(text);
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: NextRequest) {
  const config = check(request);
  if (config instanceof NextResponse) return config;
  if (request.headers.get('origin') !== config.origin) return json({ error: '请从本站试玩页操作。' }, 403);
  const sessions = sessionsFor(config);
  if (!sessions) return json({ error: '试玩服务暂不可用。' }, 503);
  const session = readSession(request, config, sessions);
  if (!session) return json({ error: '请刷新试玩页后重试。' }, 409);
  const rate = sessions.write(session);
  if (rate) return limited(rate.retryAfter);
  const input = await boundedBody(request);
  if (!input || typeof input.requestId !== 'string' || !GUEST_UUID.test(input.requestId)) {
    return json({ error: '请求格式或大小无效。' }, 400);
  }
  if (!sessions.exists(session) || session.expires <= Date.now()) return json({ error: '请刷新试玩页后重试。' }, 409);

  const actor = session.id;
  const city = sessions.city;
  if (input.action === 'moveTo') {
    const destination = input.destination;
    if (!destination || typeof destination !== 'object' || Object.keys(destination).length !== 1
      || !('place' in destination) || typeof destination.place !== 'string' || !Object.hasOwn(CITY_PLACES, destination.place)) {
      return json({ error: '请选择地图上的地点。' }, 400);
    }
    const result = city.moveTo(actor, input.requestId, { place: destination.place });
    return 'error' in result ? json({ error: result.error }, result.code) : json(result);
  }
  if (input.action === 'interactCity') {
    if (typeof input.actionId !== 'string' || !ACTIONS.has(input.actionId)) return json({ error: '游客试玩尚未开放此项互动。' }, 403);
    const result = city.interactCity(actor, input.requestId, input.actionId);
    return 'error' in result ? json({ error: result.error }, result.code) : json(result);
  }
  if (input.action === 'start') {
    if (typeof input.busy !== 'boolean' || (input.kind !== undefined && input.kind !== 'cafe' && input.kind !== 'observer')
      || input.driver !== undefined) return json({ error: '游客试玩仅支持内置规则班次。' }, 400);
    const result = city.start(input.requestId, input.busy, actor, input.kind);
    return 'error' in result ? json({ error: result.error }, 409) : json(cafeSnapshot(result));
  }
  if (input.action === 'note') {
    if (typeof input.suggestion !== 'string' || !NOTES.has(input.suggestion)
      || typeof input.shiftStartedAt !== 'number' || !Number.isSafeInteger(input.shiftStartedAt)) {
      return json({ error: '请选择当前班次提供的纸条。' }, 400);
    }
    const result = city.note(actor, input.shiftStartedAt, input.requestId, input.suggestion);
    return result ? json(cafeSnapshot(result)) : json({ error: '班次已过期，请重新开始。' }, 410);
  }
  return json({ error: '游客试玩尚未开放此项动作。' }, 403);
}
