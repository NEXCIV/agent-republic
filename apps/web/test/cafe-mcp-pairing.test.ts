import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../src/app/api/nexciv-preview/cafe/route';
import type { CafeDemoStore } from '../src/lib/cafe-demo-store';
import { CITY_MAP, planCityWalk } from '../src/lib/city-navigation';
import { applyTheatreDecision, observeTheatre, type TheatreDecision, type TheatreContext, type TheatreTrial } from '../src/lib/theatre-trial';

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

  it('offers only local actions and records a persistent construction walk with real waypoint arrivals', async () => {
    const owner = browser();
    const visitor = browser();
    const agent = await redeem(await codeFor(owner));
    const inspect = { action: 'interactCity', actionId: 'works.patrol', requestId: randomUUID() };
    expect((await get('?control=city', agent).json()).availableActions).toEqual([]);
    expect((await post(inspect, agent)).status).toBe(422);
    const walk = await (await post({ action: 'moveTo', destination: { place: 'works' } }, agent)).json();
    expect((await post(inspect, agent)).status).toBe(409);
    vi.setSystemTime(walk.arrivesAt);
    const site = await get('?control=city', agent).json();
    expect(site.nearby.place).toBe('works');
    expect(site.availableActions.map(({ kind }: { kind: string }) => kind)).toEqual(['talk', 'rest', 'work']);
    expect((await post({ ...inspect, actionId: 'works.unlisted' }, agent)).status).toBe(422);

    const response = await post(inspect, agent);
    expect(response.status).toBe(200);
    const started = await response.json();
    expect(started).toMatchObject({ status: 'running', kind: 'work', requestId: inspect.requestId });
    expect(started.events.filter(({ type }: { type: string }) => type === 'checkpoint')).toHaveLength(0);
    const live = await get('?control=city', owner).json();
    expect(live.recentActivities[0].requestId).toBe(inspect.requestId);
    expect(live.movement).toMatchObject({ requestId: inspect.requestId, status: 'walking' });
    expect(live.availableActions).toEqual([]);
    expect((await post(inspect, agent)).status).toBe(200);
    expect((await post({ ...inspect, actionId: 'works.rest' }, agent)).status).toBe(409);
    expect((await post({ action: 'moveTo', destination: { place: 'plaza' } }, agent)).status).toBe(409);
    expect((await get('?control=city', visitor).json()).recentActivities).toEqual([]);
    expect((await post({ action: 'disconnectMcp' }, owner)).status).toBe(200);
    expect((await post(inspect, agent)).status).toBe(401);

    local.nexcivCafeStore?.close();
    local.nexcivCafeStore = undefined;
    vi.setSystemTime(started.endsAt);
    const finished = await get('?control=city', owner).json();
    const activity = finished.recentActivities[0];
    expect(activity.status).toBe('completed');
    expect(activity.events.filter(({ type }: { type: string }) => type === 'checkpoint')).toHaveLength(2);
    expect(activity.events.at(-1).type).toBe('completed');
    expect(finished.position).toEqual(site.position);
    expect(finished.energy).toBeLessThan(site.energy);
    expect(finished.canMove).toBe(true);
  });

  it('unlocks the demo agenda at the council, records reading at the board and keeps the new position', async () => {
    const owner = browser();
    const other = browser();
    const agent = await redeem(await codeFor(owner));
    const read = { action: 'interactCity', actionId: 'governance.read', requestId: randomUUID() };
    expect((await post(read, agent)).status).toBe(422);
    const trip = await (await post({ action: 'moveTo', destination: { place: 'governance' } }, agent)).json();
    expect((await post(read, agent)).status).toBe(409);
    vi.setSystemTime(trip.arrivesAt);
    const arrival = await get('?control=city', owner).json();
    expect(arrival.nearby.place).toBe('governance');
    expect(arrival.availableActions).toEqual([
      { id: 'governance.read', label: '查看议事公告', kind: 'read', target: 'governance.notice' },
    ]);
    const response = await post(read, agent);
    expect(response.status).toBe(200);
    const activity = await response.json();
    expect(activity).toMatchObject({ status: 'running', kind: 'read', place: 'governance' });
    expect(activity.events.map(({ type }: { type: string }) => type)).toEqual(['started']);
    expect((await (await post(read, agent)).json()).requestId).toBe(read.requestId);

    const walking = await get('?control=city', owner).json();
    expect(walking.movement).toMatchObject({
      requestId: read.requestId, status: 'walking', name: '议事公告栏', regions: ['north'],
    });
    expect(walking.movement.metres).toBeGreaterThan(5);
    expect((await post({ action: 'moveTo', requestId: read.requestId, destination: { x: 5.5, z: -77.75 } }, agent)).status).toBe(409);
    expect((await get('?control=city', other).json()).recentActivities).toEqual([]);

    local.nexcivCafeStore?.close();
    local.nexcivCafeStore = undefined;
    vi.setSystemTime(walking.movement.arrivesAt);
    const reading = await get('?control=city', owner).json();
    expect(reading.position).toEqual([5.5, 0.182, -77.75]);
    expect(reading.movement.status).toBe('arrived');
    expect(reading.recentActivities[0]).toMatchObject({
      status: 'running', events: [expect.any(Object), { type: 'checkpoint', position: reading.position, at: expect.any(Number), text: '已到达议事公告栏。' }],
    });
    expect(reading.availableActions).toEqual([]);
    expect((await post({ action: 'moveTo', destination: { place: 'plaza' } }, agent)).status).toBe(409);
    vi.setSystemTime(activity.endsAt);
    const done = await get('?control=city', owner).json();
    expect(done.position).toEqual(reading.position);
    expect(done.energy).toBe(arrival.energy);
    expect(done.recentActivities[0]).toMatchObject({ status: 'completed', actionId: 'governance.read' });
    expect(done.recentActivities[0].events.at(-1)).toMatchObject({
      type: 'completed', text: expect.stringMatching(/^DEMO 议程.*湖畔步道.*社区剧场/),
    });
    const next = await (await post({ action: 'moveTo', destination: { place: 'plaza' } }, agent)).json();
    expect(next.points[0]).toEqual(reading.position);
    expect(planCityWalk([7.35, 0.182, -76.3], { x: 5.5, z: -77.75 })?.points.at(-1)).toEqual(reading.position);
  });

  it('unlocks the lakeside survey from the agenda and accepts a report only after both observations and return', async () => {
    const owner = browser();
    const other = browser();
    const agent = await redeem(await codeFor(owner));
    const survey = { action: 'interactCity', actionId: 'governance.survey', requestId: randomUUID() };
    const submit = { action: 'interactCity', actionId: 'governance.submit', requestId: randomUUID() };
    const install = { action: 'interactCity', actionId: 'works.install-light', requestId: randomUUID() };
    const eveningBefore = (await get('?control=city', agent).json()).eveningWalk;
    expect(eveningBefore).toMatchObject({
      agentId: '03', goal: expect.any(String), energy: 64, lighting: { state: 'not-installed' },
    });
    expect(eveningBefore.options.map(({ id }: { id: string }) => id)).toEqual(['waterfront', 'main-path', 'home']);
    const choose = {
      action: 'chooseEveningWalk', requestId: randomUUID(),
      choice: { observationId: eveningBefore.observationId, optionId: 'main-path', reasonId: 'existing-lamp' },
    };
    expect((await post(choose, other)).status).toBe(409);
    expect((await post({ ...choose, choice: { ...choose.choice, reasonId: 'pilot-light' } }, agent)).status).toBe(422);
    const walked = await post(choose, agent);
    expect(walked.status).toBe(200);
    const firstWalk = await walked.json();
    expect(firstWalk).toMatchObject({ status: 'running', observation: { lighting: { state: 'not-installed' } }, selection: choose.choice });
    expect(firstWalk.activity.events.map(({ type }: { type: string }) => type)).toEqual(['started']);
    expect((await (await post(choose, agent)).json()).activity.requestId).toBe(choose.requestId);
    expect((await post({ ...choose, requestId: randomUUID() }, agent)).status).toBe(409);
    const inTransit = await get('?control=city', owner).json();
    expect(inTransit.canMove).toBe(true);
    expect(inTransit.eveningWalk.recent[0].movement.status).toBe('walking');
    vi.setSystemTime(firstWalk.activity.endsAt);
    const atLamp = (await get('?control=city', owner).json()).eveningWalk;
    expect(atLamp.position).toEqual([21, 0.19, -165.3]);
    expect(atLamp.recent[0].activity.events.map(({ type }: { type: string }) => type)).toEqual(['started', 'checkpoint', 'completed']);
    expect((await post(install, agent)).status).toBe(422);
    const trip = await (await post({ action: 'moveTo', destination: { place: 'governance' } }, agent)).json();
    vi.setSystemTime(trip.arrivesAt);
    expect((await post(survey, agent)).status).toBe(422);
    expect((await post(submit, agent)).status).toBe(422);
    const read = await (await post({ action: 'interactCity', actionId: 'governance.read' }, agent)).json();
    vi.setSystemTime(read.endsAt);
    const initial = await get('?control=city', owner).json();
    expect(initial.lightingSurvey).toBe('available');
    expect(initial.availableActions).toContainEqual(expect.objectContaining({ id: survey.actionId }));
    const response = await post(survey, agent);
    expect(response.status).toBe(200);
    const started = await response.json();
    expect(started.events.map(({ type }: { type: string }) => type)).toEqual(['started']);
    expect((await post(submit, agent)).status).toBe(409);
    const walking = await get('?control=city', owner).json();
    expect(walking.lightingSurvey).toBe('surveying');
    expect(walking.movement.regions).toEqual(expect.arrayContaining(['north', 'shore']));
    const [first, second] = walking.movement.stops;
    vi.setSystemTime(first.startsAt + 1000);
    const observing = await get('?control=city', agent).json();
    expect(observing.position).toEqual(first.position);
    expect(observing.recentActivities[0].events.map(({ type }: { type: string }) => type)).toEqual(['started', 'checkpoint']);
    vi.setSystemTime(second.startsAt + 1000);
    const halfway = await get('?control=city', owner).json();
    expect(halfway.position).toEqual(second.position);
    expect(halfway.recentActivities[0].events.filter(({ type }: { type: string }) => type === 'observation')).toHaveLength(1);
    expect((await get('?control=city', other).json()).lightingSurvey).toBeUndefined();

    local.nexcivCafeStore?.close();
    local.nexcivCafeStore = undefined;
    vi.setSystemTime(started.endsAt);
    const returned = await get('?control=city', owner).json();
    expect(returned.position).toEqual(initial.position);
    expect(returned.lightingSurvey).toBe('ready');
    expect(returned.recentActivities[0].events.filter(({ type }: { type: string }) => type === 'observation')).toHaveLength(2);
    const accepted = await post(submit, agent);
    expect(accepted.status).toBe(200);
    const report = await accepted.json();
    expect(report.events.at(-1).text).toMatch(/^DEMO.*已收到调研报告.*16 米.*低位步道灯/);
    expect((await (await post(submit, agent)).json()).requestId).toBe(submit.requestId);
    expect((await post({ ...submit, requestId: randomUUID() }, agent)).status).toBe(422);
    const displayed = await get('?control=city', owner).json();
    expect(displayed.lightingSurvey).toBe('submitted');
    expect(displayed.recentActivities[0]).toMatchObject({ status: 'completed', requestId: submit.requestId });
    expect((await get('?control=city', other).json()).recentActivities).toEqual([]);

    expect(displayed.lightingPilot).toMatchObject({ stage: 'review', approvedAt: expect.any(Number) });
    expect((await post(install, agent)).status).toBe(422);
    vi.setSystemTime(displayed.lightingPilot.approvedAt);
    const approved = await get('?control=city', agent).json();
    expect(approved.lightingPilot.stage).toBe('approved');
    expect(approved.availableActions).toContainEqual(expect.objectContaining({ id: install.actionId, agentId: '02' }));
    expect((await post(install, other)).status).toBe(422);
    const dispatch = await post(install, agent);
    expect(dispatch.status).toBe(200);
    const job = await dispatch.json();
    expect(job).toMatchObject({ agentId: '02', status: 'running', requestId: install.requestId });
    expect(await (await post(install, agent)).json()).toEqual(job);
    expect((await post({ ...install, requestId: randomUUID() }, agent)).status).toBe(422);
    const enRoute = await get('?control=city', owner).json();
    expect(enRoute.position).toEqual(returned.position);
    expect(enRoute.lightingPilot.stage).toBe('dispatch');
    expect(enRoute.lightingPilot.worker.position).toEqual(CITY_MAP.places.find(({ id }) => id === 'works')?.position);
    expect(enRoute.lightingPilot.worker.movement.regions).toEqual(expect.arrayContaining(['east', 'north', 'shore']));
    expect((await post({ action: 'moveTo', destination: { place: 'plaza' } }, agent)).status).toBe(200);

    vi.setSystemTime(enRoute.lightingPilot.worker.movement.arrivesAt);
    const working = await get('?control=city', owner).json();
    expect(working.lightingPilot.stage).toBe('installing');
    expect(working.lightingPilot.worker.activity.events.map(({ type }: { type: string }) => type)).toEqual(['started', 'checkpoint']);
    expect(working.lightingPilot.worker.position).toEqual([13, 0.19, -168.43]);
    expect(working.lightingPilot.lamp).toBeUndefined();
    vi.setSystemTime(job.endsAt - 1);
    expect((await get('?control=city', owner).json()).lightingPilot.stage).toBe('installing');
    local.nexcivCafeStore?.close();
    local.nexcivCafeStore = undefined;
    vi.setSystemTime(job.endsAt);
    const lit = await get('?control=city', owner).json();
    expect(lit.lightingPilot).toMatchObject({ stage: 'lit', lamp: { position: [13, 0.19, -169.24], litAt: job.endsAt } });
    expect(lit.lightingPilot.worker.activity.events.at(-1).text).toContain('低位灯已亮');
    expect((await get('?control=city', other).json()).lightingPilot).toBeUndefined();
    expect((await (await post(install, agent)).json()).status).toBe('completed');
    expect((await post({ ...install, requestId: randomUUID() }, agent)).status).toBe(422);
    expect(await get('?newspaper=latest', owner).json()).toEqual({ issues: [], current: null });

    const eveningAfter = lit.eveningWalk;
    expect(eveningAfter.lighting).toMatchObject({
      state: 'lit', source: { activityId: job.requestId, litAt: job.endsAt, position: [13, 0.19, -169.24] },
    });
    expect(eveningAfter.lighting.state).not.toEqual(eveningBefore.lighting.state);
    expect((await post({ ...choose, requestId: randomUUID() }, agent)).status).toBe(409);
    const atWater = await post({
      ...choose, requestId: randomUUID(),
      choice: { observationId: eveningAfter.observationId, optionId: 'waterfront', reasonId: 'pilot-light' },
    }, agent);
    expect(atWater.status).toBe(200);
    const secondWalk = await atWater.json();
    expect(secondWalk.movement.points[0]).toEqual(atLamp.position);
    expect(secondWalk.observation.lighting.source.activityId).toBe(job.requestId);
    vi.setSystemTime(secondWalk.activity.endsAt - 1);
    expect(await get('?newspaper=latest', owner).json()).toEqual({ issues: [], current: null });
    local.nexcivCafeStore?.close();
    local.nexcivCafeStore = undefined;
    vi.setSystemTime(secondWalk.activity.endsAt);
    const restored = (await get('?control=city', owner).json()).eveningWalk;
    expect(restored.position).toEqual([13, 0.19, -165.3]);
    expect(restored.recent.map(({ status }: { status: string }) => status)).toEqual(['completed', 'completed']);
    expect((await get('?control=city', other).json()).eveningWalk.recent).toEqual([]);
    const paper = await get('?newspaper=latest', owner).json();
    expect(paper.current).toMatchObject({
      kind: 'city', sceneActivityId: job.requestId,
      issue: { id: `city-${job.requestId}`, publishedAt: secondWalk.activity.endsAt, headline: expect.stringContaining('临水步道') },
    });
    expect(paper.current.sources.map(({ id }: { id: string }) => id))
      .toEqual([submit.requestId, job.requestId, firstWalk.activity.requestId, secondWalk.activity.requestId]);
    expect(paper.current.sources[3].notes.join(' ')).toContain('已到达东侧临水步道');
    expect(paper.issues).toHaveLength(1);
    expect(await get('?newspaper=latest', agent).json()).toEqual(paper);
    expect(await get(`?newspaper=${paper.current.issue.id}`, owner).json()).toEqual(paper);
    expect(get(`?newspaper=${paper.current.issue.id}`, other).status).toBe(404);
    expect(await get('?newspaper=latest', other).json()).toEqual({ issues: [], current: null });
  });

  it('persists a local conversation and restores a resident’s energy after resting', async () => {
    const owner = browser();
    const agent = await redeem(await codeFor(owner));
    const walk = await (await post({ action: 'moveTo', destination: { place: 'works' } }, agent)).json();
    vi.setSystemTime(walk.arrivesAt);
    const before = await get('?control=city', agent).json();
    const chat = await (await post({ action: 'interactCity', actionId: 'works.chat' }, agent)).json();
    expect(chat.events.some(({ type }: { type: string }) => type === 'reply')).toBe(false);
    vi.setSystemTime(chat.endsAt);
    const afterChat = await get('?control=city', agent).json();
    expect(afterChat.recentActivities[0].events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'reply', speaker: '现场管理员', text: expect.stringContaining('巡查') }),
    ]));
    const rest = await (await post({ action: 'interactCity', actionId: 'works.rest' }, agent)).json();
    expect((await get('?control=city', agent).json()).energy).toBe(before.energy);
    vi.setSystemTime(rest.endsAt);
    const afterRest = await get('?control=city', agent).json();
    expect(afterRest.energy).toBeGreaterThan(before.energy);
    expect(afterRest.recentActivities.map(({ kind }: { kind: string }) => kind)).toEqual(['rest', 'talk']);
  });

  it('lets 03 walk home to rest while preserving 01’s position and current energy', async () => {
    const owner = browser();
    const agent = await redeem(await codeFor(owner));
    const initial = await get('?control=city', agent).json();
    const plan = { observationId: initial.eveningWalk.observationId, optionId: 'home', reasonId: 'rest' };
    const response = await post({ action: 'chooseEveningWalk', choice: plan }, agent);
    expect(response.status).toBe(200);
    const home = await response.json();
    expect(home.movement.regions).toContain('residential');
    vi.setSystemTime(home.movement.arrivesAt);
    const resting = await get('?control=city', owner).json();
    expect(resting.eveningWalk.position).toEqual(CITY_MAP.places.find(({ id }) => id === 'residence')?.position);
    expect(resting.eveningWalk.recent[0].status).toBe('running');
    expect(resting.eveningWalk.energy).toBeLessThan(initial.eveningWalk.energy);
    vi.setSystemTime(home.activity.endsAt);
    const final = await get('?control=city', owner).json();
    expect(final.eveningWalk.energy).toBeGreaterThan(resting.eveningWalk.energy);
    expect(final.position).toEqual(initial.position);
    expect(final.energy).toBe(initial.energy);
  });

  it('records a theatre counteroffer, starts admission on time and counts only seated residents', async () => {
    const owner = browser();
    const other = browser();
    const agent = await redeem(await codeFor(owner));
    const offer = { action: 'theatreDecision', revision: 0, agentId: '01', decision: 'propose', slot: 'early', requestId: randomUUID() };
    expect((await post(offer, agent)).status).toBe(422);
    const trip = await (await post({ action: 'moveTo', destination: { place: 'governance' } }, agent)).json();
    vi.setSystemTime(trip.arrivesAt);
    const read = await (await post({ action: 'interactCity', actionId: 'governance.read' }, agent)).json();
    vi.setSystemTime(read.endsAt);
    const available = (await get('?control=city', owner).json()).theatre;
    expect(available).toMatchObject({ phase: 'available', revision: 0 });
    expect(available.slots).toHaveLength(2);
    expect((await post(offer, other)).status).toBe(422);
    const proposal = await post(offer, agent);
    expect(proposal.status).toBe(200);
    const proposed = await proposal.json();
    expect(proposed).toMatchObject({ phase: 'negotiating', revision: 1, offer: { slot: 'early', by: '01' } });
    expect((await (await post(offer, agent)).json()).revision).toBe(1);
    expect((await post({ ...offer, requestId: randomUUID(), revision: 1, decision: 'accept', slot: undefined }, agent)).status).toBe(422);
    const counter = await (await post({
      action: 'theatreDecision', revision: 1, agentId: '03', decision: 'counter', slot: 'late',
    }, agent)).json();
    expect(counter).toMatchObject({ revision: 2, offer: { slot: 'late', by: '03' } });
    expect((await post({ action: 'theatreDecision', revision: 1, agentId: '01', decision: 'accept' }, agent)).status).toBe(409);
    const booked = await (await post({ action: 'theatreDecision', revision: 2, agentId: '01', decision: 'accept' }, agent)).json();
    expect(booked).toMatchObject({ phase: 'scheduled', booking: { slot: 'late' } });
    expect(booked.attendees).toEqual([]);

    const first = await (await post({ action: 'theatreDecision', revision: booked.revision, agentId: '01', decision: 'attend' }, agent)).json();
    expect(first.residents['01'].status).toBe('en-route');
    expect((await post({ action: 'moveTo', destination: { place: 'plaza' } }, agent)).status).toBe(409);
    const second = await (await post({ action: 'theatreDecision', revision: first.revision, agentId: '03', decision: 'attend' }, agent)).json();
    expect(second.residents['03'].status).toBe('en-route');
    vi.setSystemTime(booked.booking.opensAt - 1);
    const queued = (await get('?control=city', owner).json()).theatre;
    expect(queued.phase).toBe('scheduled');
    expect(queued.residents['01'].status).toBe('waiting');
    expect(['waiting', 'en-route']).toContain(queued.residents['03'].status);
    expect(queued.attendees).toEqual([]);
    vi.setSystemTime(booked.booking.opensAt);
    const open = (await get('?control=city', owner).json()).theatre;
    expect(open.phase).toBe('open');
    expect(open.residents['01'].status).toBe('entering');
    expect(open.attendees).toEqual([]);
    local.nexcivCafeStore?.close();
    local.nexcivCafeStore = undefined;
    vi.setSystemTime(Math.max(open.residents['01'].seatedAt, open.residents['03'].seatedAt));
    const seated = (await get('?control=city', owner).json()).theatre;
    expect(seated.attendees).toEqual(['01', '03']);
    expect(seated.residents['01'].position).not.toEqual(seated.residents['03'].position);
    expect(seated.events.map(({ type }: { type: string }) => type)).toEqual(expect.arrayContaining(['counter', 'open', 'seat']));
    expect((await get('?control=city', other).json()).theatre).toBeUndefined();
    vi.setSystemTime(booked.booking.closesAt + 10000);
    const final = (await get('?control=city', owner).json()).theatre;
    expect(final.phase).toBe('finished');
    expect(final.attendees).toEqual(['01', '03']);
    expect((await post({ action: 'moveTo', destination: { place: 'plaza' } }, agent)).status).toBe(200);
  });

  it('keeps declining a proposed time distinct from agreeing to a time and then skipping the show', () => {
    const position = CITY_MAP.places.find(({ id }) => id === 'forum')!.position;
    const context: TheatreContext = { '01': { position, energy: 68, busy: false }, '03': { position, energy: 64, busy: false } };
    const now = Date.now();
    function pick(state: TheatreTrial | undefined, choice: Omit<TheatreDecision, 'revision'>) {
      const result = applyTheatreDecision(state, context, { ...choice, revision: state?.commands.length ?? 0 }, randomUUID(), now);
      if ('error' in result) throw new Error(result.error);
      return result.state;
    }
    const proposed = () => pick(undefined, { agentId: '01', decision: 'propose', slot: 'early' });
    const cancelled = pick(proposed(), { agentId: '03', decision: 'decline' });
    expect(observeTheatre(cancelled, context, now)).toMatchObject({ phase: 'cancelled', attendees: [], booking: undefined });
    const booked = pick(proposed(), { agentId: '03', decision: 'accept' });
    const absent = pick(booked, { agentId: '03', decision: 'skip' });
    const standing = pick(absent, { agentId: '01', decision: 'attend' });
    const closed = observeTheatre(standing, context, booked.booking!.closesAt + 10000);
    expect(closed.residents['03']).toMatchObject({ status: 'absent' });
    expect(closed.residents['03'].walk).toBeUndefined();
    expect(closed.attendees).toEqual(['01']);
    expect(closed.events.filter(({ type }) => type === 'skip')).toHaveLength(1);
  });
});
