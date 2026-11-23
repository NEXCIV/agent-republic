import type { CommandRecord, CommandRequest, CommandStep } from '@agent-republic/domain';
import { performCommandStep, type CommandContext } from './command.js';

export function makeCommandRecord(
  request: CommandRequest,
  plan: { steps: CommandStep[]; decline: string | null },
  metadata: { id: string; configVersion: number; sourceBlock: string; worldFrameId: string; now: string },
): CommandRecord {
  const { now, ...source } = metadata;
  return {
    ...request, ...source, status: plan.decline === null ? 'RUNNING' : 'DECLINED',
    steps: plan.steps, results: [], report: plan.decline, revision: 1,
    createdAt: now, updatedAt: now,
  };
}

/** Advance one private, off-chain step. The caller commits the revision atomically. */
export function advanceCommandRecord(
  record: CommandRecord, context: CommandContext, now: string,
  privateReply?: { result: string; failed: boolean },
): CommandRecord {
  if (record.status !== 'RUNNING') return record;
  const step = record.steps[record.results.length];
  if (!step) throw new Error('Running command has no remaining steps.');
  const outcome = step.kind === 'DISCUSS' && privateReply ? privateReply : performCommandStep(step, context, record.results);
  const results = [...record.results, outcome.result];
  const status = outcome.failed ? 'FAILED' : results.length === record.steps.length ? 'COMPLETED' : 'RUNNING';
  return {
    ...record, revision: record.revision + 1, updatedAt: now, status, results,
    report: status === 'RUNNING' ? null : outcome.result,
    sourceBlock: context.observation.sourceBlock, worldFrameId: context.observation.worldFrameId,
  };
}
