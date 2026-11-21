import { deriveProjectProgressBasisPoints, deriveProjectStage } from '@agent-republic/world-engine';
import type { ProjectStage } from '@agent-republic/world-engine';

/**
 * E6-03 — bridge between confirmed project amounts and the 3D construction
 * stage (docs/3D_RENDERING.md §4).
 *
 * Only the projection of finalized contract events reaches this function.
 * Pending wallet submissions, LLM text and simulation ticks are never inputs.
 * Completion visuals require BOTH `status=COMPLETED` and `fundedBuild=goalBuild`;
 * any disagreement withholds the completed model and is reported as SYNC ISSUE.
 */

export type ConfirmedProjectAmounts = {
  readonly fundedBuild: string;
  readonly goalBuild: string;
  readonly state: 'FUNDING' | 'COMPLETED';
};

export type ProjectStageView = {
  readonly available: boolean;
  readonly stage: ProjectStage | null;
  readonly progressBasisPoints: number | null;
  readonly complete: boolean;
  readonly inconsistent: boolean;
  readonly fundedBuild: string | null;
  readonly goalBuild: string | null;
};

export const PROJECT_STAGE_LABELS: Readonly<Record<ProjectStage, string>> = {
  FOUNDATION: 'Foundation',
  FRAME: 'Structural frame',
  FACADE: 'Facade',
  COMPLETE: 'Complete',
};

function unavailable(): ProjectStageView {
  return {
    available: false,
    stage: null,
    progressBasisPoints: null,
    complete: false,
    inconsistent: false,
    fundedBuild: null,
    goalBuild: null,
  };
}

export function toProjectStageView(project: ConfirmedProjectAmounts | null): ProjectStageView {
  if (project === null) return unavailable();

  try {
    const derived = deriveProjectStage(project);
    const progressBasisPoints = deriveProjectProgressBasisPoints(project);
    const funded = BigInt(project.fundedBuild);
    const goal = BigInt(project.goalBuild);
    const base = {
      available: true,
      progressBasisPoints,
      fundedBuild: project.fundedBuild,
      goalBuild: project.goalBuild,
    };

    if (derived === 'COMPLETE') {
      const statusComplete = project.state === 'COMPLETED' && funded === goal;
      if (!statusComplete) {
        // 100% funding without a completed contract status must not look done.
        return { ...base, stage: 'FACADE', complete: false, inconsistent: true };
      }
      return { ...base, stage: 'COMPLETE', complete: true, inconsistent: false };
    }

    if (project.state === 'COMPLETED') {
      // Completed status below the goal is a projection inconsistency. Show
      // the amount-derived stage and never the completion plaque.
      return { ...base, stage: derived, complete: false, inconsistent: true };
    }

    return { ...base, stage: derived, complete: false, inconsistent: false };
  } catch {
    // Malformed amounts (non-decimal strings, zero goal) fail closed.
    return unavailable();
  }
}
