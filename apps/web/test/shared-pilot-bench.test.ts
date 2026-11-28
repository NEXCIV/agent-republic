import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { modelChoices } from '../src/lib/shared-pilot-model';
import { SharedPilotStore } from '../src/lib/shared-pilot-store';

it('discovers a nearby bench and cafe vendor, reserves the seat once, and recalls finished rest after reopening', () => {
  const folder = mkdtempSync(join(tmpdir(), 'nexciv-shared-bench-'));
  const file = join(folder, 'shared.sqlite');
  let at = 100_000;
  let store = new SharedPilotStore(file, () => at);
  try {
    const a = store.issueCredential('01').token;
    const b = store.issueCredential('02').token;
    const request = { action: 'restAtBench', benchId: 'cafe.bench', requestId: randomUUID() };
    expect(store.observe(a).nearby.some(item => item.id === request.benchId)).toBe(false);
    expect(() => store.restAtBench(a, request)).toThrow(expect.objectContaining({ code: 'UNREACHABLE' }));
    expect(store.observe(b).nearby).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cafe.vendor', kind: 'person' }),
      expect.objectContaining({ id: request.benchId, kind: 'object', available: true }),
    ]));
    expect(modelChoices(store.observe(b)).some(choice => choice.id === 'rest:bench')).toBe(true);
    const heading = store.moveTo(a, { action: 'moveTo', destination: { place: 'cafe' }, requestId: randomUUID() });
    at = heading.arrivesAt;
    expect(store.observe(a).nearby).toContainEqual(expect.objectContaining({ id: 'resident.02', kind: 'resident' }));
    const rest = store.restAtBench(b, request);
    expect(store.restAtBench(b, request)).toMatchObject({ id: rest.id });
    expect(store.observe(a).nearby).toContainEqual(expect.objectContaining({ id: 'cafe.bench', available: false }));
    expect(() => store.restAtBench(a, { ...request, requestId: randomUUID() })).toThrow(expect.objectContaining({ code: 'BUSY' }));
    expect(() => store.moveTo(b, { action: 'moveTo', destination: { place: 'cafe' }, requestId: request.requestId }))
      .toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(store.observe(b).recentRest).toBeNull();
    at = rest.arrivesAt;
    expect(store.observe(b).bench.visits[0]?.stage).toBe('resting');
    expect(() => store.moveTo(b, { action: 'moveTo', destination: { place: 'works' }, requestId: randomUUID() }))
      .toThrow(expect.objectContaining({ code: 'BUSY' }));
    expect(store.observe(b).bench.events.some(event => event.kind === 'REST_FINISHED')).toBe(false);
    at = rest.endsAt;
    store.close();
    store = new SharedPilotStore(file, () => at);
    const finished = store.observe(b);
    expect(finished.recentRest).toMatchObject({ endedAt: rest.endsAt, place: 'cafe' });
    expect(finished.bench.events.filter(event => event.kind === 'REST_FINISHED')).toHaveLength(1);
    expect(finished.nearby).toContainEqual(expect.objectContaining({ id: 'cafe.bench', available: false }));
    expect(modelChoices(finished).some(choice => choice.id === 'rest:bench')).toBe(false);
    expect(store.observe(a).recentRest).toBeNull();
    expect(store.observe(a).nearby).toContainEqual(expect.objectContaining({ id: 'cafe.bench', available: true }));
    expect(store.restAtBench(a, { ...request, requestId: randomUUID() }).residentId).toBe('01');
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
