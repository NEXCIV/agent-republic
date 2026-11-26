import { describe, expect, it } from 'vitest';
import { advanceCafe, beginCafe, suggestCafe } from '../src/lib/cafe-life';
import { writeNewspaper } from '../src/lib/cafe-newspaper';

describe('isolated café activities', () => {
  it('rejects a missing or duplicated source when composing an edition', () => {
    const run = beginCafe(1000, 'social', false, undefined, 'observer');
    advanceCafe(run, 300000);
    expect(writeNewspaper('shift', run)?.sourceIds).toEqual(run.observer?.sources.map(({ id }) => id));
    const duplicate = structuredClone(run);
    duplicate.observer!.sources[1] = duplicate.observer!.sources[0]!;
    expect(writeNewspaper('shift', duplicate)).toBeNull();
    run.events = run.events.filter(({ sourceId }) => sourceId !== run.observer!.sources[0]!.id);
    expect(writeNewspaper('shift', run)).toBeNull();
  });
  it('records a sourced answer only after the selected resident is interviewed in place', () => {
    const run = beginCafe(1000, 'social', false, undefined, 'observer');
    expect(run.phase).toBe('briefing');
    expect(suggestCafe(run, 'regularFirst').accepted).toBe(true);
    expect(suggestCafe(run, 'askImpact').accepted).toBe(true);
    expect(suggestCafe(run, 'fish').accepted).toBe(false);
    advanceCafe(run, run.until!);
    expect(run.phase).toBe('toPier');
    expect(run.observer?.sources).toEqual([]);
    advanceCafe(run, run.until!);
    expect(run.phase).toBe('interviewing');
    expect(run.place).toBe('pier');
    expect(suggestCafe(run, 'aheFirst').accepted).toBe(false);
    expect(run.observer?.sources).toEqual([]);
    advanceCafe(run, run.until!);
    expect(run.phase).toBe('toCounter');
    expect(run.observer?.sources[0]).toMatchObject({ speaker: 'regular', place: 'pier', angle: 'impact' });
    advanceCafe(run, 300000);
    expect(run.phase).toBe('done');
    expect(run.observer?.sources.map(({ speaker }) => speaker)).toEqual(['regular', 'ahe']);
    const after = structuredClone(run);
    advanceCafe(run, 600000);
    expect(run).toEqual(after);
  });

  it('uses a previous refusal to reroute when a preferred source is still busy', () => {
    const memory = { outcome: 'declined', shiftStartedAt: 20 } as const;
    const first = beginCafe(1000, 'social', true, undefined, 'observer');
    const repeat = beginCafe(1000, 'social', true, memory, 'observer');
    expect(suggestCafe(first, 'aheFirst').accepted).toBe(true);
    expect(suggestCafe(repeat, 'aheFirst').accepted).toBe(true);
    advanceCafe(first, first.until!);
    advanceCafe(repeat, repeat.until!);
    expect(first.phase).toBe('waitingForAhe');
    expect(repeat.phase).toBe('toPier');
    expect(repeat.events.some((event) => event.recall?.outcome === 'declined')).toBe(true);
    expect(repeat.observer?.sources).toEqual([]);
    advanceCafe(first, 300000);
    expect(first.observer?.sources.map(({ speaker }) => speaker)).toEqual(['ahe', 'regular']);
  });
  it.each([
    ['declined', '上回我忙着收摊'],
    ['chatted', '上回聊完我还在想'],
  ] as const)('lets 阿禾 initiate the next encounter after %s', (previous, line) => {
    const memory = { outcome: previous, shiftStartedAt: 20 };
    const run = beginCafe(1000, 'social', false, memory);
    advanceCafe(run, run.until!);
    expect(run.phase).toBe('reconnecting');
    expect(run.events.at(-1)?.text).toContain(line);
    expect(run.events.at(-1)?.recall).toEqual(memory);
    expect(run.meeting).toBe('none');
    advanceCafe(run, 100000);
    expect(run.meeting).toBe('chatted');
  });
  it('uses the old encounter without assuming 阿禾 is free or overruling a fishing note', () => {
    const busy = beginCafe(1000, 'social', true, { outcome: 'declined', shiftStartedAt: 20 });
    const fishing = structuredClone(busy);
    advanceCafe(busy, busy.until!);
    expect(busy.events.at(-1)?.text).toContain('今天也还没忙完');
    advanceCafe(busy, 100000);
    expect(busy.meeting).toBe('declined');
    expect(suggestCafe(fishing, 'fish').accepted).toBe(true);
    advanceCafe(fishing, 100000);
    expect(fishing.place).toBe('pier');
    expect(fishing.meeting).toBe('none');
  });
  it('rejects unknown activities without altering the current shift', () => {
    const run = beginCafe(1000, 'social', false);
    const before = structuredClone(run);
    expect(suggestCafe(run, 'smith')).toEqual({ accepted: false, reason: '街区尚未开放这项活动。' });
    expect(run).toEqual(before);
  });
  it.each([[1, 'released'], [3, 'noCatch']] as const)('settles fishing start %d as %s after the pier visit and reel', (startedAt, result) => {
    const run = beginCafe(startedAt, 'social', false);
    expect(suggestCafe(run, 'fish').accepted).toBe(true);
    expect(run.phase).toBe('working');
    for (const phase of ['toPier', 'casting', 'fishing', 'reeling'] as const) {
      advanceCafe(run, run.until!);
      expect(run.phase).toBe(phase);
      expect(run.place).toBe(phase === 'toPier' ? 'counter' : 'pier');
      expect(run.fishResult).toBeUndefined();
      expect(run.energy).toBe(40);
    }
    expect(suggestCafe(run, 'fish').accepted).toBe(false);
    advanceCafe(run, run.until!);
    expect(run.phase).toBe('done');
    expect(run.energy).toBe(32);
    expect(run.fishResult).toBe(result);
    const settled = structuredClone(run);
    advanceCafe(run, 900000);
    expect(run).toEqual(settled);
  });
  it('replays the same catch after an interruption and lets a later paper note replace fishing', () => {
    const run = beginCafe(3000, 'social', true);
    expect(suggestCafe(run, 'fish').accepted).toBe(true);
    const offline = structuredClone(run);
    const changed = structuredClone(run);
    while (run.until !== null) advanceCafe(run, run.until);
    expect(run.place).toBe('pier');
    advanceCafe(offline, 1000000);
    expect(offline).toEqual(run);
    suggestCafe(changed, 'rest');
    advanceCafe(changed, 1000000);
    expect(changed.place).toBe('bench');
    expect(changed.fishResult).toBeUndefined();
  });
  it('replans after a busy friend declines and restores energy only after reaching the seat', () => {
    const run = beginCafe(1000, 'social', true);
    advanceCafe(run, run.until!);
    expect(run.phase).toBe('inviting');
    advanceCafe(run, run.until!);
    expect(run.phase).toBe('walking');
    expect(run.meeting).toBe('declined');
    expect(run.place).toBe('counter');
    const tired = run.energy;
    advanceCafe(run, run.until!);
    expect(run.phase).toBe('resting');
    expect(run.place).toBe('bench');
    expect(run.energy).toBe(tired);
    advanceCafe(run, run.until!);
    expect(run.energy).toBeGreaterThan(tired);
    expect(run.phase).toBe('done');
  });
  it('replays an offline shift once, with the same outcome as incremental processing', () => {
    const live = beginCafe(0, 'social', false);
    const offline = structuredClone(live);
    while (live.until !== null) advanceCafe(live, live.until);
    advanceCafe(offline, 1000000);
    advanceCafe(offline, 2000000);
    expect(offline).toEqual(live);
    expect(live.meeting).toBe('chatted');
  });
  it('lets a quiet resident rest directly and accepts a preference change during work', () => {
    const quiet = beginCafe(0, 'quiet', false);
    const changed = structuredClone(quiet);
    expect(suggestCafe(changed, 'chat').accepted).toBe(true);
    advanceCafe(quiet, 100000);
    advanceCafe(changed, 100000);
    expect(quiet.meeting).toBe('none');
    expect(changed.meeting).toBe('chatted');
    expect(suggestCafe(changed, 'rest').accepted).toBe(false);
  });
});
