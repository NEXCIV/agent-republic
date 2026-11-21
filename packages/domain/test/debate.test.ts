import { describe, expect, it } from 'vitest';
import { debateMessageSchema } from '../src/agent-v1.js';

/**
 * E3-05 — public debate message schema: turn/block fields, moderation and
 * provenance are mandatory, so a line cannot be shown without AI_SIMULATED.
 */

const base = {
  threadId: 'thread-1',
  epochId: 7,
  speakerAgentId: 'agent-1',
  targetAgentId: 'agent-2',
  stance: 'CONDITIONAL',
  condition: { kind: 'MIN_SUPPORT', value: '3' },
  text: 'I support this if three citizens commit.',
  groundedInSnapshotBlock: '1000',
  turnIndex: 0,
  moderation: 'APPROVED',
  provenance: 'AI_SIMULATED',
} as const;

describe('debateMessageSchema', () => {
  it('accepts a grounded, approved, AI-labelled message', () => {
    expect(debateMessageSchema.safeParse(base).success).toBe(true);
  });

  it('requires provenance and moderation to be the safe literals', () => {
    expect(debateMessageSchema.safeParse({ ...base, provenance: 'CHAIN_CONFIRMED' }).success).toBe(false);
    expect(debateMessageSchema.safeParse({ ...base, moderation: 'PENDING' }).success).toBe(false);
  });

  it('validates condition semantics', () => {
    expect(
      debateMessageSchema.safeParse({ ...base, condition: { kind: 'NONE', value: null } }).success,
    ).toBe(true);
    expect(
      debateMessageSchema.safeParse({ ...base, condition: { kind: 'NONE', value: '3' } }).success,
    ).toBe(false);
    expect(
      debateMessageSchema.safeParse({ ...base, condition: { kind: 'MIN_PROGRESS', value: null } }).success,
    ).toBe(false);
    expect(
      debateMessageSchema.safeParse({ ...base, condition: { kind: 'MIN_SUPPORT', value: 'three' } }).success,
    ).toBe(false);
  });

  it('rejects unknown fields such as transfer instructions', () => {
    expect(debateMessageSchema.safeParse({ ...base, to: '0xabc', value: '1' }).success).toBe(false);
  });

  it('counts Unicode code points for text length', () => {
    expect(debateMessageSchema.safeParse({ ...base, text: '🦊'.repeat(500) }).success).toBe(true);
    expect(debateMessageSchema.safeParse({ ...base, text: '🦊'.repeat(501) }).success).toBe(false);
  });
});
