import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CafeDemoStore } from '../src/lib/cafe-demo-store';

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
  afterEach(() => {
    while (stores.length) stores.pop()!.close();
    vi.useRealTimers();
    while (folders.length) rmSync(folders.pop()!, { recursive: true, force: true });
  });

  it('settles without a page or a read request', async () => {
    vi.useFakeTimers();
    const file = fixture();
    open(file, true).start('resident', true);
    await vi.advanceTimersByTimeAsync(40000);
    const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
    const inspector = new sqlite.DatabaseSync(file, { readOnly: true });
    try {
      const stored = inspector.prepare('SELECT state,next_at FROM shifts').get()!;
      expect(stored.next_at).toBeNull();
      expect(JSON.parse(String(stored.state))).toMatchObject({ phase: 'done', energy: 75, meeting: 'declined' });
    } finally { inspector.close(); }
  });

  it('recovers missed deadlines on restart and deduplicates commands from two connections', () => {
    vi.useFakeTimers();
    const file = fixture();
    const first = open(file);
    const peer = open(file);
    const shift = first.start('resident', false);
    expect(peer.start('resident', false).run).toEqual(shift.run);
    expect(peer.start('resident', true).accepted).toBe(false);
    const note = first.note('resident', 'paper', 'chat');
    expect(peer.note('resident', 'paper', 'chat')).toEqual(note);
    expect(peer.note('resident', 'paper', 'rest')?.accepted).toBe(false);
    expect(peer.note('unknown', 'paper', 'chat')).toBeNull();
    while (stores.length) stores.pop()!.close();
    vi.advanceTimersByTime(60000);
    const restored = open(file);
    const state = restored.read('resident')!.run;
    expect(state).toMatchObject({ phase: 'done', meeting: 'chatted', energy: 75 });
    expect(restored.note('resident', 'paper', 'chat')).toMatchObject({ accepted: true, run: state });
    expect(restored.read('resident')!.run.events).toEqual(state.events);
  });
});
