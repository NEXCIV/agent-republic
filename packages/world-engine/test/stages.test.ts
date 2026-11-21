import { describe, expect, it } from 'vitest';
import {
  deriveProjectProgressBasisPoints,
  deriveProjectStage,
  PROJECT_STAGES,
  ProjectStageError,
  stageRank,
  toChainVisualEvent,
  type VerifiedChainEvent,
} from '../src/index.js';

/**
 * E5-04 stage boundary tests. Off-by-one here would either show a completed
 * tower that is not funded, or hide a real milestone — both are "fake data".
 */

const H = (seed: number): string => `0x${seed.toString(16).padStart(64, '0')}`;

function event(
  eventName: string,
  payload: Record<string, string | boolean | null>,
  options: { txSeed?: number; logIndex?: number } = {},
): VerifiedChainEvent {
  return {
    eventName,
    txHash: H(options.txSeed ?? 5000),
    logIndex: options.logIndex ?? 0,
    blockNumber: 100n,
    blockHash: H(100),
    owner: null,
    payload,
  };
}

describe('deriveProjectStage', () => {
  it('starts at FOUNDATION with zero funding', () => {
    expect(deriveProjectStage({ fundedBuild: '0', goalBuild: '2000' })).toBe('FOUNDATION');
  });

  it('keeps FOUNDATION below 25% (24.999%)', () => {
    expect(deriveProjectStage({ fundedBuild: '24999', goalBuild: '100000' })).toBe('FOUNDATION');
    expect(deriveProjectStage({ fundedBuild: '499', goalBuild: '2000' })).toBe('FOUNDATION');
  });

  it('switches to FRAME exactly at 25%', () => {
    expect(deriveProjectStage({ fundedBuild: '25000', goalBuild: '100000' })).toBe('FRAME');
    expect(deriveProjectStage({ fundedBuild: '500', goalBuild: '2000' })).toBe('FRAME');
  });

  it('keeps FRAME below 60% (59.999%)', () => {
    expect(deriveProjectStage({ fundedBuild: '59999', goalBuild: '100000' })).toBe('FRAME');
    expect(deriveProjectStage({ fundedBuild: '1199', goalBuild: '2000' })).toBe('FRAME');
  });

  it('switches to FACADE exactly at 60%', () => {
    expect(deriveProjectStage({ fundedBuild: '60000', goalBuild: '100000' })).toBe('FACADE');
    expect(deriveProjectStage({ fundedBuild: '1200', goalBuild: '2000' })).toBe('FACADE');
  });

  it('keeps FACADE below 100% (99.999%)', () => {
    expect(deriveProjectStage({ fundedBuild: '99999', goalBuild: '100000' })).toBe('FACADE');
    expect(deriveProjectStage({ fundedBuild: '1999', goalBuild: '2000' })).toBe('FACADE');
  });

  it('is COMPLETE exactly at 100% and stays clamped above it', () => {
    expect(deriveProjectStage({ fundedBuild: '2000', goalBuild: '2000' })).toBe('COMPLETE');
    expect(deriveProjectStage({ fundedBuild: '2500', goalBuild: '2000' })).toBe('COMPLETE');
  });

  it('handles uint256-scale amounts without precision loss', () => {
    const goal = '1000000000000000000000000000000'; // 10^30
    const quarter = '250000000000000000000000000000'; // exactly 25%
    expect(deriveProjectStage({ fundedBuild: quarter, goalBuild: goal })).toBe('FRAME');

    const justBelow = (BigInt(quarter) - 1n).toString();
    expect(deriveProjectStage({ fundedBuild: justBelow, goalBuild: goal })).toBe('FOUNDATION');
  });

  it('rejects malformed amounts and a zero goal instead of defaulting', () => {
    expect(() => deriveProjectStage({ fundedBuild: '1.5', goalBuild: '2000' })).toThrow(ProjectStageError);
    expect(() => deriveProjectStage({ fundedBuild: '10', goalBuild: '0' })).toThrow(ProjectStageError);
    expect(() => deriveProjectStage({ fundedBuild: '-1', goalBuild: '2000' })).toThrow(ProjectStageError);
  });
});

