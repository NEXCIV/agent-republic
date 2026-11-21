import type { VisualEventKind } from '@agent-republic/domain';
import type { VerifiedChainEvent } from './reducer.js';

/**
 * E5-04 project building stages + display-event mapping
 * (docs/WORLD_ENGINE.md §3.3).
 *
 * Stage thresholds are derived from confirmed BUILD amounts with integer
 * math only — no floats, no rounding drift:
 *   FOUNDATION  0    – 24.999%
 *   FRAME       25   – 59.999%
 *   FACADE      60   – 99.999%
 *   COMPLETE    100%
 *
 * Pending contributions never reach this function: facts only contain
 * contract-confirmed `fundedAfter` values.
 */

export const PROJECT_STAGES = ['FOUNDATION', 'FRAME', 'FACADE', 'COMPLETE'] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export class ProjectStageError extends Error {
  constructor(message: string) {
    super(`[project-stage] ${message}`);
    this.name = 'ProjectStageError';
  }
}

export type ProjectAmounts = {
  readonly fundedBuild: string;
  readonly goalBuild: string;
};

const DECIMAL = /^\d+$/;

function parseAmount(value: string, field: string): bigint {
  if (!DECIMAL.test(value)) {
    throw new ProjectStageError(`${field} must be a decimal integer string, got "${value}"`);
  }
  return BigInt(value);
}

/** Stage of the building for the given confirmed amounts. */
export function deriveProjectStage(project: ProjectAmounts): ProjectStage {
  const funded = parseAmount(project.fundedBuild, 'fundedBuild');
  const goal = parseAmount(project.goalBuild, 'goalBuild');
  if (goal === 0n) {
    throw new ProjectStageError('goalBuild must be greater than zero');
  }
  if (funded >= goal) return 'COMPLETE';
  // Exact integer comparisons: funded/goal >= 0.60 and >= 0.25.
  if (funded * 100n >= goal * 60n) return 'FACADE';
  if (funded * 100n >= goal * 25n) return 'FRAME';
  return 'FOUNDATION';
}

/** UI progress in basis points (0..10000), clamped like the spec's clamp(). */
export function deriveProjectProgressBasisPoints(project: ProjectAmounts): number {
  const funded = parseAmount(project.fundedBuild, 'fundedBuild');
  const goal = parseAmount(project.goalBuild, 'goalBuild');
  if (goal === 0n) {
    throw new ProjectStageError('goalBuild must be greater than zero');
  }
  if (funded >= goal) return 10_000;
  return Number((funded * 10_000n) / goal);
}

/** Ordering helper for monotonicity checks (reorg rollback must be possible). */
export function stageRank(stage: ProjectStage): number {
  return PROJECT_STAGES.indexOf(stage);
}

export type ChainVisualEvent = {
  readonly kind: VisualEventKind;
  readonly targetId: string;
  readonly sourceType: 'CHAIN';
  readonly sourceId: string;
};

/**
 * Maps a confirmed chain event to a display-layer animation trigger.
 * Returns null for events with no visual effect (reputation, delegation).
 * The caller must only feed finalized events; this function never inspects
 * AI text or pending state.
 */
export function toChainVisualEvent(event: VerifiedChainEvent): ChainVisualEvent | null {
  const sourceId = `${event.txHash.toLowerCase()}:${event.logIndex}`;
  const projectId = typeof event.payload.projectId === 'string' ? event.payload.projectId : null;
  const proposalId = typeof event.payload.proposalId === 'string' ? event.payload.proposalId : null;

  switch (event.eventName) {
    case 'ContributionMade':
      return projectId === null
        ? null
        : { kind: 'MILESTONE', targetId: `project:${projectId}`, sourceType: 'CHAIN', sourceId };

    case 'ProjectCreated':
      return projectId === null
        ? null
        : { kind: 'MILESTONE', targetId: `project:${projectId}`, sourceType: 'CHAIN', sourceId };

    case 'ProjectCompleted':
      return projectId === null
        ? null
        : { kind: 'MILESTONE', targetId: `project:${projectId}`, sourceType: 'CHAIN', sourceId };

    case 'CitizenRegistered':
      return { kind: 'MILESTONE', targetId: 'IDENTITY', sourceType: 'CHAIN', sourceId };

    case 'ProposalSubmitted':
    case 'ProposalFinalized':
    case 'VoteCast':
      return proposalId === null
        ? null
        : { kind: 'MILESTONE', targetId: `proposal:${proposalId}`, sourceType: 'CHAIN', sourceId };

    case 'NotePublished': {
      const noteHash = typeof event.payload.noteHash === 'string' ? event.payload.noteHash : null;
      return noteHash === null
        ? null
        : { kind: 'DISCUSSION', targetId: `NOTE:${noteHash}`, sourceType: 'CHAIN', sourceId };
    }

    default:
      // ReputationUpdated and delegate events have no building/animation.
      return null;
  }
}
