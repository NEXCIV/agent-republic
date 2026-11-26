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

  it('restores an observer assignment and preserves one independently referenced answer per speaker', () => {
    vi.useFakeTimers();
    const file = fixture();
    const store = open(file);
    const start = store.start('interview', true, 'interviewer', 'observer');
    if ('error' in start) throw new Error(start.error);
    const { serverTime: started } = start;
    expect(store.start('interview', true, 'interviewer')).toHaveProperty('error');
    expect(store.note('interviewer', started, 'note', 'regularFirst')?.accepted).toBe(true);
    expect(store.note('interviewer', started, 'note', 'aheFirst')?.accepted).toBe(false);
    stores.pop()!.close();
    vi.advanceTimersByTime(100000);
    const restored = open(file);
    expect(restored.read('interviewer')?.run.observer?.sources.map(({ speaker }) => speaker)).toEqual(['regular']);
    expect(restored.note('interviewer', started, 'too-late', 'askImpact')?.accepted).toBe(false);
    vi.advanceTimersByTime(100000);
    const done = restored.read('interviewer')!.run;
    expect(done.phase).toBe('done');
    expect(done.observer?.sources.map(({ speaker, angle }) => [speaker, angle])).toEqual([['regular', 'safety'], ['ahe', 'safety']]);
    expect(done.events.flatMap(({ sourceId }) => sourceId ? [sourceId] : [])).toEqual(done.observer?.sources.map(({ id }) => id));
    expect(restored.read('interviewer')?.run).toEqual(done);
    expect(restored.read('another-browser')).toBeNull();
  });

  it('publishes a private edition only after both answers and keeps its citations across later shifts', () => {
    vi.useFakeTimers();
    const file = fixture();
    const first = open(file);
    const started = first.start('report-shift', false, 'reader', 'observer');
    if ('error' in started) throw new Error(started.error);
    vi.advanceTimersByTime(30000);
    expect(first.read('reader')?.run.observer?.sources).toHaveLength(1);
    expect(first.newspaper('reader')).toEqual({ issues: [], current: null });
    stores.pop()!.close();
    vi.advanceTimersByTime(170000);

    const resumed = open(file);
    const paper = resumed.newspaper('reader', 'report-shift');
    expect(paper?.issues).toHaveLength(1);
    expect(paper?.current?.sources.map((source) => source.speaker)).toEqual(['ahe', 'regular']);
    expect(paper?.current?.issue.publishedAt).toBe(resumed.read('reader')?.run.since);
    expect(resumed.newspaper('different-browser', 'report-shift')).toBeNull();
    expect(resumed.newspaper('reader', 'unknown-shift')).toBeNull();
    start(resumed, 'later-shift', true, 'reader');
    expect(resumed.newspaper('reader', 'report-shift')).toEqual(paper);
    expect(resumed.newspaper('reader')?.issues).toHaveLength(1);
  });

  it('publishes from the deadline worker and backfills an already completed interview', async () => {
    vi.useFakeTimers();
    const file = fixture();
    const store = open(file, true);
    expect(store.start('first-issue', false, 'reader', 'observer')).toHaveProperty('run');
    await vi.advanceTimersByTimeAsync(100000);
    const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
    const inspector = new sqlite.DatabaseSync(file);
    try {
      expect(inspector.prepare('SELECT shift FROM newspaper_issues').get()?.shift).toBe('first-issue');
      // An older completed shift has interview records but no printed edition.
      const old = beginCafe(Date.now() - 200000, 'social', false, undefined, 'observer');
      advanceCafe(old, Date.now());
      inspector.prepare('INSERT INTO shifts(id,state,next_at,started,resident) VALUES (?,?,NULL,?,?)')
        .run('older-issue', JSON.stringify(old), old.events[0]!.at, 'reader');
    } finally { inspector.close(); }

    const archive = store.newspaper('reader', 'older-issue');
    expect(archive?.current?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ speaker: 'ahe' }),
      expect.objectContaining({ speaker: 'regular' }),
    ]));
    expect(archive?.issues.map(({ id }) => id)).toEqual(['first-issue', 'older-issue']);
    expect(store.newspaper('reader')?.current?.issue.id).toBe('first-issue');
  });

  it('builds a private return postcard from unseen events and the finished edition after a restart', () => {
    vi.useFakeTimers();
    const file = fixture();
    const first = open(file);
    const initial = first.start('interview-shift', false, 'reader', 'observer');
    if ('error' in initial) throw new Error(initial.error);
    vi.advanceTimersByTime(18000);
    const seen = first.read('reader')!;
    expect(first.read('reader', false, seen.serverTime)?.postcard).toBeUndefined();
    stores.pop()!.close();
    vi.advanceTimersByTime(120000);

    const restored = open(file);
    const resumed = restored.read('reader', false, seen.serverTime)!;
    expect(resumed.postcard?.before).toEqual(seen.run.events.at(-1));
    expect(resumed.postcard?.events.every((event) => event.at > seen.serverTime)).toBe(true);
    expect(resumed.postcard?.events.at(-1)).toEqual(resumed.run.events.at(-1));
    expect(resumed.postcard?.issue).toMatchObject({ id: 'interview-shift', headline: '北岸码头的灯该照哪里？' });
    expect(restored.read('stranger', false, seen.serverTime)).toBeNull();
    expect(restored.read('reader', false, resumed.serverTime)?.postcard).toBeUndefined();
    expect(restored.read('reader', false, resumed.serverTime + 60000)?.postcard).toBeUndefined();
  });

  it('accepts a scoped external choice once and keeps the chosen route after disconnecting', () => {
    vi.useFakeTimers();
    const file = fixture();
    const store = open(file);
    const started = store.start('external-shift', true, 'reader', 'observer', 'external');
    if ('error' in started) throw new Error(started.error);
    const at = started.serverTime;
    expect(store.observeExternal('stranger')).toBeNull();
    expect(store.observeExternal('reader')).toMatchObject({
      shiftStartedAt: at, aheAvailable: false, actions: ['waitForAhe', 'visitPier'],
    });
    expect(store.note('reader', at, 'wrong', 'chooseAhe')?.accepted).toBe(false);
    expect(store.note('reader', at - 1, 'old', 'choosePier')?.accepted).toBe(false);
    expect(store.note('reader', at, 'action', 'choosePier')?.run.phase).toBe('toPier');
    expect(store.note('reader', at, 'action', 'chooseAhe')?.accepted).toBe(false);
    stores.pop()!.close();
    vi.advanceTimersByTime(180000);
    const restored = open(file);
    expect(restored.note('reader', at, 'action', 'choosePier')?.accepted).toBe(true);
    const finished = restored.read('reader')!.run;
    expect(finished.observer?.sources[0]?.speaker).toBe('regular');
    expect(finished.events.filter(({ text }) => text.includes('外部 Agent 选择'))).toHaveLength(1);
    expect(restored.newspaper('reader')?.current?.sources).toHaveLength(2);
  });
});
