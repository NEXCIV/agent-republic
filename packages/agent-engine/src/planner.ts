import { GOALS, PERSONAS, agentObservationV1Schema } from '@agent-republic/domain';
import type { AgentObservationV1, ProposedAction } from '@agent-republic/domain';
import { parsePlannerJson, parsePlannerOutput } from './action.js';
import type { AgentActionContext } from './action.js';
import { buildPlannerPrompts } from './persona.js';
import type { AgentProfile } from './persona.js';

/**
 * E3-03 — planner entry points.
 *
 * `planWithProvider`constrains an LLM to the E3-01 schema, retries a malformed
 * response at most once and then falls back to ABSTAIN. `planRuleBased` is a
 * deterministic, auditable fallback used for tests and model-free operation;
 * it still goes through every schema/identity check.
 */

export type PlannerPlanInput = {
  readonly observation: AgentObservationV1;
  readonly profile: AgentProfile;
};

export type PlannerSource = 'MODEL' | 'RULE_BASED' | 'ABSTAIN_FALLBACK';

export type PlannerResult = {
  readonly action: ProposedAction;
  readonly source: PlannerSource;
};

export type PlannerModelRequest = {
  readonly system: string;
  readonly user: string;
  readonly maxOutputTokens: number;
};

export type PlannerModelProvider = {
  complete(request: PlannerModelRequest): Promise<string>;
};

export type PlannerErrorCode = 'INVALID_INPUT';

export class PlannerError extends Error {
  readonly code: PlannerErrorCode;
  readonly issues: readonly string[];

  constructor(code: PlannerErrorCode, message: string, issues: readonly string[] = []) {
    super(`[agent-planner] ${message}`);
    this.name = 'PlannerError';
    this.code = code;
    this.issues = issues;
  }
}

type ValidatedInput = {
  readonly observation: AgentObservationV1;
  readonly profile: AgentProfile;
};

