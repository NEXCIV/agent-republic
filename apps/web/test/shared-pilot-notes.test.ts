import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { GET, POST } from '../src/app/api/nexciv-preview/shared/route';
import type { SharedPilotRuntime } from '../src/lib/shared-pilot-runtime';
import { SharedPilotStore } from '../src/lib/shared-pilot-store';
import { parseModelConfig, parseModelDecision, SharedPilotModelRun } from '../src/lib/shared-pilot-model';
import { NOTE_LIFETIME_MS } from '../src/lib/shared-pilot-notes';

it('keeps player notes private, accepts only an actual city action and handles retries once', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'nexciv-player-notes-'));
  const local = globalThis as typeof globalThis & { nexcivSharedPilot?: { runtime: SharedPilotRuntime } };
  const origin = 'http://127.0.0.1:3142';
  const url = origin + '/api/nexciv-preview/shared';
  const host = new URL(origin).host;
  const browser = (body: unknown, cookie = '') => POST(new NextRequest(url + '?profile=1', {
    method: 'POST', headers: { host, origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  const agent = (key: string, body: unknown) => POST(new NextRequest(url, {
    method: 'POST', headers: { host, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  const city = async (cookie = '') => (await GET(new NextRequest(url, { headers: { host, cookie } }))).json();
  try {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXCIV_SHARED_PILOT_DB', join(folder, 'private.sqlite'));
    vi.stubEnv('NEXCIV_SHARED_AGENT_01_KEY', '');
    vi.stubEnv('NEXCIV_SHARED_AGENT_02_KEY', '');
    vi.stubEnv('NEXCIV_SHARED_AGENT_KEY', '');
    const claim = async (name: string) => (await browser({ action: 'claim', name, avatar: 'citizen' })).headers.get('set-cookie')!.split(';')[0]!;
    const a = await claim('小满');
    const b = await claim('阿禾');
    const keyA = (await (await browser({ action: 'issue' }, a)).json()).key;
    const keyB = (await (await browser({ action: 'issue' }, b)).json()).key;
    const note = { action: 'submitPlayerNote', noteId: randomUUID(), text: '今天想去码头看看。' };
    expect((await browser(note)).status).toBe(401);
    expect((await browser({ ...note, residentId: '02' }, a)).status).toBe(400);
    expect((await browser(note, a)).status).toBe(200);
    expect((await (await browser(note, a)).json()).status).toBe('pending');
    expect((await browser({ ...note, noteId: randomUUID() }, a)).status).toBe(409);
    expect((await city(a)).ownNotes[0]).toMatchObject({ text: note.text, status: 'pending' });
    expect(JSON.stringify(await city(b))).not.toContain(note.text);
    expect(JSON.stringify(await city())).not.toContain(note.text);
    expect((await (await agent(keyA, { action: 'observe' })).json()).playerNotes[0].text).toBe(note.text);
    expect((await (await agent(keyB, { action: 'observe' })).json()).playerNotes).toEqual([]);
    const response = { action: 'resolvePlayerNote', noteId: note.noteId, decision: 'adapted',
      reason: '先走到码头看看现场。', activity: { action: 'moveTo', requestId: randomUUID(), destination: { place: 'pier' } } };
    expect((await agent(keyB, response)).status).toBe(409);
    expect((await agent(keyA, { ...response, activity: { ...response.activity, destination: { place: 'unlisted' } } })).status).toBe(400);
    expect((await city(a)).ownNotes[0].status).toBe('pending');
    expect((await (await agent(keyA, response)).json())).toMatchObject({ status: 'adapted', activityLabel: '前往北岸码头' });
    expect((await agent(keyA, response)).status).toBe(200);
    expect((await agent(keyA, { ...response, reason: '修改结果' })).status).toBe(409);
    const snapshot = await city(a);
    expect(snapshot.ownNotes[0]).toMatchObject({ status: 'adapted', reason: response.reason });
    expect(snapshot.events.filter((event: { kind: string }) => event.kind === 'MOVE_STARTED')).toHaveLength(1);
    expect(JSON.stringify(await city(b))).not.toContain(response.reason);
    local.nexcivSharedPilot?.runtime.close();
    local.nexcivSharedPilot = undefined;
    expect((await city(a)).ownNotes[0].status).toBe('adapted');
  } finally {
    local.nexcivSharedPilot?.runtime.close();
    local.nexcivSharedPilot = undefined;
    vi.unstubAllEnvs();
    rmSync(folder, { recursive: true, force: true });
  }
});

it('uses different local options for the same note and expires an unhandled note at the deadline', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'nexciv-player-note-model-'));
  let at = 100_000;
  const store = new SharedPilotStore(join(folder, 'private.sqlite'), () => at);
  const runs: SharedPilotModelRun[] = [];
  const config = parseModelConfig({ baseUrl: 'https://example.com/v1', model: 'test-model', apiKey: 'test-key' })!;
  vi.useFakeTimers();
  try {
    const seats = ['01', '02'] as const;
    const plans = [
      { place: 'cafe', choice: 'note:visit:coffee:americano', activityLabel: '点一杯美式咖啡' },
      { place: 'works', choice: 'note:visit:works:entrance-path', activityLabel: '巡查入口外侧步道' },
    ] as const;
    const advice = '今天多了解一下附近吧。';
    for (const [index, residentId] of seats.entries()) {
      const credentials = store.claim({ name: `居民${index + 1}`, avatar: 'citizen' }, seats, '');
      const { token } = store.issueCredential(residentId);
      const plan = plans[index]!;
      const observe = () => store.observe(token);
      store.explore(token, { action: 'exploreSite', place: plan.place, requestId: randomUUID(), text: '我想看看这座城。' });
      at = observe().residents[index]!.movement!.arrivesAt;
      store.explore(token, { action: 'exploreArrival', activity: 'look', requestId: randomUUID(), text: '先看看周围。' });
      store.submitPlayerNote(credentials.session, { action: 'submitPlayerNote', noteId: randomUUID(), text: advice }, seats);
      const run = new SharedPilotModelRun(config, observe, command => {
        if (command.action !== 'resolvePlayerNote') throw new Error('Expected a private note response');
        return store.resolvePlayerNote(token, command);
      }, async (_config, observation, choices) => {
        expect(observation.playerNotes[0]?.text).toBe(advice);
        expect(choices.map(choice => choice.id)).not.toContain(plans[1 - index]!.choice);
        expect(parseModelDecision(JSON.stringify({ choice: plan.choice, decision: 'skipped', reason: '不能略过并执行' }), choices)).toBeUndefined();
        return parseModelDecision(JSON.stringify({ choice: plan.choice, decision: 'adopted', reason: '先体验这个地方。' }), choices)!;
      });
      runs.push(run);
      run.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(observe().playerNotes[0]).toMatchObject({ status: 'adopted', activityLabel: plan.activityLabel });
      run.stop();
      if (index === 1) {
        const noteId = randomUUID();
        store.submitPlayerNote(credentials.session, { action: 'submitPlayerNote', noteId, text: advice }, seats);
        at += NOTE_LIFETIME_MS;
        expect(observe().playerNotes.at(-1)?.status).toBe('expired');
        expect(() => store.resolvePlayerNote(token, { action: 'resolvePlayerNote', noteId, decision: 'skipped', reason: '已过期' }))
          .toThrow(expect.objectContaining({ code: 'CONFLICT' }));
      }
    }
  } finally {
    runs.forEach(run => run.stop());
    vi.useRealTimers();
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
