import {
  AGENT_LOCATIONS,
  INTENTS,
  agentObservationV1Schema,
  evmAddressSchema,
  proposedActionSchema,
} from '@agent-republic/domain';
import type { AgentObservationV1, Intent } from '@agent-republic/domain';

/**
 * E3-04 — deterministic policy engine (docs/AGENT_ENGINE.md §7).
 *
 * No model output reaches execution directly. This module never builds a
 * transaction, never signs, never approves allowances and never transfers
 * assets: chain suggestions only become AWAITING_OWNER with executable=false.
 * Any transfer/approval/calldata field is rejected by the strict action schema.
 */

export const POLICY_VERSION = 'policy-v1';

export type PolicyAgentStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export type PolicyAgent = {
  readonly agentId: string;
  readonly owner: string;
  readonly status: PolicyAgentStatus;
  readonly allowPublicDiscussion: boolean;
};

export type PolicySnapshot = {
  readonly observation: AgentObservationV1;
  readonly stale: boolean;
};

export type ModerationVerdict = 'APPROVED' | 'REJECTED' | 'UNAVAILABLE';

export type PolicyContext = {
  readonly agent: PolicyAgent;
  /** Owner from the verified Web2↔wallet binding, never HTTP input. */
  readonly sessionOwner: string;
  readonly snapshot: PolicySnapshot;
  readonly actionsThisEpoch: number;
  readonly maxActionsPerEpoch: number;
  readonly noteDelegateEnabled: boolean;
  readonly moderatePublicMessage: (message: string) => ModerationVerdict;
  readonly allowedIntents?: readonly Intent[];
};

export type PolicyMode = 'AWAITING_OWNER' | 'OPTIONAL_LIMITED_DELEGATE' | 'OFFCHAIN_ONLY';

export type PolicyRejectionCode =
  | 'INVALID_CONTEXT'
  | 'SCHEMA'
  | 'OWNER_MISMATCH'
  | 'AGENT_MISMATCH'
  | 'AGENT_NOT_ACTIVE'
  | 'STALE_SNAPSHOT'
  | 'EPOCH_MISMATCH'
  | 'INTENT_NOT_ALLOWED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_NOT_ALLOWED'
  | 'PUBLIC_MESSAGE_REQUIRED'
  | 'RATE_LIMITED'
  | 'MODERATION_REJECTED'
  | 'MODERATION_UNAVAILABLE'
  | 'DISCUSSION_DISABLED'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_NOT_ACTIVE'
  | 'AMOUNT_NOT_POSITIVE'
  | 'AMOUNT_EXCEEDS_BALANCE'
  | 'AMOUNT_EXCEEDS_REMAINING';

export type PolicyDecision =
  | {
      readonly allowed: true;
      readonly mode: PolicyMode;
      readonly executable: boolean;
      readonly code: null;
      readonly detail: '';
    }
  | {
      readonly allowed: false;
      readonly mode: null;
      readonly executable: false;
      readonly code: PolicyRejectionCode;
      readonly detail: string;
    };

const AGENT_STATUSES: readonly PolicyAgentStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'];
const CHAIN_INTENTS: ReadonlySet<Intent> = new Set([
  'SUGGEST_VOTE',
  'SUGGEST_CONTRIBUTION',
  'PUBLISH_NOTE_REQUEST',
]);
const RATE_LIMITED_INTENTS: ReadonlySet<Intent> = new Set([
  'DISCUSS',
  'SUGGEST_VOTE',
  'SUGGEST_CONTRIBUTION',
  'PUBLISH_NOTE_REQUEST',
  'SOCIAL_LOCATION_REQUEST',
]);

function reject(code: PolicyRejectionCode, detail: string): PolicyDecision {
  return { allowed: false, mode: null, executable: false, code, detail };
}

function allow(mode: PolicyMode, executable: boolean): PolicyDecision {
  return { allowed: true, mode, executable, code: null, detail: '' };
}

type ValidatedContext = {
  readonly observation: AgentObservationV1;
  readonly sessionOwner: string;
  readonly allowedIntents: readonly Intent[];
};