function validateInput(input: PlannerPlanInput): ValidatedInput {
  const parsed = agentObservationV1Schema.safeParse(input.observation);
  if (!parsed.success) {
    throw new PlannerError(
      'INVALID_INPUT',
      'observation does not match AgentObservationV1',
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }

  const profile = input.profile;
  const issues: string[] = [];
  if (
    profile === undefined ||
    typeof profile.agentId !== 'string' ||
    profile.agentId.length === 0 ||
    profile.agentId.length > 64
  ) {
    issues.push('agentId must be a 1..64 character string');
  }
  if (profile === undefined || !(PERSONAS as readonly string[]).includes(profile.persona)) {
    issues.push('persona is not supported');
  }
  if (profile === undefined || !(GOALS as readonly string[]).includes(profile.goal)) {
    issues.push('goal is not supported');
  }
  if (issues.length > 0) {
    throw new PlannerError('INVALID_INPUT', 'agent profile is invalid', issues);
  }

  return { observation: parsed.data, profile };
}

function contextFor(observation: AgentObservationV1, profile: AgentProfile): AgentActionContext {
  return {
    owner: observation.self.owner,
    agentId: profile.agentId,
    epochId: observation.epochId,
    observedBlock: observation.sourceBlock,
    allowedEvidenceEventIds: observation.chainRecentEventIds,
  };
}

type ActionBuilder = {
  readonly intent: 'ABSTAIN' | 'DISCUSS' | 'SUGGEST_CONTRIBUTION';
  readonly targetType: 'NONE' | 'PROJECT' | 'PROPOSAL';
  readonly targetId: string | null;
  readonly buildAmount?: string;
  readonly publicMessage?: string;
  readonly rationale: string;
  readonly evidenceEventIds?: string[];
  readonly approval?: boolean;
};

function buildResult(
  observation: AgentObservationV1,
  profile: AgentProfile,
  fields: ActionBuilder,
  source: PlannerSource,
): PlannerResult {
  const action = parsePlannerOutput(
    {
      schemaVersion: '1.0',
      intent: fields.intent,
      targetType: fields.targetType,
      targetId: fields.targetId,
      choice: null,
      buildAmount: fields.buildAmount ?? null,
      publicMessage: fields.publicMessage ?? '',
      rationale: fields.rationale,
      evidenceEventIds: fields.evidenceEventIds ?? [],
      confidenceSelfReport: fields.intent === 'ABSTAIN' ? 0.2 : 0.6,
      requiresOwnerApproval: fields.approval ?? false,
    },
    contextFor(observation, profile),
  );
  return { action, source };
}

function abstain(
  observation: AgentObservationV1,
  profile: AgentProfile,
  rationale: string,
  source: PlannerSource,
): PlannerResult {
  return buildResult(
    observation,
    profile,
    {
      intent: 'ABSTAIN',
      targetType: 'NONE',
      targetId: null,
      rationale,
    },
    source,
  );
}

function discuss(
  observation: AgentObservationV1,
  profile: AgentProfile,
  targetType: 'PROJECT' | 'PROPOSAL',
  targetId: string,
  message: string,
  evidence: string[],
): PlannerResult {
  return buildResult(
    observation,
    profile,
    {
      intent: 'DISCUSS',
      targetType,
      targetId,
      publicMessage: message,
      rationale: `${profile.persona}/${profile.goal}: ${message}`,
      evidenceEventIds: evidence,
    },
    'RULE_BASED',
  );
}

function contribution(
  observation: AgentObservationV1,
  profile: AgentProfile,
  projectId: string,
  amount: bigint,
  remaining: bigint,
  balance: bigint,
): PlannerResult {
  const amountText = amount.toString();
  return buildResult(
    observation,
    profile,
    {
      intent: 'SUGGEST_CONTRIBUTION',
      targetType: 'PROJECT',
      targetId: projectId,
      buildAmount: amountText,
      publicMessage: `Suggest contributing ${amountText} BUILD to project #${projectId}.`,
      rationale: `${profile.persona}/${profile.goal}: project #${projectId} still needs ${remaining} BUILD; confirmed balance ${balance}; suggesting ${amountText}. Owner approval required.`,
      approval: true,
    },
    'RULE_BASED',
  );
}

function minBigInt(values: readonly bigint[]): bigint {
  return values.reduce((lowest, value) => (value < lowest ? value : lowest));
}

/**
 * Deterministic planner: same observation + profile → same action.
 * Persona changes the strategy; goal changes the objective.
 */
export function planRuleBased(input: PlannerPlanInput): PlannerResult {
  const { observation, profile } = validateInput(input);
  const project = observation.facts.projects.find((entry) => entry.status === 'FUNDING');
  const balance = BigInt(observation.self.build);
  const remaining =
    project === undefined
      ? 0n
      : BigInt(project.goalBuild) - BigInt(project.fundedBuild);
  const evidence = observation.chainRecentEventIds.slice(0, 3);

  if (profile.goal === 'DEFEND_RULES') {
    const proposal = observation.facts.proposals.find((entry) => entry.status === 'OPEN');
    if (proposal !== undefined) {
      return discuss(
        observation,
        profile,
        'PROPOSAL',
        proposal.id,
        `Proposal #${proposal.id} needs confirmed evidence before I support it.`,
        evidence,
      );
    }
    return abstain(
      observation,
      profile,
      'DEFEND_RULES: no open proposal with confirmed evidence to review.',
      'RULE_BASED',
    );
  }

  if (profile.goal === 'EXPLORE_COALITIONS') {
    if (project !== undefined && remaining > 0n) {
      return discuss(
        observation,
        profile,
        'PROJECT',
        project.id,
        `Conditional support: I will consider contributing if at least three citizens publicly commit to project #${project.id}.`,
        evidence,
      );
    }
    return abstain(
      observation,
      profile,
      'EXPLORE_COALITIONS: no open project to coordinate around.',
      'RULE_BASED',
    );
  }

  if (project === undefined || remaining <= 0n) {
    return abstain(
      observation,
      profile,
      `${profile.persona}/${profile.goal}: no confirmed funding gap on a FUNDING project.`,
      'RULE_BASED',
    );
  }

  if (profile.persona === 'RULE_BASED') {
    return discuss(
      observation,
      profile,
      'PROJECT',
      project.id,
      `Please publish confirmed progress evidence before suggesting a contribution to project #${project.id}.`,
      evidence,
    );
  }

  if (balance <= 0n) {
    return abstain(
      observation,
      profile,
      `${profile.persona}/${profile.goal}: owner has no confirmed BUILD balance.`,
      'RULE_BASED',
    );
  }

  const cap =
    profile.persona === 'PRAGMATIC' ? 50n : profile.persona === 'COMPETITIVE' ? 25n : 10n;
  const amount = minBigInt([balance, remaining, cap]);

  if (profile.persona === 'COOPERATIVE') {
    return discuss(
      observation,
      profile,
      'PROJECT',
      project.id,
      `Conditional support: I will contribute ${amount.toString()} BUILD to project #${project.id} if at least three citizens publicly commit.`,
      evidence,
    );
  }

  if (amount <= 0n) {
    return abstain(
      observation,
      profile,
      `${profile.persona}/${profile.goal}: confirmed balance or remaining goal does not allow a contribution.`,
      'RULE_BASED',
    );
  }

  return contribution(observation, profile, project.id, amount, remaining, balance);
}

export async function planWithProvider(
  input: PlannerPlanInput,
  provider: PlannerModelProvider,
): Promise<PlannerResult> {
  const { observation, profile } = validateInput(input);
  const { system, user } = buildPlannerPrompts(profile, observation);
  const request: PlannerModelRequest = { system, user, maxOutputTokens: 500 };
  const context = contextFor(observation, profile);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: string;
    try {
      raw = await provider.complete(request);
    } catch {
      return abstain(
        observation,
        profile,
        'Planner model was unavailable; abstaining.',
        'ABSTAIN_FALLBACK',
      );
    }

    try {
      return { action: parsePlannerJson(raw, context), source: 'MODEL' };
    } catch {
      // Retry once on a malformed response; policy failures are not retried.
    }
  }

  return abstain(
    observation,
    profile,
    'Planner output failed schema validation after one retry; abstaining.',
    'ABSTAIN_FALLBACK',
  );
}
