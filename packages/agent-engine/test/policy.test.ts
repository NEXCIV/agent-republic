import { describe, expect, it } from 'vitest';
import type { AgentObservationV1 } from '@agent-republic/domain';
import { parsePlannerOutput } from '../src/action.js';
import type { AgentActionContext } from '../src/action.js';
import { validateAction } from '../src/policy.js';
import type { PolicyContext } from '../src/policy.js';

/**
 * E3-04 — deterministic policy: identity, whitelist, targets, limits,
 * moderation and amounts. Chain suggestions never become executable.
 */

const OWNER = `0x${'ab'.repeat(20)}`;
const OTHER = `0x${'ef'.repeat(20)}`;

const observation: AgentObservationV1 = {
  worldFrameId: `0x${'11'.repeat(32)}`,
  sourceBlock: '1000',
  epochId: 7,
  facts: {
    citizenCount: 5,
    projects: [
      {
        id: '1',
        titleKey: 'golden-toilet-tower',
        goalBuild: '2000',
        fundedBuild: '1200',
        status: 'FUNDING',
        completedAtBlock: null,
      },
    ],
    proposals: [
      {
        id: '7',
        status: 'OPEN',
        yes: 0,
        no: 0,
        abstain: 0,
        deadline: '2026-11-20T00:00:00.000Z',
      },
      {
        id: '8',
        status: 'PASSED',
        yes: 3,
        no: 0,
        abstain: 0,
        deadline: '2026-11-19T00:00:00.000Z',
      },
    ],
  },
  self: {
    owner: OWNER,
    hasAgentId: true,
    registered: true,
    build: '100',
    rep: '6',
  },
  approvedPublicMessages: [],
  chainRecentEventIds: [],
};

const actionContext: AgentActionContext = {
  owner: OWNER,
  agentId: 'agent-1',
  epochId: 7,
  observedBlock: '1000',
  allowedEvidenceEventIds: [],
};

const base = {
  schemaVersion: '1.0',
  intent: 'ABSTAIN',
  targetType: 'NONE',
  targetId: null,
  choice: null,
  buildAmount: null,
  publicMessage: '',
  rationale: 'No action.',
  evidenceEventIds: [],
  confidenceSelfReport: 0.3,
  requiresOwnerApproval: false,
};

function plan(overrides: Record<string, unknown>, context = actionContext) {
  return parsePlannerOutput({ ...base, ...overrides }, context);
}

const contribution = plan({
  intent: 'SUGGEST_CONTRIBUTION',
  targetType: 'PROJECT',
  targetId: '1',
  buildAmount: '50',
  publicMessage: 'Contribute 50 BUILD.',
  requiresOwnerApproval: true,
});
const vote = plan({
  intent: 'SUGGEST_VOTE',
  targetType: 'PROPOSAL',
  targetId: '7',
  choice: 'YES',
  publicMessage: 'Vote yes.',
  requiresOwnerApproval: true,
});
const discussion = plan({
  intent: 'DISCUSS',
  targetType: 'PROJECT',
  targetId: '1',
  publicMessage: 'The on-chain numbers are visible.',
});
const note = plan({
  intent: 'PUBLISH_NOTE_REQUEST',
  targetType: 'NONE',
  targetId: null,
  publicMessage: 'Publish a short note.',
  requiresOwnerApproval: true,
});
const location = plan({
  intent: 'SOCIAL_LOCATION_REQUEST',
  targetType: 'LOCATION',
  targetId: 'PLAZA',
});
const abstain = plan({});

const context: PolicyContext = {
  agent: {
    agentId: 'agent-1',
    owner: OWNER,
    status: 'ACTIVE',
    allowPublicDiscussion: true,
  },
  sessionOwner: OWNER,
  snapshot: { observation, stale: false },
  actionsThisEpoch: 0,
  maxActionsPerEpoch: 10,
  noteDelegateEnabled: false,
  moderatePublicMessage: () => 'APPROVED',
};

