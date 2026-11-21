import { describe, expect, it } from 'vitest';
import { agentMemoryEntrySchema } from '../src/agent-v1.js';

/**
 * E3-06 — memory schema: kind/label coupling and source requirements.
 */

const fact = {
  id: 'memory-1',
  agentId: 'agent-1',
  kind: 'FACT',
  text: 'Contribution of 50 BUILD is confirmed on chain.',
  sourceIds: ['tx-1:1'],
  createdAt: '2026-11-19T00:00:00.000Z',
  agentConfigVersion: 1,
  confidenceLabel: 'CHAIN_CONFIRMED',
} as const;

describe('agentMemoryEntrySchema', () => {
  it('accepts a sourced FACT memory', () => {
    expect(agentMemoryEntrySchema.safeParse(fact).success).toBe(true);
  });

  it('requires source IDs for FACT and SOCIAL memories', () => {
    expect(agentMemoryEntrySchema.safeParse({ ...fact, sourceIds: [] }).success).toBe(false);
    expect(
      agentMemoryEntrySchema.safeParse({
        ...fact,
        kind: 'SOCIAL',
        confidenceLabel: 'SOCIAL_APPROVED',
        sourceIds: [],
      }).success,
    ).toBe(false);
  });

  it('never lets a reflection carry a chain-confirmed label', () => {
    expect(
      agentMemoryEntrySchema.safeParse({
        ...fact,
        kind: 'REFLECTION',
        confidenceLabel: 'CHAIN_CONFIRMED',
        sourceIds: [],
      }).success,
    ).toBe(false);
  });

  it('rejects unknown keys and invalid config versions', () => {
    expect(agentMemoryEntrySchema.safeParse({ ...fact, owner: '0xabc' }).success).toBe(false);
    expect(agentMemoryEntrySchema.safeParse({ ...fact, agentConfigVersion: 0 }).success).toBe(false);
  });

  it('counts Unicode code points for the summary length', () => {
    expect(agentMemoryEntrySchema.safeParse({ ...fact, text: 'a'.repeat(500) }).success).toBe(true);
    expect(agentMemoryEntrySchema.safeParse({ ...fact, text: 'a'.repeat(501) }).success).toBe(false);
  });
});
