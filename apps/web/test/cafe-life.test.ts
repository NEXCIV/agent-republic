import { describe, expect, it } from 'vitest';
import { advanceCafe, beginCafe, suggestCafe } from '../src/lib/cafe-life';

describe('isolated café activities', () => {
  it('rejects fishing without producing a reward or altering the current shift', () => {
    const run = beginCafe(1000, 'social', false);
    const before = structuredClone(run);
    expect(suggestCafe(run, 'fish')).toEqual({ accepted: false, reason: '北岸尚未开放钓鱼。' });
    expect(run).toEqual(before);
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
