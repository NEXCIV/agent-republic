import { describe, expect, it } from 'vitest';
import {
  AgentOutputError,
  parsePlannerJson,
  parsePlannerOutput,
} from '../src/action.js';
import type { AgentActionContext } from '../src/action.js';

/**
 * E3-01 — end-to-end output validation.
 * Valid model text becomes a ProposedAction only after schema + intent checks;
 * identity fields always come from the trusted context.
 */

const owner = `0x${'AB'.repeat(20)}`;
const context: AgentActionContext = {
  owner,
  agentId: 'agent-1',
  epochId: 12,
  observedBlock: '58392000',
  allowedEvidenceEventIds: ['evt-1', 'evt-2'],
};

const base = {
  schemaVersion: '1.0',
  intent: 'ABSTAIN',
  targetType: 'NONE',
  targetId: null,
  choice: null,
  buildAmount: null,
  publicMessage: '',
  rationale: 'No safe action this epoch.',
  evidenceEventIds: [],
  confidenceSelfReport: 0.4,
  requiresOwnerApproval: false,
} as const;

function expectError(run: () => unknown): AgentOutputError {
  try {
    run();
  } catch (error) {
    if (error instanceof AgentOutputError) return error;
    throw error;
  }
  throw new Error('expected AgentOutputError');
}

describe('parsePlannerOutput', () => {
  it('injects owner/agent/epoch/block from the trusted context', () => {
    const action = parsePlannerOutput(
      {
        ...base,
        intent: 'SUGGEST_CONTRIBUTION',
        targetType: 'PROJECT',
        targetId: '1',
        buildAmount: '50',
        publicMessage: 'Contribute 50 BUILD.',
        evidenceEventIds: ['evt-1'],
        requiresOwnerApproval: true,
      },
      context,
    );

    expect(action.owner).toBe(`0x${'ab'.repeat(20)}`);
    expect(action.agentId).toBe('agent-1');
    expect(action.epochId).toBe(12);
    expect(action.observedBlock).toBe('58392000');
    expect(action.buildAmount).toBe('50');
  });

  it('rejects a model-supplied owner instead of correcting it', () => {
    const error = expectError(() =>
      parsePlannerOutput({ ...base, owner: `0x${'11'.repeat(20)}` }, context),
    );
    expect(error.code).toBe('INVALID_SCHEMA');
    expect(error.issues.join(' ')).toContain('owner');
  });

  it('rejects invalid JSON', () => {
    const error = expectError(() => parsePlannerJson('{"intent":', context));
    expect(error.code).toBe('INVALID_JSON');
  });

  it('accepts a valid JSON string', () => {
    const action = parsePlannerJson(JSON.stringify(base), context);
    expect(action.intent).toBe('ABSTAIN');
  });

  it('rejects contribution amounts that are not positive', () => {
    const zero = expectError(() =>
      parsePlannerOutput(
        {
          ...base,
          intent: 'SUGGEST_CONTRIBUTION',
          targetType: 'PROJECT',
          targetId: '1',
          buildAmount: '0',
          requiresOwnerApproval: true,
        },
        context,
      ),
    );
    expect(zero.code).toBe('INVALID_ACTION');
    expect(zero.issues.join(' ')).toContain('greater than zero');
  });

  it('rejects on-chain suggestions that skip owner approval', () => {
    const error = expectError(() =>
      parsePlannerOutput(
        {
          ...base,
          intent: 'SUGGEST_VOTE',
          targetType: 'PROPOSAL',
          targetId: '7',
          choice: 'YES',
          requiresOwnerApproval: false,
        },
        context,
      ),
    );
    expect(error.code).toBe('INVALID_ACTION');
    expect(error.issues.join(' ')).toContain('must require owner approval');
  });

  it('enforces the intent/target matrix', () => {
    for (const candidate of [
      { intent: 'SUGGEST_VOTE', targetType: 'PROJECT', targetId: '1', choice: 'YES', requiresOwnerApproval: true },
      { intent: 'SUGGEST_VOTE', targetType: 'PROPOSAL', targetId: '1', choice: null, requiresOwnerApproval: true },
      { intent: 'SUGGEST_CONTRIBUTION', targetType: 'PROPOSAL', targetId: '1', buildAmount: '5', requiresOwnerApproval: true },
      { intent: 'DISCUSS', targetType: 'LOCATION', targetId: 'PLAZA', requiresOwnerApproval: false },
      { intent: 'SOCIAL_LOCATION_REQUEST', targetType: 'PROJECT', targetId: '1', requiresOwnerApproval: false },
      { intent: 'ABSTAIN', targetType: 'PROJECT', targetId: '1', requiresOwnerApproval: false },
    ]) {
      const error = expectError(() => parsePlannerOutput({ ...base, ...candidate }, context));
      expect(error.code).toBe('INVALID_ACTION');
    }
  });

  it('allows a location request for a LOCATION target', () => {
    const action = parsePlannerOutput(
      {
        ...base,
        intent: 'SOCIAL_LOCATION_REQUEST',
        targetType: 'LOCATION',
        targetId: 'PLAZA',
        publicMessage: 'Heading to the plaza.',
      },
      context,
    );
    expect(action.targetId).toBe('PLAZA');
  });

  it('requires a public message for DISCUSS', () => {
    const error = expectError(() =>
      parsePlannerOutput(
        {
          ...base,
          intent: 'DISCUSS',
          targetType: 'PROJECT',
          targetId: '1',
          publicMessage: '   ',
        },
        context,
      ),
    );
    expect(error.code).toBe('INVALID_ACTION');
    expect(error.issues.join(' ')).toContain('public message');
  });

  it('rejects evidence IDs that are not in the observation', () => {
    const error = expectError(() =>
      parsePlannerOutput(
        {
          ...base,
          intent: 'DISCUSS',
          targetType: 'PROJECT',
          targetId: '1',
          publicMessage: 'Contribution is real.',
          evidenceEventIds: ['evt-forged'],
        },
        context,
      ),
    );
    expect(error.code).toBe('INVALID_ACTION');
    expect(error.issues.join(' ')).toContain('evt-forged');
  });

  it('rejects an invalid authoritative context', () => {
    const error = expectError(() =>
      parsePlannerOutput(base, { ...context, owner: '0x1234', observedBlock: '12.5' }),
    );
    expect(error.code).toBe('INVALID_CONTEXT');
  });

  it('keeps large build amounts as exact decimal strings', () => {
    const amount = '999999999999999999999';
    const action = parsePlannerOutput(
      {
        ...base,
        intent: 'SUGGEST_CONTRIBUTION',
        targetType: 'PROJECT',
        targetId: '1',
        buildAmount: amount,
        requiresOwnerApproval: true,
      },
      context,
    );
    expect(action.buildAmount).toBe(amount);
  });
});
