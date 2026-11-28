import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { modelChoices, parseModelDecision } from '../src/lib/shared-pilot-model';
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
    expect(view.firstExploration).toBeNull();
    expect(view.exploration.events).toHaveLength(2);
    expect(view.exploration.events[1]).toMatchObject({ text: finish.text, reply: expect.stringContaining('阿棠') });
    expect(() => store.explore(a, { ...start, requestId: randomUUID() })).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