function withContext(overrides: Partial<PolicyContext>): PolicyContext {
  return { ...context, ...overrides };
}

describe('validateAction — allowed paths', () => {
  it('turns a contribution suggestion into AWAITING_OWNER, never executable', () => {
    const decision = validateAction(contribution, context);
    expect(decision).toMatchObject({
      allowed: true,
      mode: 'AWAITING_OWNER',
      executable: false,
    });
  });

  it('turns a vote suggestion into AWAITING_OWNER', () => {
    expect(validateAction(vote, context)).toMatchObject({
      allowed: true,
      mode: 'AWAITING_OWNER',
      executable: false,
    });
  });

  it('gates NOTE publishing on the limited delegate flag', () => {
    expect(validateAction(note, context)).toMatchObject({
      allowed: true,
      mode: 'OPTIONAL_LIMITED_DELEGATE',
      executable: false,
    });
    expect(validateAction(note, withContext({ noteDelegateEnabled: true }))).toMatchObject({
      allowed: true,
      executable: true,
    });
  });

  it('allows discussion and location requests as off-chain only', () => {
    expect(validateAction(discussion, context)).toMatchObject({
      allowed: true,
      mode: 'OFFCHAIN_ONLY',
      executable: true,
    });
    expect(validateAction(location, context)).toMatchObject({
      allowed: true,
      mode: 'OFFCHAIN_ONLY',
      executable: true,
    });
  });

  it('does not call moderation for an empty ABSTAIN', () => {
    let calls = 0;
    const decision = validateAction(
      abstain,
      withContext({
        moderatePublicMessage: () => {
          calls += 1;
          return 'APPROVED';
        },
      }),
    );
    expect(decision.allowed).toBe(true);
    expect(calls).toBe(0);
  });
});

