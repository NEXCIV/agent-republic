import { describe, expect, it } from 'vitest';
import { plannerOutputSchema, proposedActionSchema } from '../src/agent-v1.js';

/**
 * E3-01 — planner schema boundaries. Identity fields are not part of the
 * model schema and must never be accepted from model output.
 */

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

describe('plannerOutputSchema', () => {
  it('accepts a minimal ABSTAIN-shaped output', () => {
    expect(plannerOutputSchema.safeParse(base).success).toBe(true);
  });

  it('rejects identity and observation fields supplied by the model', () => {
    for (const extra of [
      { owner: `0x${'11'.repeat(20)}` },
      { agentId: 'forged-agent' },
      { epochId: 99 },
      { observedBlock: '123456' },
    ]) {
      const result = plannerOutputSchema.safeParse({ ...base, ...extra });
      expect(result.success).toBe(false);
    }
  });

  it('rejects unknown keys', () => {
    expect(plannerOutputSchema.safeParse({ ...base, transferTo: '0xabc' }).success).toBe(false);
  });

  it('rejects bad enums and numeric bounds', () => {
    expect(plannerOutputSchema.safeParse({ ...base, intent: 'TRANSFER_FUNDS' }).success).toBe(false);
    expect(plannerOutputSchema.safeParse({ ...base, targetType: 'WALLET' }).success).toBe(false);
    expect(plannerOutputSchema.safeParse({ ...base, choice: 'MAYBE' }).success).toBe(false);
    expect(plannerOutputSchema.safeParse({ ...base, confidenceSelfReport: 1.5 }).success).toBe(false);
    expect(plannerOutputSchema.safeParse({ ...base, confidenceSelfReport: Number.NaN }).success).toBe(false);
  });

  it('requires decimal integer build amounts', () => {
    for (const bad of ['-1', '1.5', '1e3', '', '0x10']) {
      expect(plannerOutputSchema.safeParse({ ...base, buildAmount: bad }).success).toBe(false);
    }
    expect(plannerOutputSchema.safeParse({ ...base, buildAmount: '50' }).success).toBe(true);
  });

  it('counts Unicode code points for message limits', () => {
    expect(plannerOutputSchema.safeParse({ ...base, publicMessage: '🦊'.repeat(500) }).success).toBe(true);
    expect(plannerOutputSchema.safeParse({ ...base, publicMessage: '🦊'.repeat(501) }).success).toBe(false);
    expect(plannerOutputSchema.safeParse({ ...base, rationale: 'a'.repeat(600) }).success).toBe(true);
    expect(plannerOutputSchema.safeParse({ ...base, rationale: 'a'.repeat(601) }).success).toBe(false);
  });
});

describe('proposedActionSchema', () => {
  it('accepts authoritative identity fields and normalises the owner', () => {
    const parsed = proposedActionSchema.parse({
      ...base,
      owner: `0x${'AB'.repeat(20)}`,
      agentId: 'agent-1',
      epochId: 12,
      observedBlock: '58392000',
    });
    expect(parsed.owner).toBe(`0x${'ab'.repeat(20)}`);
    expect(parsed.epochId).toBe(12);
  });

  it('rejects malformed authoritative fields', () => {
    expect(
      proposedActionSchema.safeParse({
        ...base,
        owner: 'not-an-address',
        agentId: 'agent-1',
        epochId: 12,
        observedBlock: '58392000',
      }).success,
    ).toBe(false);
    expect(
      proposedActionSchema.safeParse({
        ...base,
        owner: `0x${'11'.repeat(20)}`,
        agentId: 'agent-1',
        epochId: -1,
        observedBlock: '58392000',
      }).success,
    ).toBe(false);
  });
});
