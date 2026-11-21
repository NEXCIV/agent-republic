import {
  decimalStringSchema,
  evmAddressSchema,
  plannerOutputSchema,
  proposedActionSchema,
} from '@agent-republic/domain';
import type { PlannerOutput, ProposedAction } from '@agent-republic/domain';

/**
 * E3-01 — planner output parsing and authoritative action composition.
 *
 * The model output is untrusted. It is parsed strictly, validated against the
 * intent/target matrix and only then combined with owner/agent/epoch/block
 * values supplied by the trusted worker context. A model that tries to set
 * `owner` (or any other identity field) is rejected, not corrected.
 */

export type AgentActionContext = {
  readonly owner: string;
  readonly agentId: string;
  readonly epochId: number;
  readonly observedBlock: string;
  readonly allowedEvidenceEventIds: readonly string[];
};

export type AgentOutputErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_SCHEMA'
  | 'INVALID_CONTEXT'
  | 'INVALID_ACTION';

export class AgentOutputError extends Error {
  readonly code: AgentOutputErrorCode;
  readonly issues: readonly string[];

  constructor(code: AgentOutputErrorCode, message: string, issues: readonly string[] = []) {
    super(`[agent-output] ${message}`);
    this.name = 'AgentOutputError';
    this.code = code;
    this.issues = issues;
  }
}

type ValidatedContext = {
  readonly owner: string;
  readonly agentId: string;
  readonly epochId: number;
  readonly observedBlock: string;
  readonly allowedEvidenceEventIds: readonly string[];
};

function validateContext(context: AgentActionContext): ValidatedContext {
  const issues: string[] = [];
  const owner = evmAddressSchema.safeParse(context.owner);
  if (!owner.success) issues.push('owner must be a valid EVM address');

  if (context.agentId.length === 0 || context.agentId.length > 64) {
    issues.push('agentId must be 1..64 characters');
  }
  if (!Number.isInteger(context.epochId) || context.epochId < 0) {
    issues.push('epochId must be a non-negative integer');
  }
  if (!decimalStringSchema.safeParse(context.observedBlock).success) {
    issues.push('observedBlock must be a decimal integer string');
  }
  if (!Array.isArray(context.allowedEvidenceEventIds)) {
    issues.push('allowedEvidenceEventIds must be an array');
  } else {
    for (const id of context.allowedEvidenceEventIds) {
      if (typeof id !== 'string' || id.length === 0 || id.length > 96) {
        issues.push('allowedEvidenceEventIds must contain 1..96 character strings');
        break;
      }
    }
  }

  if (issues.length > 0) {
    throw new AgentOutputError('INVALID_CONTEXT', 'authoritative context is invalid', issues);
  }

  return {
    owner: owner.success ? owner.data : '',
    agentId: context.agentId,
    epochId: context.epochId,
    observedBlock: context.observedBlock,
    allowedEvidenceEventIds: context.allowedEvidenceEventIds,
  };
}

