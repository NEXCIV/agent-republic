import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CafeDemoStore } from '../src/lib/cafe-demo-store';
import { advanceCafe, beginCafe } from '../src/lib/cafe-life';

const supported = Boolean(process.getBuiltinModule?.('node:sqlite'));
describe.skipIf(!supported)('café shift persistence', () => {
  const folders: string[] = [];
  const stores: CafeDemoStore[] = [];
  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'nexciv-cafe-'));
    folders.push(dir);
    return join(dir, 'shifts.sqlite');
  }
  function open(file: string, schedule = false) {
    const store = new CafeDemoStore(file, () => Date.now(), schedule);
    stores.push(store);
    return store;
  }
  function start(store: CafeDemoStore, id: string, busy = false, resident = 'resident') {
    const result = store.start(id, busy, resident);
    if ('error' in result) throw new Error(result.error);
    return result;
  }
  afterEach(() => {
    while (stores.length) stores.pop()!.close();
    vi.useRealTimers();
    while (folders.length) rmSync(folders.pop()!, { recursive: true, force: true });
  });

  it.each(['rest', 'fish'] as const)('settles %s without a page or a read request', async (activity) => {
    vi.useFakeTimers();
    const file = fixture();
    const resident = open(file, true);
    const shift = start(resident, 'shift', true);
    if (activity === 'fish') expect(resident.note('resident', shift.serverTime, 'paper', 'fish')?.accepted).toBe(true);
    await vi.advanceTimersByTimeAsync(100000);
    const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
    const inspector = new sqlite.DatabaseSync(file, { readOnly: true });
    try {
      const stored = inspector.prepare('SELECT state,next_at FROM shifts').get()!;
      expect(stored.next_at).toBeNull();
      const state = JSON.parse(String(stored.state));
      if (activity === 'fish') {
        expect(state).toMatchObject({ phase: 'done', place: 'pier', energy: 32 });
        expect(['released', 'noCatch']).toContain(state.fishResult);
      } else expect(state).toMatchObject({ phase: 'done', energy: 75, meeting: 'declined' });
    } finally { inspector.close(); }
  });

  it('recovers missed deadlines on restart and deduplicates commands from two connections', () => {
    vi.useFakeTimers();
    const file = fixture();
    const first = open(file);
    const peer = open(file);
    const shift = start(first, 'shift');
    expect(start(peer, 'shift').run).toEqual(shift.run);
    expect(peer.start('shift', true, 'resident')).toHaveProperty('error');
    expect(peer.start('shift', false, 'out-of-session')).toHaveProperty('error');
    expect(peer.start('extra-shift', false, 'resident')).toHaveProperty('error');
    const note = first.note('resident', shift.serverTime, 'paper', 'chat');
    expect(peer.note('resident', shift.serverTime, 'paper', 'chat')).toEqual(note);
    expect(peer.note('resident', shift.serverTime, 'paper', 'rest')?.accepted).toBe(false);
    expect(peer.note('unknown', shift.serverTime, 'paper', 'chat')).toBeNull();
    while (stores.length) stores.pop()!.close();
    vi.advanceTimersByTime(60000);
    const restored = open(file);
    const state = restored.read('resident')!.run;
    expect(state).toMatchObject({ phase: 'done', meeting: 'chatted', energy: 75 });
    expect(restored.note('resident', shift.serverTime, 'paper', 'chat')).toMatchObject({ accepted: true, run: state });
    expect(restored.read('resident')!.run.events).toEqual(state.events);
  });

  it('remembers the last real meeting across a restart and a shift with no conversation', () => {
    vi.useFakeTimers();
    const file = fixture();
    const first = open(file);
    const previous = start(first, 'first-shift', true);
    stores.pop()!.close();
    vi.advanceTimersByTime(40000);
    const restored = open(file);
    const quiet = start(restored, 'quiet-shift');
    expect(quiet.run.previousEncounter).toEqual({ outcome: 'declined', shiftStartedAt: previous.serverTime });
    expect(restored.note('resident', previous.serverTime, 'old-paper', 'fish')?.accepted).toBe(false);
    expect(restored.note('resident', quiet.serverTime, 'new-paper', 'rest')?.accepted).toBe(true);
    vi.advanceTimersByTime(40000);
    expect(start(restored, 'next-shift').run.previousEncounter).toEqual(quiet.run.previousEncounter);
    expect(start(restored, 'another-browser', false, 'other-resident').run.previousEncounter).toBeUndefined();
    vi.advanceTimersByTime(16000);
    expect(restored.read('resident')?.run.phase).toBe('reconnecting');
    expect(restored.read('other-resident')?.run.phase).toBe('inviting');
  });

  it('carries the old cookie’s recorded encounter forward without exposing another browser’s history', () => {
    vi.useFakeTimers();
    const file = fixture();
    const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
    const legacy = new sqlite.DatabaseSync(file);
    const at = Date.now() - 40000;
    const run = beginCafe(at, 'social', true);
    advanceCafe(run, Date.now());
    try {
      legacy.exec('CREATE TABLE shifts (id TEXT PRIMARY KEY, state TEXT NOT NULL, next_at INTEGER, started INTEGER NOT NULL)');
      legacy.prepare('INSERT INTO shifts VALUES (?, ?, NULL, ?)').run('old-cookie', JSON.stringify(run), at);
    } finally { legacy.close(); }
    const store = open(file);
    expect(store.read('old-cookie')).toBeNull();
    expect(store.read('other-resident', true)).toBeNull();
    expect(store.read('old-cookie', true)?.run).toEqual(run);
    expect(start(store, 'after-migration', false, 'old-cookie').run.previousEncounter).toEqual({ outcome: 'declined', shiftStartedAt: at });
    expect(store.read('old-cookie', true)?.run.phase).toBe('working');
  });
});
