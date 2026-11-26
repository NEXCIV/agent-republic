import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../src/app/api/nexciv-preview/cafe/route';
import type { CafeDemoStore } from '../src/lib/cafe-demo-store';
import { CITY_MAP, planCityWalk } from '../src/lib/city-navigation';

const origin = 'http://127.0.0.1:3137';
const endpoint = '/api/nexciv-preview/cafe';
const local = globalThis as typeof globalThis & { nexcivCafeStore?: CafeDemoStore };
const supported = Boolean(process.getBuiltinModule?.('node:sqlite'));

describe.skipIf(!supported)('café browser pairing', () => {
  let folder: string;
  let file: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'nexciv-pairing-'));
    file = join(folder, 'demo.sqlite');
    vi.stubEnv('NEXCIV_CAFE_DEMO_DB', file);
    vi.useFakeTimers();
  });

  afterEach(() => {
    local.nexcivCafeStore?.close();
    local.nexcivCafeStore = undefined;
    vi.useRealTimers();
    vi.unstubAllEnvs();
    for (const suffix of ['', '-shm', '-wal']) rmSync(file + suffix, { force: true });
    rmdirSync(folder);
  });

  function get(query = '', credentials: HeadersInit = {}) {
    const headers = new Headers(credentials);
    headers.set('host', '127.0.0.1:3137');
    return GET(new NextRequest(origin + endpoint + query, { headers }));
  }

  function post(input: Record<string, unknown>, credentials: HeadersInit = {}, requestOrigin = origin) {
    const headers = new Headers(credentials);
    headers.set('host', '127.0.0.1:3137');
    headers.set('origin', requestOrigin);
    return POST(new NextRequest(origin + endpoint, {
      method: 'POST', headers, body: JSON.stringify({ requestId: randomUUID(), ...input }),
    }));
  }

  function browser() {
    return { cookie: get().headers.get('set-cookie')!.split(';')[0]! };
  }

  async function codeFor(owner: HeadersInit) {
    const response = await post({ action: 'issueMcpCode' }, owner);
    expect(response.status).toBe(200);
    return (await response.json()).code as string;
  }

  async function redeem(code: string) {
    const response = await post({ action: 'redeemMcpCode', code });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    const { token } = await response.json();
    return { authorization: `Bearer ${token}` };
  }

  it('consumes a code once, binds to one browser and shows the same finished issue', async () => {
    const owner = browser();
    const other = browser();
    const code = await codeFor(owner);
    const agent = await redeem(code);
    expect((await post({ action: 'redeemMcpCode', code })).status).toBe(410);
    expect(await get('?control=pairing', owner).json()).toMatchObject({ connected: true });
    expect(await get('?control=pairing', other).json()).toMatchObject({ connected: false });
    expect(await get('?control=pairing', agent).json()).toEqual({ error: expect.any(String) });

    const start = await post({ action: 'start', kind: 'observer', driver: 'external', busy: true }, agent);
    expect(start.status).toBe(200);
    expect(start.headers.get('set-cookie')).toBeNull();
    const observation = await get('?control=observer', agent).json();
    expect(observation.actions).toEqual(['waitForAhe', 'visitPier']);
    const action = { action: 'choose', choice: 'visitPier', shiftStartedAt: observation.shiftStartedAt, requestId: randomUUID() };
    const accepted = await (await post(action, agent)).json();
    const replayed = await (await post(action, agent)).json();
    expect(replayed.run).toEqual(accepted.run);
    expect(accepted).toMatchObject({ accepted: true, run: { phase: 'toPier' } });
    expect((await get('', owner).json()).run.phase).toBe('toPier');
    expect(await get('', other).json()).toBeNull();
    expect((await post({ action: 'disconnectMcp' }, other)).status).toBe(200);
    expect(get('?control=observer', agent).status).toBe(200);

    vi.setSystemTime(Date.now() + 200000);
    const paper = await get('?newspaper=latest', owner).json();
    expect(paper.current.sources.map(({ speaker }: { speaker: string }) => speaker)).toEqual(['regular', 'ahe']);
    expect(await get('?newspaper=latest', agent).json()).toEqual(paper);
    expect(get(`?newspaper=${paper.current.issue.id}`, other).status).toBe(404);
  });

  it('rejects expired or replaced codes, unscoped actions and revoked access even with a valid browser cookie', async () => {
    const owner = browser();
    expect((await post({ action: 'issueMcpCode' })).status).toBe(409);
    expect((await post({ action: 'issueMcpCode' }, owner, 'http://example.test')).status).toBe(403);
    const superseded = await codeFor(owner);
    const expiring = await codeFor(owner);
    expect((await post({ action: 'redeemMcpCode', code: superseded })).status).toBe(410);
    vi.setSystemTime(Date.now() + 301000);
    expect((await post({ action: 'redeemMcpCode', code: expiring })).status).toBe(410);

    const agent = await redeem(await codeFor(owner));
    expect((await post({ action: 'start', kind: 'cafe', busy: false }, agent)).status).toBe(403);
    expect((await post({ action: 'note', suggestion: 'fish' }, agent)).status).toBe(403);
    expect((await post({ action: 'disconnectMcp' }, agent)).status).toBe(403);
    const start = await post({ action: 'start', kind: 'observer', driver: 'external', busy: false }, agent);
    expect(start.status).toBe(200);
    const { serverTime: shiftStartedAt } = await start.json();
    const canceled = await codeFor(owner);
    expect((await post({ action: 'disconnectMcp' }, owner)).status).toBe(200);
    expect((await post({ action: 'redeemMcpCode', code: canceled })).status).toBe(410);
    expect(get('', { ...agent, ...owner }).status).toBe(401);
    expect((await post({ action: 'choose', choice: 'interviewAhe', shiftStartedAt }, { ...agent, ...owner })).status).toBe(401);
    expect((await get('', owner).json()).run.phase).toBe('briefing');
  });

  it('persists a paired connection, replaces its token on re-pair, and expires it after a day', async () => {
    const owner = browser();
    const first = await redeem(await codeFor(owner));
    local.nexcivCafeStore?.close();
    local.nexcivCafeStore = undefined;
    expect(get('', first).status).toBe(200);
    const second = await redeem(await codeFor(owner));
    expect(get('', first).status).toBe(401);
    expect(get('', second).status).toBe(200);
    vi.setSystemTime(Date.now() + 86401000);
    expect(get('', second).status).toBe(401);
    expect(await get('?control=pairing', owner).json()).toMatchObject({ connected: false });
  });

  it('lets a paired resident use named destinations and surveyed coordinates across the city', async () => {
    const owner = browser();
    const other = browser();
    const agent = await redeem(await codeFor(owner));
    const map = await get('?control=city-map', agent).json();
    expect(map.places.map(({ id }: { id: string }) => id)).toEqual(expect.arrayContaining([
      'cafe', 'plaza', 'governance', 'works', 'forum', 'pier', 'center', 'registry', 'residence',
    ]));
    expect((await get('?control=city', agent).json()).position).toEqual([12.6, 0.184, 72.18]);
    const command = { action: 'moveTo', requestId: randomUUID(), destination: { place: 'works' } };
    expect((await post({ ...command, destination: { x: 150, z: -150 } }, agent)).status).toBe(422);
    expect((await post({ ...command, destination: { place: 'private-building' } }, agent)).status).toBe(422);
    expect((await post({ ...command, destination: { x: 2, z: 3, y: 12 } }, agent)).status).toBe(400);
    const accepted = await post(command, agent);
    expect(accepted.status).toBe(200);
    const walk = await accepted.json();
    expect(walk).toMatchObject({ requestId: command.requestId, status: 'walking', destination: { place: 'works' } });
    expect(walk.points[0]).toEqual([12.6, 0.184, 72.18]);
    expect(walk.regions).toContain('east');
    expect((await (await post(command, agent)).json()).requestId).toBe(walk.requestId);
    expect((await post({ ...command, destination: { place: 'center' } }, agent)).status).toBe(409);
    expect((await post({ ...command, requestId: randomUUID() }, agent)).status).toBe(409);
    expect((await get('?control=city', other).json()).movement).toBeNull();
    expect((await get('?control=city', owner).json()).movement.requestId).toBe(command.requestId);
    local.nexcivCafeStore?.close();
    local.nexcivCafeStore = undefined;
    vi.setSystemTime(walk.arrivesAt);
    const arrived = await get('?control=city', agent).json();
    expect(arrived).toMatchObject({ movement: { status: 'arrived' }, position: walk.points.at(-1) });
    expect((await post({ action: 'start', kind: 'observer', driver: 'external', busy: false }, agent)).status).toBe(409);

    // This point is in the middle of the café approach, not one of the named stops.
    const coordinate = { x: 12.6, z: 71.5 };
    const returnWalk = await (await post({ action: 'moveTo', destination: coordinate }, agent)).json();
    expect(returnWalk).toMatchObject({ status: 'walking', destination: coordinate, points: expect.any(Array) });
    expect(returnWalk.points[0]).toEqual(arrived.position);
    expect(returnWalk.points.at(-1)).toEqual([12.6, 0.184, 71.5]);
    await post({ action: 'disconnectMcp' }, owner);
    expect((await post({ action: 'moveTo', destination: { place: 'cafe' } }, agent)).status).toBe(401);
    vi.setSystemTime(returnWalk.arrivesAt);
    expect((await get('?control=city', owner).json()).movement.status).toBe('arrived');
  });

  it('keeps observation jobs and free walks from driving the same resident simultaneously', async () => {
    const owner = browser();
    const agent = await redeem(await codeFor(owner));
    const start = { action: 'start', kind: 'observer', driver: 'external', busy: true };
    const move = { action: 'moveTo', destination: { place: 'plaza' } };
    expect((await post(start, agent)).status).toBe(200);
    expect((await post(move, agent)).status).toBe(409);
    vi.setSystemTime(Date.now() + 300000);
    const outbound = await (await post(move, agent)).json();
    expect(outbound.status).toBe('walking');
    expect((await post(start, agent)).status).toBe(409);
    vi.setSystemTime(outbound.arrivesAt);
    const home = await (await post({ ...move, destination: { place: 'cafe' } }, agent)).json();
    vi.setSystemTime(home.arrivesAt);
    expect((await post(start, agent)).status).toBe(200);
    expect((await get('?control=city', owner).json()).movement).toBeNull();
  });

  it('connects every listed destination to every other destination on the published route survey', () => {
    for (const origin of CITY_MAP.places) {
      for (const target of CITY_MAP.places) {
        const route = planCityWalk(origin.position, { place: target.id });
        expect(route, `${origin.id} → ${target.id}`).not.toBeNull();
        expect(route?.points[0]).toEqual(origin.position);
        expect(route?.points.at(-1)).toEqual(target.position);
      }
    }
  });
});