describe('validateAction — forbidden paths', () => {
  it('rejects transfer/approval/calldata fields through the strict schema', () => {
    for (const extra of [
      { to: OTHER, value: '1' },
      { data: '0xdeadbeef' },
      { approve: true, spender: OTHER },
    ]) {
      const decision = validateAction({ ...contribution, ...extra }, context);
      expect(decision.allowed).toBe(false);
      expect(decision.code).toBe('SCHEMA');
    }
  });

  it('rejects an unknown intent', () => {
    const decision = validateAction({ ...contribution, intent: 'TRANSFER_FUNDS' }, context);
    expect(decision.code).toBe('SCHEMA');
  });

  it('rejects owner, agent and observation mismatches', () => {
    expect(validateAction(contribution, withContext({ sessionOwner: OTHER })).code).toBe(
      'OWNER_MISMATCH',
    );
    expect(
      validateAction(
        { ...contribution, owner: OTHER },
        withContext({ agent: { ...context.agent, owner: OTHER }, sessionOwner: OTHER }),
      ).code,
    ).toBe('OWNER_MISMATCH');
    expect(
      validateAction(contribution, withContext({ agent: { ...context.agent, agentId: 'agent-x' } }))
        .code,
    ).toBe('AGENT_MISMATCH');
  });

  it('rejects paused agents and stale snapshots', () => {
    expect(
      validateAction(contribution, withContext({ agent: { ...context.agent, status: 'PAUSED' } }))
        .code,
    ).toBe('AGENT_NOT_ACTIVE');
    expect(
      validateAction(contribution, withContext({ snapshot: { observation, stale: true } })).code,
    ).toBe('STALE_SNAPSHOT');
  });

  it('rejects epoch or block drift', () => {
    const wrongEpoch = plan(
      {
        intent: 'SUGGEST_CONTRIBUTION',
        targetType: 'PROJECT',
        targetId: '1',
        buildAmount: '10',
        requiresOwnerApproval: true,
      },
      { ...actionContext, epochId: 8 },
    );
    expect(validateAction(wrongEpoch, context).code).toBe('EPOCH_MISMATCH');

    const wrongBlock = plan(
      {
        intent: 'SUGGEST_CONTRIBUTION',
        targetType: 'PROJECT',
        targetId: '1',
        buildAmount: '10',
        requiresOwnerApproval: true,
      },
      { ...actionContext, observedBlock: '1001' },
    );
    expect(validateAction(wrongBlock, context).code).toBe('STALE_SNAPSHOT');
  });

  it('enforces the per-agent intent whitelist', () => {
    const restricted = withContext({ allowedIntents: ['DISCUSS', 'ABSTAIN'] });
    expect(validateAction(contribution, restricted).code).toBe('INTENT_NOT_ALLOWED');
    expect(validateAction(discussion, restricted).allowed).toBe(true);
  });

  it('enforces approval flags on forged actions', () => {
    expect(
      validateAction({ ...contribution, requiresOwnerApproval: false }, context).code,
    ).toBe('APPROVAL_REQUIRED');
    expect(validateAction({ ...discussion, requiresOwnerApproval: true }, context).code).toBe(
      'APPROVAL_NOT_ALLOWED',
    );
  });

  it('enforces per-epoch rate limits for action-producing intents', () => {
    const limited = withContext({ actionsThisEpoch: 10, maxActionsPerEpoch: 10 });
    expect(validateAction(discussion, limited).code).toBe('RATE_LIMITED');
    expect(validateAction(abstain, limited).allowed).toBe(true);
  });

  it('requires approved moderation for public text', () => {
    expect(
      validateAction(discussion, withContext({ moderatePublicMessage: () => 'REJECTED' })).code,
    ).toBe('MODERATION_REJECTED');
    expect(
      validateAction(discussion, withContext({ moderatePublicMessage: () => 'UNAVAILABLE' })).code,
    ).toBe('MODERATION_UNAVAILABLE');
    expect(
      validateAction(
        discussion,
        withContext({ agent: { ...context.agent, allowPublicDiscussion: false } }),
      ).code,
    ).toBe('DISCUSSION_DISABLED');
  });

  it('verifies targets against the observation', () => {
    const unknownProject = plan({
      intent: 'SUGGEST_CONTRIBUTION',
      targetType: 'PROJECT',
      targetId: '99',
      buildAmount: '10',
      requiresOwnerApproval: true,
    });
    expect(validateAction(unknownProject, context).code).toBe('TARGET_NOT_FOUND');

    const closedProposal = plan({
      intent: 'SUGGEST_VOTE',
      targetType: 'PROPOSAL',
      targetId: '8',
      choice: 'YES',
      requiresOwnerApproval: true,
    });
    expect(validateAction(closedProposal, context).code).toBe('TARGET_NOT_ACTIVE');

    const agentDiscussion = plan({
      intent: 'DISCUSS',
      targetType: 'AGENT',
      targetId: 'agent-9',
      publicMessage: 'Hello.',
    });
    expect(validateAction(agentDiscussion, context).code).toBe('INTENT_NOT_ALLOWED');
  });

  it('checks positive amount, balance and remaining goal', () => {
    expect(
      validateAction({ ...contribution, buildAmount: '0' }, context).code,
    ).toBe('AMOUNT_NOT_POSITIVE');
    expect(
      validateAction({ ...contribution, buildAmount: '101' }, context).code,
    ).toBe('AMOUNT_EXCEEDS_BALANCE');

    const richObservation: AgentObservationV1 = {
      ...observation,
      self: { ...observation.self, build: '1000' },
    };
    expect(
      validateAction(
        { ...contribution, buildAmount: '900' },
        withContext({ snapshot: { observation: richObservation, stale: false } }),
      ).code,
    ).toBe('AMOUNT_EXCEEDS_REMAINING');
  });

  it('rejects invalid contexts before touching the action', () => {
    const badObservation = {
      ...context,
      snapshot: { observation: { ...observation, sourceBlock: 'nope' }, stale: false },
    };
    expect(validateAction(contribution, badObservation as PolicyContext).code).toBe(
      'INVALID_CONTEXT',
    );
  });
});
