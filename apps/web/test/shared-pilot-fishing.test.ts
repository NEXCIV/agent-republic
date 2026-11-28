import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { SharedPilotStore } from '../src/lib/shared-pilot-store';
import { FISHING_SPOT } from '../src/lib/cafe-geometry';
import { FISHING_TIMING, fishingOutcome } from '../src/lib/shared-pilot-fishing';

it('checks the owning session, rejects claimed outcomes, and resumes a single fishing request', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nexciv-fishing-'));
  const store = new SharedPilotStore(path.join(directory, 'city.sqlite'), () => 100000);
  try {
    const { session } = store.claim({ name: '小满', avatar: 'citizen' }, ['01'], '');
    const { token } = store.issueCredential('01');
    const command = { action: 'goFishing', requestId: randomUUID() };
    expect(() => store.goFishing(session, command, ['02'])).toThrow(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    expect(() => store.goFishing(token, { ...command, result: 'released' })).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() => store.fishingTalk('有空位吗？', token)).toThrow(expect.objectContaining({ code: 'UNREACHABLE' }));
    const accepted = store.goFishing(session, command, ['01']);
    expect(store.goFishing(token, command)).toEqual(accepted);
    expect(() => store.moveTo(token, { ...command, action: 'moveTo', destination: { place: 'pier' } })).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(store.observe(token).fishing.visits).toHaveLength(1);
    expect(JSON.stringify(store.observe(token).fishing)).not.toContain(command.requestId);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('gives the first physical arrival the rod and resumes a queued resident after restart', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nexciv-fishing-'));
  const file = path.join(directory, 'city.sqlite');
  let now = 100000;
  let store = new SharedPilotStore(file, () => now);
  try {
    const a = store.issueCredential('01').token;
    const b = store.issueCredential('02').token;
    const trips = [store.goFishing(a, { action: 'goFishing', requestId: randomUUID() }),
      store.goFishing(b, { action: 'goFishing', requestId: randomUUID() })]
      .sort((left, right) => left.arrivesAt - right.arrivesAt);
    expect(store.observe(a).fishing.visits.every(visit => visit.stage === 'travelling')).toBe(true);
    expect(store.fishingTalk('有空位吗？').text).toContain('钓位空着');
    now = trips[0]!.arrivesAt + FISHING_TIMING.approach;
    const casting = store.observe(a);
    expect(casting.fishing.visits.find(visit => visit.residentId === trips[0]!.residentId)?.stage).toBe('casting');
    expect(casting.residents.find(resident => resident.residentId === trips[0]!.residentId)?.position).toEqual(FISHING_SPOT);
    now = trips[1]!.arrivesAt;
    const queue = store.observe(b).fishing;
    expect(queue.visits.find(visit => visit.residentId === trips[1]!.residentId)?.stage).toBe('queued');
    expect(store.fishingTalk('有空位吗？').text).toContain('1 位等候');
    store.close();
    store = new SharedPilotStore(file, () => now);
    expect(store.observe(a).fishing).toEqual(queue);
    now = trips[0]!.arrivesAt + FISHING_TIMING.total;
    const handoff = store.observe(a).fishing;
    expect(handoff.visits.find(visit => visit.residentId === trips[0]!.residentId)?.stage).toBe('completed');
    expect(handoff.visits.find(visit => visit.residentId === trips[1]!.residentId)?.stage).toBe('approaching');
    now += FISHING_TIMING.total;
    const done = store.observe(b).fishing;
    expect(done.visits.every(visit => visit.stage === 'completed' && visit.result)).toBe(true);
    expect(done.events.filter(event => event.kind === 'FISH_FINISHED')).toHaveLength(2);
    expect(store.observe(a).fishing).toEqual(done);
    expect(new Set(Array.from({ length: 16 }, (_, index) => fishingOutcome(100000 + index, '01'))))
      .toEqual(new Set(['released', 'noCatch']));
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
