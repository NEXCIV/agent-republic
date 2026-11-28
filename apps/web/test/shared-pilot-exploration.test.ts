import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { modelChoices, parseModelDecision } from '../src/lib/shared-pilot-model';
import { SharedPilotRuntime } from '../src/lib/shared-pilot-runtime';
import { SharedPilotStore } from '../src/lib/shared-pilot-store';

it('ties spontaneous remarks and an arrival interaction to the same authenticated first trip', () => {
  const folder = mkdtempSync(join(tmpdir(), 'nexciv-first-exploration-'));
  const file = join(folder, 'shared.sqlite');
  let at = 100000;
  let store = new SharedPilotStore(file, () => at);
  try {
    const a = store.issueCredential('01').token;
    const b = store.issueCredential('02').token;
    store.claim({ name: '小满', avatar: 'citizen' }, ['01'], '');
    const before = store.observe(a);
    expect(before.firstExploration).toMatchObject({ phase: 'intro', place: 'plaza' });
    expect(store.observe(b).firstExploration).toBeNull();
    const choices = modelChoices(before);
    const text = '这座城有点意思，先去咖啡街看看！';
    expect(parseModelDecision(JSON.stringify({ choice: 'intro:cafe', text }), choices)).toEqual({ choice: 'intro:cafe', text });
    expect(parseModelDecision(JSON.stringify({ choice: 'intro:cafe', text, residentId: '02' }), choices)).toBeUndefined();
    const start = { action: 'exploreSite', requestId: randomUUID(), place: 'cafe', text };
    expect(() => store.explore(b, start)).toThrow(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    expect(() => store.explore(a, { ...start, text: '看看 https://example.org' })).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() => store.explore(a, { ...start, place: 'unmapped' })).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    const trip = store.explore(a, start);
    expect(store.explore(a, start)).toEqual(trip);
    expect(store.observe(a).firstExploration).toMatchObject({ phase: 'travelling' });
    expect(store.observe(b).exploration.events).toEqual([expect.objectContaining({ residentId: '01', text, provenance: 'AI_SIMULATED' })]);
    expect(JSON.stringify(store.observe(b))).not.toContain(start.requestId);
    const finish = { action: 'exploreArrival', requestId: randomUUID(), activity: 'ask', text: '你好，请问现在需要排队吗？' };
    expect(() => store.explore(a, finish)).toThrow(expect.objectContaining({ code: 'BUSY' }));
    at = store.observe(a).residents[0]!.movement!.arrivesAt;
    store.close();
    store = new SharedPilotStore(file, () => at);
    expect(store.observe(a).firstExploration).toMatchObject({ phase: 'onSite', place: 'cafe' });
    const result = store.explore(a, finish);
    expect(store.explore(a, finish)).toEqual(result);
    const view = store.observe(a);
    expect(view.firstExploration).toMatchObject({ phase: 'followUp', place: 'cafe', exchange: { text: finish.text, reply: result.reply } });
    expect(view.exploration.events).toHaveLength(2);
    expect(view.exploration.events[1]).toMatchObject({ text: finish.text, reply: expect.stringContaining('阿棠') });
    expect(() => store.explore(a, { ...start, requestId: randomUUID() })).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    const followUp = modelChoices(view);
    expect(followUp.map(choice => choice.id)).toEqual(expect.arrayContaining(['visit:coffee:americano', 'visit:move:pier']));
    expect(followUp.map(choice => choice.id)).not.toContain('wait');
    expect(parseModelDecision('{"choice":"visit:fishing:cast"}', followUp)).toBeUndefined();
    const order = followUp.find(choice => choice.id === 'visit:coffee:americano')!.command;
    store.orderCoffee(a, order);
    expect(store.observe(a).firstExploration).toBeNull();
    expect(store.observe(b).cafe.events.map(event => event.kind)).not.toContain('PICKED_UP');
    at = store.observe(a).cafe.orders[0]!.arrivesAt;
    const active = store.observe(a).cafe.orders[0]!;
    at = active.finishedAt!;
    expect(store.observe(b).cafe.events).toContainEqual(expect.objectContaining({ kind: 'PICKED_UP', residentId: '01' }));
    expect(modelChoices(store.observe(a)).map(choice => choice.id)).not.toContain('visit:coffee:americano');
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

it.each([
  { place: 'works', id: 'visit:works:pedestrian-passage', command: 'inspectWorks' },
  { place: 'pier', id: 'visit:fishing:cast', command: 'goFishing' },
] as const)('accepts the available activity at $place and publishes its actual outcome', ({ place, id, command }) => {
  const folder = mkdtempSync(join(tmpdir(), 'nexciv-exploration-activity-'));
  let at = 100_000;
  const runtime = new SharedPilotRuntime(join(folder, 'shared.sqlite'), () => at, true, []);
  try {
    const profile = runtime.claimProfile({ name: '小满', avatar: 'citizen' }, ['01'], '');
    const key = runtime.setProfileKey(profile.session, true, ['01']).key!;
    const act = (body: Parameters<typeof runtime.actWithProfileKey>[2]) => runtime.actWithProfileKey(key, ['01'], body);
    const observe = () => act({ action: 'observe' }) as ReturnType<SharedPilotStore['observe']>;
    act({ action: 'exploreSite', requestId: randomUUID(), place, text: '去看看那里有什么。' });
    at = observe().residents[0]!.movement!.arrivesAt;
    act({ action: 'exploreArrival', requestId: randomUUID(), activity: 'look', text: '先看看现场。' });
    const choices = modelChoices(observe());
    const activity = choices.find(choice => choice.id === id)!.command!;
    expect(activity.action).toBe(command);
    expect(choices.some(choice => choice.id === 'visit:move:plaza')).toBe(true);
    act(activity);
    expect(observe().firstExploration).toBeNull();
    const events = () => {
      const snapshot = runtime.snapshot();
      return [...snapshot.works.events, ...snapshot.fishing.events];
    };
    const completed = place === 'works' ? 'INSPECTION_RECORDED' : 'FISH_FINISHED';
    expect(events().some(event => event.kind === completed)).toBe(false);
    at = observe().residents[0]!.movement!.arrivesAt;
    observe(); // Settle the arrival before advancing through observation or fishing.
    at += 60_000;
    expect(events()).toContainEqual(expect.objectContaining({ kind: completed, residentId: '01', provenance: 'AI_SIMULATED' }));
  } finally {
    runtime.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