function validateContext(context: PolicyContext): ValidatedContext | PolicyDecision {
  const issues: string[] = [];
  const observation = agentObservationV1Schema.safeParse(context.snapshot?.observation);
  if (!observation.success) issues.push('observation is invalid');

  if (!evmAddressSchema.safeParse(context.agent?.owner).success) issues.push('agent.owner is invalid');
  const sessionOwner = evmAddressSchema.safeParse(context.sessionOwner);
  if (!sessionOwner.success) issues.push('sessionOwner is invalid');

  if (
    typeof context.agent?.agentId !== 'string' ||
    context.agent.agentId.length === 0 ||
    context.agent.agentId.length > 64
  ) {
    issues.push('agent.agentId must be 1..64 characters');
  }
  if (!AGENT_STATUSES.includes(context.agent?.status)) issues.push('agent.status is invalid');
  if (typeof context.agent?.allowPublicDiscussion !== 'boolean') {
    issues.push('agent.allowPublicDiscussion must be a boolean');
  }
  if (typeof context.snapshot?.stale !== 'boolean') issues.push('snapshot.stale must be a boolean');
  if (!Number.isInteger(context.actionsThisEpoch) || context.actionsThisEpoch < 0) {
    issues.push('actionsThisEpoch must be a non-negative integer');
  }
  if (!Number.isInteger(context.maxActionsPerEpoch) || context.maxActionsPerEpoch < 0) {
    issues.push('maxActionsPerEpoch must be a non-negative integer');
  }
  if (typeof context.noteDelegateEnabled !== 'boolean') {
    issues.push('noteDelegateEnabled must be a boolean');
  }

  const allowed = context.allowedIntents ?? INTENTS;
  if (!Array.isArray(allowed) || allowed.some((intent) => !(INTENTS as readonly string[]).includes(intent))) {
    issues.push('allowedIntents contains an unsupported intent');
  }

  if (issues.length > 0) {
    return reject('INVALID_CONTEXT', issues.join('; '));
  }

  return {
    observation: observation.success ? observation.data : context.snapshot.observation,
    sessionOwner: sessionOwner.success ? sessionOwner.data : '',
    allowedIntents: allowed,
  };
}

export function validateAction(actionInput: unknown, context: PolicyContext): PolicyDecision {
  const trusted = validateContext(context);
  if ('allowed' in trusted) return trusted;

  const parsed = proposedActionSchema.safeParse(actionInput);
  if (!parsed.success) {
    return reject(
      'SCHEMA',
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    );
  }
  const action = parsed.data;
  const observation = trusted.observation;
  const agentOwner = evmAddressSchema.parse(context.agent.owner);

  if (action.owner !== agentOwner || action.owner !== trusted.sessionOwner) {
    return reject('OWNER_MISMATCH', 'action owner does not match the verified session owner');
  }
  if (observation.self.owner !== agentOwner) {
    return reject('OWNER_MISMATCH', 'observation owner does not match the agent owner');
  }
  if (action.agentId !== context.agent.agentId) {
    return reject('AGENT_MISMATCH', 'action agentId does not match the configured agent');
  }
  if (context.agent.status !== 'ACTIVE') {
    return reject('AGENT_NOT_ACTIVE', `agent status is ${context.agent.status}`);
  }
  if (context.snapshot.stale) {
    return reject('STALE_SNAPSHOT', 'snapshot is stale');
  }
  if (action.epochId !== observation.epochId) {
    return reject('EPOCH_MISMATCH', 'action epoch does not match the observation');
  }
  if (action.observedBlock !== observation.sourceBlock) {
    return reject('STALE_SNAPSHOT', 'action block does not match the observation block');
  }
  if (!trusted.allowedIntents.includes(action.intent)) {
    return reject('INTENT_NOT_ALLOWED', `intent ${action.intent} is not enabled for this agent`);
  }

  const chainIntent = CHAIN_INTENTS.has(action.intent);
  if (chainIntent && !action.requiresOwnerApproval) {
    return reject('APPROVAL_REQUIRED', 'on-chain suggestions require owner approval');
  }
  if (!chainIntent && action.requiresOwnerApproval) {
    return reject('APPROVAL_NOT_ALLOWED', 'off-chain actions must not require owner approval');
  }

  const target = resolveTarget(action.intent, action.targetType, action.targetId, observation);
  if (target.allowed === false) return target.decision;

  if (RATE_LIMITED_INTENTS.has(action.intent)) {
    if (context.actionsThisEpoch >= context.maxActionsPerEpoch) {
      return reject('RATE_LIMITED', 'per-epoch action limit reached');
    }
  }

  if (action.intent === 'DISCUSS' && action.publicMessage.trim() === '') {
    return reject('PUBLIC_MESSAGE_REQUIRED', 'DISCUSS requires a public message');
  }
  if (action.intent === 'DISCUSS' && !context.agent.allowPublicDiscussion) {
    return reject('DISCUSSION_DISABLED', 'public discussion is disabled for this agent');
  }

  if (action.publicMessage.trim() !== '' || action.intent === 'DISCUSS') {
    if (typeof context.moderatePublicMessage !== 'function') {
      return reject('MODERATION_UNAVAILABLE', 'no moderation function configured');
    }
    let verdict: ModerationVerdict;
    try {
      verdict = context.moderatePublicMessage(action.publicMessage);
    } catch {
      return reject('MODERATION_UNAVAILABLE', 'moderation call failed');
    }
    if (verdict === 'REJECTED') {
      return reject('MODERATION_REJECTED', 'public message rejected by moderation');
    }
    if (verdict !== 'APPROVED') {
      return reject('MODERATION_UNAVAILABLE', 'moderation did not approve the message');
    }
  }

  switch (action.intent) {
    case 'SUGGEST_CONTRIBUTION': {
      const project = observation.facts.projects.find((entry) => entry.id === action.targetId);
      if (project === undefined) return reject('TARGET_NOT_FOUND', 'project does not exist');
      if (project.status !== 'FUNDING') return reject('TARGET_NOT_ACTIVE', 'project is not funding');
      const amount = BigInt(action.buildAmount ?? '0');
      if (amount <= 0n) return reject('AMOUNT_NOT_POSITIVE', 'amount must be positive');
      if (amount > BigInt(observation.self.build)) {
        return reject('AMOUNT_EXCEEDS_BALANCE', 'amount exceeds the confirmed owner balance');
      }
      const remaining = BigInt(project.goalBuild) - BigInt(project.fundedBuild);
      if (remaining <= 0n || amount > remaining) {
        return reject('AMOUNT_EXCEEDS_REMAINING', 'amount exceeds the project remaining goal');
      }
      return allow('AWAITING_OWNER', false);
    }

    case 'SUGGEST_VOTE':
      return allow('AWAITING_OWNER', false);

    case 'PUBLISH_NOTE_REQUEST':
      return allow('OPTIONAL_LIMITED_DELEGATE', context.noteDelegateEnabled);

    case 'OBSERVE':
    case 'DISCUSS':
    case 'SOCIAL_LOCATION_REQUEST':
    case 'ABSTAIN':
      return allow('OFFCHAIN_ONLY', true);
  }
}

type TargetResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly decision: PolicyDecision };

function resolveTarget(
  intent: Intent,
  targetType: string,
  targetId: string | null,
  observation: AgentObservationV1,
): TargetResult {
  switch (intent) {
    case 'SUGGEST_CONTRIBUTION': {
      if (targetType !== 'PROJECT') {
        return { allowed: false, decision: reject('INTENT_NOT_ALLOWED', 'contribution must target a PROJECT') };
      }
      const project = observation.facts.projects.find((entry) => entry.id === targetId);
      if (project === undefined) {
        return { allowed: false, decision: reject('TARGET_NOT_FOUND', 'project does not exist') };
      }
      if (project.status !== 'FUNDING') {
        return { allowed: false, decision: reject('TARGET_NOT_ACTIVE', 'project is not funding') };
      }
      return { allowed: true };
    }

    case 'SUGGEST_VOTE': {
      if (targetType !== 'PROPOSAL') {
        return { allowed: false, decision: reject('INTENT_NOT_ALLOWED', 'vote must target a PROPOSAL') };
      }
      const proposal = observation.facts.proposals.find((entry) => entry.id === targetId);
      if (proposal === undefined) {
        return { allowed: false, decision: reject('TARGET_NOT_FOUND', 'proposal does not exist') };
      }
      if (proposal.status !== 'OPEN') {
        return {
          allowed: false,
          decision: reject('TARGET_NOT_ACTIVE', 'proposal is not open'),
        };
      }
      return { allowed: true };
    }

    case 'DISCUSS': {
      if (targetType !== 'PROJECT' && targetType !== 'PROPOSAL') {
        return { allowed: false, decision: reject('INTENT_NOT_ALLOWED', 'DISCUSS must target a project or proposal') };
      }
      if (targetId === null) {
        return {
          allowed: false,
          decision: reject('TARGET_NOT_FOUND', 'DISCUSS requires a target'),
        };
      }
      const project = observation.facts.projects.find((entry) => entry.id === targetId);
      const proposal = observation.facts.proposals.find((entry) => entry.id === targetId);
      if (project === undefined && proposal === undefined) {
        return {
          allowed: false,
          decision: reject(
            'TARGET_NOT_FOUND',
            'target is not a verifiable project or proposal in the observation',
          ),
        };
      }
      return { allowed: true };
    }

    case 'SOCIAL_LOCATION_REQUEST':
      if (
        targetType !== 'LOCATION' ||
        targetId === null ||
        !(AGENT_LOCATIONS as readonly string[]).includes(targetId)
      ) {
        return { allowed: false, decision: reject('TARGET_NOT_FOUND', 'unknown location') };
      }
      return { allowed: true };

    case 'PUBLISH_NOTE_REQUEST': {
      if (targetId === null) {
        if (targetType !== 'NONE') {
          return { allowed: false, decision: reject('INTENT_NOT_ALLOWED', 'targetId is required') };
        }
        return { allowed: true };
      }
      if (targetType !== 'PROJECT' && targetType !== 'PROPOSAL') {
        return { allowed: false, decision: reject('INTENT_NOT_ALLOWED', 'note target must be a project or proposal') };
      }
      const project = observation.facts.projects.find((entry) => entry.id === targetId);
      const proposal = observation.facts.proposals.find((entry) => entry.id === targetId);
      if (project === undefined && proposal === undefined) {
        return {
          allowed: false,
          decision: reject('TARGET_NOT_FOUND', 'note target is not verifiable'),
        };
      }
      return { allowed: true };
    }

    case 'OBSERVE':
    case 'ABSTAIN':
      if (targetType !== 'NONE' || targetId !== null) {
        return { allowed: false, decision: reject('INTENT_NOT_ALLOWED', 'action must not have a target') };
      }
      return { allowed: true };
  }
}