describe('deriveProjectProgressBasisPoints', () => {
  it('reports clamped basis points', () => {
    expect(deriveProjectProgressBasisPoints({ fundedBuild: '0', goalBuild: '2000' })).toBe(0);
    expect(deriveProjectProgressBasisPoints({ fundedBuild: '500', goalBuild: '2000' })).toBe(2500);
    expect(deriveProjectProgressBasisPoints({ fundedBuild: '1200', goalBuild: '2000' })).toBe(6000);
    expect(deriveProjectProgressBasisPoints({ fundedBuild: '2500', goalBuild: '2000' })).toBe(10_000);
  });

  it('floors sub-basis-point progress instead of rounding up', () => {
    expect(deriveProjectProgressBasisPoints({ fundedBuild: '1', goalBuild: '3' })).toBe(3333);
  });
});

describe('stageRank', () => {
  it('orders stages monotonically', () => {
    expect(stageRank('FOUNDATION')).toBeLessThan(stageRank('FRAME'));
    expect(stageRank('FRAME')).toBeLessThan(stageRank('FACADE'));
    expect(stageRank('FACADE')).toBeLessThan(stageRank('COMPLETE'));
    expect(PROJECT_STAGES).toEqual(['FOUNDATION', 'FRAME', 'FACADE', 'COMPLETE']);
  });

  it('is monotonic across the full funding curve', () => {
    let previous = -1;
    for (let funded = 0; funded <= 2000; funded += 50) {
      const rank = stageRank(deriveProjectStage({ fundedBuild: String(funded), goalBuild: '2000' }));
      expect(rank).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });
});

describe('toChainVisualEvent', () => {
  it('maps contributions and project lifecycle to PROJECT milestones', () => {
    const contribution = toChainVisualEvent(
      event('ContributionMade', { projectId: '1', amount: '50', fundedAfter: '50' }, { txSeed: 9001, logIndex: 2 }),
    );
    expect(contribution).toEqual({
      kind: 'MILESTONE',
      targetId: 'project:1',
      sourceType: 'CHAIN',
      sourceId: `${H(9001)}:2`,
    });

    expect(toChainVisualEvent(event('ProjectCompleted', { projectId: '1' }))).toMatchObject({
      targetId: 'project:1',
      kind: 'MILESTONE',
    });
  });

  it('maps registrations to the IDENTITY landmark', () => {
    expect(toChainVisualEvent(event('CitizenRegistered', { commitment: H(1) }))).toMatchObject({
      kind: 'MILESTONE',
      targetId: 'IDENTITY',
      sourceType: 'CHAIN',
    });
  });

  it('maps governance events to proposal targets', () => {
    for (const name of ['ProposalSubmitted', 'VoteCast', 'ProposalFinalized']) {
      expect(toChainVisualEvent(event(name, { proposalId: '7' }))).toMatchObject({
        kind: 'MILESTONE',
        targetId: 'proposal:7',
      });
    }
  });

  it('maps notes to discussion events with the note hash', () => {
    expect(toChainVisualEvent(event('NotePublished', { noteHash: H(3) }))).toMatchObject({
      kind: 'DISCUSSION',
      targetId: `NOTE:${H(3)}`,
    });
  });

  it('emits nothing for reputation, delegate or unknown events', () => {
    expect(toChainVisualEvent(event('ReputationUpdated', { newReputation: '3' }))).toBeNull();
    expect(toChainVisualEvent(event('DelegateUpdated', { delegate: H(4) }))).toBeNull();
    expect(toChainVisualEvent(event('AGENT_MESSAGE', { text: 'hi' }))).toBeNull();
  });

  it('requires the id argument instead of inventing a target', () => {
    expect(toChainVisualEvent(event('ContributionMade', { amount: '5' }))).toBeNull();
    expect(toChainVisualEvent(event('VoteCast', {}))).toBeNull();
  });
});