function intentIssues(output: PlannerOutput, allowedEvidence: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  const hasTarget = output.targetId !== null;

  if (output.targetType === 'NONE' && hasTarget) {
    issues.push('targetId must be null when targetType is NONE');
  }
  if (output.targetType !== 'NONE' && !hasTarget) {
    issues.push('targetId is required for a non-NONE targetType');
  }

  const requireApproval = (required: boolean) => {
    if (required && !output.requiresOwnerApproval) {
      issues.push(`${output.intent} must require owner approval`);
    }
    if (!required && output.requiresOwnerApproval) {
      issues.push(`${output.intent} must not require owner approval`);
    }
  };

  switch (output.intent) {
    case 'OBSERVE':
    case 'ABSTAIN':
      if (output.targetType !== 'NONE') issues.push(`${output.intent} must use targetType NONE`);
      if (output.choice !== null) issues.push(`${output.intent} must not set a vote choice`);
      if (output.buildAmount !== null) issues.push(`${output.intent} must not set buildAmount`);
      requireApproval(false);
      break;

    case 'DISCUSS':
      if (!['PROJECT', 'PROPOSAL', 'AGENT'].includes(output.targetType)) {
        issues.push('DISCUSS must target a PROJECT, PROPOSAL or AGENT');
      }
      if (output.choice !== null) issues.push('DISCUSS must not set a vote choice');
      if (output.buildAmount !== null) issues.push('DISCUSS must not set buildAmount');
      if (output.publicMessage.trim() === '') issues.push('DISCUSS requires a public message');
      requireApproval(false);
      break;

    case 'SUGGEST_VOTE':
      if (output.targetType !== 'PROPOSAL') issues.push('SUGGEST_VOTE must target a PROPOSAL');
      if (output.choice === null) issues.push('SUGGEST_VOTE requires a vote choice');
      if (output.buildAmount !== null) issues.push('SUGGEST_VOTE must not set buildAmount');
      requireApproval(true);
      break;

    case 'SUGGEST_CONTRIBUTION':
      if (output.targetType !== 'PROJECT') issues.push('SUGGEST_CONTRIBUTION must target a PROJECT');
      if (output.choice !== null) issues.push('SUGGEST_CONTRIBUTION must not set a vote choice');
      if (output.buildAmount === null) {
        issues.push('SUGGEST_CONTRIBUTION requires buildAmount');
      } else if (BigInt(output.buildAmount) <= 0n) {
        issues.push('buildAmount must be greater than zero');
      }
      requireApproval(true);
      break;

    case 'PUBLISH_NOTE_REQUEST':
      if (output.choice !== null) issues.push('PUBLISH_NOTE_REQUEST must not set a vote choice');
      if (output.buildAmount !== null) issues.push('PUBLISH_NOTE_REQUEST must not set buildAmount');
      requireApproval(true);
      break;

    case 'SOCIAL_LOCATION_REQUEST':
      if (output.targetType !== 'LOCATION') {
        issues.push('SOCIAL_LOCATION_REQUEST must target a LOCATION');
      }
      if (output.choice !== null) issues.push('SOCIAL_LOCATION_REQUEST must not set a vote choice');
      if (output.buildAmount !== null) issues.push('SOCIAL_LOCATION_REQUEST must not set buildAmount');
      requireApproval(false);
      break;
  }

  for (const eventId of output.evidenceEventIds) {
    if (!allowedEvidence.has(eventId)) {
      issues.push(`evidenceEventId "${eventId}" is not part of the observation`);
    }
  }

  return issues;
}

function schemaIssues(error: { issues: { path: (string | number)[]; message: string }[] }): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

/** Parse already-decoded JSON. */
export function parsePlannerOutput(input: unknown, context: AgentActionContext): ProposedAction {
  const trusted = validateContext(context);
  const parsed = plannerOutputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AgentOutputError(
      'INVALID_SCHEMA',
      'planner output does not match the action schema',
      schemaIssues(parsed.error),
    );
  }

  const issues = intentIssues(parsed.data, new Set(trusted.allowedEvidenceEventIds));
  if (issues.length > 0) {
    throw new AgentOutputError('INVALID_ACTION', 'planner output is not an allowed action', issues);
  }

  const action = proposedActionSchema.safeParse({
    ...parsed.data,
    owner: trusted.owner,
    agentId: trusted.agentId,
    epochId: trusted.epochId,
    observedBlock: trusted.observedBlock,
  });
  if (!action.success) {
    throw new AgentOutputError(
      'INVALID_SCHEMA',
      'composed action failed validation',
      schemaIssues(action.error),
    );
  }
  return action.data;
}

/** Parse a raw model response. Invalid JSON is a schema failure, never a retry loop. */
export function parsePlannerJson(raw: string, context: AgentActionContext): ProposedAction {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new AgentOutputError('INVALID_JSON', 'planner response is not valid JSON');
  }
  return parsePlannerOutput(decoded, context);
}
