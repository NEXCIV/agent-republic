import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SharedPilotStore } from '../src/lib/shared-pilot-store';

it('records an actual notice reading and two authenticated theatre choices across a restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexciv-shared-civic-'));
  const file = join(directory, 'shared.sqlite');
  let at = 100_000;
  let store = new SharedPilotStore(file, () => at);
  try {
    const a = store.issueCredential('01').token;
    const b = store.issueCredential('02').token;
    const read = store.readCouncilNotice(a, { action: 'readCouncilNotice', requestId: randomUUID() });
    expect(store.observe(b).council.events).toEqual([]);
    at = read.arrivesAt;
    expect(store.observe(a).council.visits[0]?.stage).toBe('reading');
    at = read.readAt;
    expect(store.observe(a).council.events).toContainEqual(expect.objectContaining({ residentId: '01', kind: 'NOTICE_READ' }));
    const choose = (token: string, decision: string, revision: number, slot?: string) => store.theatreAction(token, {
      action: 'respondTheatre', decision, revision, requestId: randomUUID(), ...(slot && { slot }),
    });
    expect(() => choose(a, 'attend', 0)).toThrow(expect.objectContaining({ code: 'BUSY' }));
    choose(a, 'propose', 0, 'early');
    expect(() => choose(a, 'accept', 1)).toThrow(expect.objectContaining({ code: 'BUSY' }));
    choose(b, 'counter', 1, 'late');
    expect(() => choose(a, 'accept', 1)).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    const agreed = choose(a, 'accept', 2);
    expect(agreed.booking?.slot).toBe('late');
    const joined = choose(b, 'attend', 3);
    choose(a, 'skip', 4);
    expect(joined.attendees).toEqual([]);
    at = agreed.booking!.opensAt + 30_000;
    store.close();
    store = new SharedPilotStore(file, () => at);
    const seating = store.observe(a);
    expect(seating.theatre.attendees).toEqual(['02']);
    expect(seating.theatre.residents['02'].status).toBe('seated');
    expect(seating.residents[1]?.position).toEqual(seating.theatre.residents['02'].position);
    at = seating.residents[1]!.movement!.arrivesAt;
    expect(store.observe(a).residents[1]?.place).toBe('forum');
    expect(store.observe(b).theatre.residents['02'].status).toBe('departed');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('opens a version 8 pilot database with its old place constraint and preserves the active walk', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexciv-shared-civic-migration-'));
  const file = join(directory, 'shared.sqlite');
  let at = 100_000;
  let store = new SharedPilotStore(file, () => at);
  try {
    const token = store.issueCredential('01').token;
    const walk = store.moveTo(token, { action: 'moveTo', requestId: randomUUID(), destination: { place: 'governance' } });
    store.close();
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')!;
    const legacy = new DatabaseSync(file);
    try {
      legacy.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
      for (const table of ['shared_pilot_residents', 'shared_pilot_moves']) {
        const original = String(legacy.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(table)?.sql);
        legacy.exec(original.replace(`CREATE TABLE ${table}`, `CREATE TABLE ${table}_legacy`).replace(",'forum'", ''));
        legacy.exec(`INSERT INTO ${table}_legacy SELECT * FROM ${table}`);
      }
      legacy.exec(`
        DROP TABLE shared_pilot_moves;
        DROP TABLE shared_pilot_residents;
        ALTER TABLE shared_pilot_residents_legacy RENAME TO shared_pilot_residents;
        ALTER TABLE shared_pilot_moves_legacy RENAME TO shared_pilot_moves;
        CREATE UNIQUE INDEX shared_pilot_active_movement ON shared_pilot_moves(resident_id) WHERE completed_at IS NULL;
        PRAGMA user_version=8;
        COMMIT;
      `);
      expect(() => legacy.exec("UPDATE shared_pilot_residents SET place='forum' WHERE id='01'")).toThrow();
    } finally { legacy.close(); }
    store = new SharedPilotStore(file, () => at);
    at = walk.arrivesAt;
    expect(store.observe(token).residents[0]?.place).toBe('governance');
    expect(store.observe(token).events.filter(event => event.kind === 'MOVE_ARRIVED')).toHaveLength(1);
    const next = store.moveTo(token, { action: 'moveTo', requestId: randomUUID(), destination: { place: 'forum' } });
    at = next.arrivesAt;
    expect(store.observe(token).residents[0]?.place).toBe('forum');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
