import { describe, expect, it } from 'vitest';
import { PROJECT_STAGES } from '@agent-republic/world-engine';
import {
  PROJECT_STAGE_LABELS,
  toProjectStageView,
} from '../src/features/world-3d/adapters/projectStage';

/**
 * E6-03 — confirmed-amount → construction stage contract.
 *
 * These tests pin the "no fake progress" rule: only confirmed amounts select a
 * stage, and the completed model requires both `COMPLETED` and the full goal.
 */

const GOAL = '2000';

function view(fundedBuild: string, state: 'FUNDING' | 'COMPLETED' = 'FUNDING') {
  return toProjectStageView({ fundedBuild, goalBuild: GOAL, state });
}

describe('toProjectStageView', () => {
  it('fails closed when project data is unavailable', () => {
    const result = toProjectStageView(null);
    expect(result.available).toBe(false);
    expect(result.stage).toBeNull();
    expect(result.progressBasisPoints).toBeNull();
    expect(result.complete).toBe(false);
  });

  it('uses the exact confirmed thresholds', () => {
    expect(view('0')).toMatchObject({ stage: 'FOUNDATION', progressBasisPoints: 0 });
    expect(view('499')).toMatchObject({ stage: 'FOUNDATION', progressBasisPoints: 2495 });
    expect(view('500')).toMatchObject({ stage: 'FRAME', progressBasisPoints: 2500 });
    expect(view('1199')).toMatchObject({ stage: 'FRAME', progressBasisPoints: 5995 });
    expect(view('1200')).toMatchObject({ stage: 'FACADE', progressBasisPoints: 6000 });
    expect(view('1999')).toMatchObject({ stage: 'FACADE', progressBasisPoints: 9995 });
  });

  it('never shows the completed model at 100% while the contract still funds', () => {
    const result = view('2000', 'FUNDING');
    expect(result.stage).toBe('FACADE');
    expect(result.complete).toBe(false);
    expect(result.inconsistent).toBe(true);
    expect(result.progressBasisPoints).toBe(10_000);
  });

  it('shows the completed model only when status and amount agree', () => {
    const result = view('2000', 'COMPLETED');
    expect(result.stage).toBe('COMPLETE');
    expect(result.complete).toBe(true);
    expect(result.inconsistent).toBe(false);
  });

  it('flags a completed status below the goal', () => {
    const result = view('1500', 'COMPLETED');
    expect(result.stage).toBe('FACADE');
    expect(result.complete).toBe(false);
    expect(result.inconsistent).toBe(true);
  });

  it('treats overfunding as an inconsistency and withholds completion', () => {
    expect(view('2500')).toMatchObject({
      stage: 'FACADE',
      progressBasisPoints: 10_000,
      complete: false,
      inconsistent: true,
    });
    expect(view('2500', 'COMPLETED')).toMatchObject({
      stage: 'FACADE',
      complete: false,
      inconsistent: true,
    });
  });

  it('uses integer math for very large confirmed amounts', () => {
    const result = toProjectStageView({
      fundedBuild: '600000000000000000000',
      goalBuild: '1000000000000000000000',
      state: 'FUNDING',
    });
    expect(result.stage).toBe('FACADE');
    expect(result.progressBasisPoints).toBe(6000);
  });

  it('rejects malformed amounts and zero goals', () => {
    expect(view('1.5').available).toBe(false);
    expect(view('-1').available).toBe(false);
    expect(view('abc').available).toBe(false);
    expect(
      toProjectStageView({ fundedBuild: '1', goalBuild: '0', state: 'FUNDING' }).available,
    ).toBe(false);
  });

  it('labels every stage', () => {
    for (const stage of PROJECT_STAGES) {
      expect(PROJECT_STAGE_LABELS[stage].length).toBeGreaterThan(0);
    }
  });
});
