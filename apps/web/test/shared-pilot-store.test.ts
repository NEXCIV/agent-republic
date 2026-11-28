import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CITY_MAP, planCityWalk } from '../src/lib/city-navigation';
import { positionOnWalk } from '../src/lib/city-movement';
import { SharedPilotStore } from '../src/lib/shared-pilot-store';

const sqlite = process.getBuiltinModule?.('node:sqlite') as typeof import('node:sqlite') | undefined;
const START = 1_800_000_000_000;
function point(place: string) { return CITY_MAP.places.find(({ id }) => id === place)!.position; }
const command = (place: string, requestId = randomUUID()) => ({ requestId, action: 'moveTo', destination: { place } });

describe.skipIf(!sqlite)('isolated two-resident shared movement journal', () => {
  let folder: string;
  let file: string;
  let now: number;
  let store: SharedPilotStore | undefined;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'nexciv-shared-pilot-'));
    file = join(folder, 'shared.sqlite');
    now = START;
    vi.stubEnv('NEXCIV_GUEST_DB', join(folder, 'guest.sqlite'));
    vi.stubEnv('NEXCIV_CAFE_DEMO_DB', join(folder, 'local.sqlite'));
  });
  afterEach(() => {
    store?.close();
    store = undefined;
    vi.unstubAllEnvs();
    rmSync(folder, { recursive: true, force: true });
  });
  function open() { return store = new SharedPilotStore(file, () => now); }
  function reopen() { store!.close(); store = undefined; return open(); }
  function residents() {
    const service = open();
    const a = service.issueCredential('01');
    const b = service.issueCredential('02');
    return { service, a, b };
  }
  function externalDb(filename: string): DatabaseSync { return new sqlite!.DatabaseSync(filename); }

  it('requires independently authorized resident slots and refuses client identity or unauthorized actions', () => {
    const { service, a, b } = residents();
    expect(a.token).not.toEqual(b.token);
    expect(service.observe(a.token).residents.map(({ residentId, place, position }) => ({ residentId, place, position })))
      .toEqual([{ residentId: '01', place: 'plaza', position: point('plaza') }, { residentId: '02', place: 'cafe', position: point('cafe') }]);
    expect(service.observe(b.token).residents).toEqual(service.observe(a.token).residents);
    expect(() => service.observe('')).toThrowError(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    expect(() => service.moveTo('unknown', command('governance'))).toThrowError(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    for (const input of [
      { ...command('governance'), residentId: '02' },
      { ...command('governance'), destination: { place: 'governance', x: 34, z: 0 } },
      { ...command('governance'), destination: { x: 0, z: 0 } },
      { ...command('governance'), destination: { place: 'market' } },
      { ...command('governance'), action: 'castVote' },
      command('governance', 'not-a-v4-uuid'),
    ]) {
      expect(() => service.moveTo(a.token, input)).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    }
    expect(service.observe(a.token).events).toHaveLength(0);
    expect(service.observe(a.token)).toMatchObject({ provenance: 'AI_SIMULATED', mode: 'DEMO', viewerResidentId: '01' });
  });

  it('shows the same two simultaneous moves to both viewers, but scopes request receipts to their own resident', () => {
    const { service, a, b } = residents();
    const one = command('governance');
    const other = command('works', one.requestId); // idempotency is scoped per resident
    const first = service.moveTo(a.token, one);
    const second = service.moveTo(b.token, other);
    expect(first).toMatchObject({ requestId: one.requestId, residentId: '01', status: 'ACCEPTED', mode: 'DEMO', provenance: 'AI_SIMULATED', destination: { place: 'governance' } });
    expect(second).toMatchObject({ requestId: other.requestId, residentId: '02', status: 'ACCEPTED', destination: { place: 'works' } });
    expect(service.receipt(a.token, one.requestId)).toEqual(first);
    expect(service.receipt(b.token, other.requestId)).toEqual(second);
    expect(() => service.receipt(b.token, randomUUID())).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    const snapshots = [service.observe(a.token), service.observe(b.token)];
    expect(snapshots[0]!.residents).toEqual(snapshots[1]!.residents);
    expect(snapshots[0]!.events).toEqual(snapshots[1]!.events);
    expect(snapshots[0]!.events.map(({ residentId, kind }) => [residentId, kind])).toEqual([['01', 'MOVE_STARTED'], ['02', 'MOVE_STARTED']]);
    const aMovement = snapshots[0]!.residents[0]!.movement!;
    const bMovement = snapshots[0]!.residents[1]!.movement!;
    expect(aMovement.points).toEqual(planCityWalk(point('plaza'), { place: 'governance' })!.points);
    expect(bMovement.points).toEqual(planCityWalk(point('cafe'), { place: 'works' })!.points);
    expect(aMovement.arrivesAt - aMovement.startedAt).toBe(Math.ceil(aMovement.metres / 4 * 1000));
    expect(bMovement.arrivesAt - bMovement.startedAt).toBe(Math.ceil(bMovement.metres / 4 * 1000));
    now = START + 1000;
    const during = service.observe(a.token);
    expect(during.residents[0]!.position).toEqual(positionOnWalk({ ...aMovement, requestId: one.requestId }, now));
    expect(during.residents[1]!.position).toEqual(positionOnWalk({ ...bMovement, requestId: other.requestId }, now));
    for (const secret of [one.requestId, other.requestId, a.token, b.token, 'token_hash', 'credential']) expect(JSON.stringify(during)).not.toContain(secret);
    now = Math.max(first.arrivesAt, second.arrivesAt);
    const complete = service.observe(a.token);
    expect(complete.residents).toEqual(service.observe(b.token).residents);
    expect(complete.events).toEqual(service.observe(b.token).events);
    expect(complete.residents.map(({ residentId, place, position, movement }) => ({ residentId, place, position, status: movement?.status }))).toEqual([
      { residentId: '01', place: 'governance', position: point('governance'), status: 'arrived' },
      { residentId: '02', place: 'works', position: point('works'), status: 'arrived' },
    ]);
    expect(complete.events.map(({ residentId, kind, happenedAt }) => [residentId, kind, happenedAt])).toEqual([
      ['01', 'MOVE_STARTED', START], ['02', 'MOVE_STARTED', START],
      ...[first, second].sort((left, right) => left.arrivesAt - right.arrivesAt).map(({ residentId, arrivesAt }) => [residentId, 'MOVE_ARRIVED', arrivesAt]),
    ]);
    // Concrete integration trace (never includes a credential or private receipt ID).
    console.info('Shared city DEMO: both viewers saw', JSON.stringify({
      routes: complete.residents.map(({ residentId, movement, position }) => ({
        residentId, metres: Number(movement!.metres.toFixed(2)), seconds: (movement!.arrivesAt - movement!.startedAt) / 1000,
        destination: movement!.destination.place, position,
      })),
      events: complete.events.map(({ residentId, kind, happenedAt }) => ({ residentId, kind, afterSeconds: (happenedAt - START) / 1000 })),
    }));
  });

  it('replays identical request without duplicate events, rejects conflicting request payload and a second in-flight move', () => {
    const { service, a, b } = residents();
    const first = command('governance');
    const accepted = service.moveTo(a.token, first);
    expect(service.moveTo(a.token, first)).toEqual(accepted);
    expect(() => service.moveTo(a.token, command('works', first.requestId))).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() => service.moveTo(a.token, command('works'))).toThrowError(expect.objectContaining({ code: 'BUSY' }));
    expect(() => service.receipt(b.token, first.requestId)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(service.observe(b.token).events).toHaveLength(1);
    now = accepted.arrivesAt;
    const complete = service.receipt(a.token, first.requestId);
    expect(complete.status).toBe('COMPLETED');
    expect(service.moveTo(a.token, first)).toEqual(complete);
    expect(service.observe(b.token).events).toHaveLength(2);
    const next = service.moveTo(a.token, command('works'));
    expect(next.status).toBe('ACCEPTED');
    expect(service.observe(b.token).residents[0]!.position).toEqual(point('governance'));
  });

  it('recovers credentials, active movement, expiry and scheduled arrival exactly after restart', () => {
    const { service, a, b } = residents();
    const accepted = service.moveTo(a.token, command('governance'));
    now = START + 1000;
    const inProgress = service.observe(b.token);
    const restarted = reopen();
    expect(restarted.observe(b.token)).toEqual(inProgress);
    expect(restarted.receipt(a.token, accepted.requestId)).toEqual(accepted);
    now = accepted.arrivesAt + 40000;
    const complete = restarted.observe(b.token);
    expect(complete.residents[0]).toMatchObject({ place: 'governance', position: point('governance'), movement: { status: 'arrived' } });
    expect(complete.events[1]).toMatchObject({ residentId: '01', kind: 'MOVE_ARRIVED', happenedAt: accepted.arrivesAt });
    const again = reopen();
    expect(again.observe(a.token).events).toEqual(complete.events);
    expect(again.receipt(a.token, accepted.requestId)).toMatchObject({ status: 'COMPLETED' });
  });

  it('rotates and revokes credentials without cancelling accepted movement; never stores the raw token', () => {
    const { service, a, b } = residents();
    const accepted = service.moveTo(a.token, command('governance'));
    service.revokeCredential('01');
    expect(() => service.observe(a.token)).toThrowError(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    expect(() => service.receipt(a.token, accepted.requestId)).toThrowError(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    const rotated = service.issueCredential('01', 1000);
    expect(rotated.token).not.toEqual(a.token);
    expect(service.receipt(rotated.token, accepted.requestId)).toEqual(accepted);
    expect(() => service.observe(a.token)).toThrowError(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    now = rotated.expiresAt;
    expect(() => service.observe(rotated.token)).toThrowError(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    now = START; // The expired credential denial has already persisted the trusted time watermark.
    expect(() => service.observe(rotated.token)).toThrowError(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    now = accepted.arrivesAt;
    expect(service.observe(b.token).residents[0]).toMatchObject({ place: 'governance', movement: { status: 'arrived' } });
    now = START;
    expect(() => service.observe(rotated.token)).toThrowError(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    const db = externalDb(file);
    try {
      const credentials = db.prepare('SELECT token_hash FROM shared_pilot_credentials').all();
      expect(credentials.every(({ token_hash }) => typeof token_hash === 'string' && /^[a-f0-9]{64}$/.test(token_hash))).toBe(true);
      expect(credentials).toHaveLength(2);
    } finally { db.close(); }
    service.close(); store = undefined;
    for (const token of [a.token, b.token, rotated.token]) expect(readFileSync(file).includes(Buffer.from(token))).toBe(false);
  });

  it('bounds accepted journal growth while retaining private replay receipts and latest common events', () => {
    const { service, a, b } = residents();
    const first = service.moveTo(a.token, command('plaza'));
    expect(first.status).toBe('COMPLETED');
    for (let i = 1; i < 300; i++) expect(service.moveTo(a.token, command('plaza')).status).toBe('COMPLETED');
    expect(() => service.moveTo(a.token, command('plaza'))).toThrowError(expect.objectContaining({ code: 'LIMIT_REACHED' }));
    expect(service.moveTo(a.token, command('plaza', first.requestId))).toEqual(first);
    expect(service.receipt(a.token, first.requestId)).toEqual(first);
    expect(service.observe(b.token).events).toHaveLength(40);
    expect(service.observe(b.token).revision).toBe('600');
    expect(service.moveTo(b.token, command('cafe')).status).toBe('COMPLETED');
    expect(service.observe(a.token).revision).toBe('602');
  });

  it('refuses relative paths, configured guest/local DB paths, and preexisting unrelated databases without changing them', () => {
    expect(() => new SharedPilotStore('relative.sqlite', () => now)).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    for (const name of ['guest.sqlite', 'local.sqlite']) {
      const other = join(folder, name);
      expect(() => new SharedPilotStore(other, () => now)).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
      expect(existsSync(other)).toBe(false);
    }
    const preexisting = join(folder, 'other.sqlite');
    const db = externalDb(preexisting);
    db.exec('CREATE TABLE original (id INTEGER NOT NULL); INSERT INTO original VALUES (42)');
    db.close();
    const before = readFileSync(preexisting);
    expect(() => new SharedPilotStore(preexisting, () => now)).toThrowError(expect.objectContaining({ code: 'INCOMPATIBLE_DB' }));
    expect(readFileSync(preexisting)).toEqual(before);
  });
});
