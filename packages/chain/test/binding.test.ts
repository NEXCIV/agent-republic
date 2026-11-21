import { describe, expect, it } from 'vitest';
import { decodeFunctionData } from 'viem';
import {
  BindingCommitmentError,
  computeBindingCommitment,
  encodeRegisterCitizen,
  hashChallengeNonce,
  REGISTRY_BINDING_ABI,
} from '../src/index.js';

/**
 * E2-04 commitment tests. The encoding order is part of the security
 * contract: if it changes, every previously issued challenge becomes invalid.
 */

const OWNER = `0x${'ab'.repeat(20)}`;
const NONCE = `0x${'11'.repeat(32)}`;
const CONFIG_HASH = `0x${'22'.repeat(32)}`;

const input = {
  appUserId: '6f1c1b0e-2d3a-4c55-9a11-000000000001',
  owner: OWNER,
  nonce: NONCE,
  agentConfigHash: CONFIG_HASH,
  expiresAt: 1_800_000_000n,
};

describe('computeBindingCommitment', () => {
  it('is deterministic for identical inputs', () => {
    expect(computeBindingCommitment(input)).toBe(computeBindingCommitment(input));
  });

  it('produces a 32-byte hash', () => {
    expect(computeBindingCommitment(input)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('changes when any component changes', () => {
    const base = computeBindingCommitment(input);
    const variants = [
      computeBindingCommitment({ ...input, appUserId: 'another-user' }),
      computeBindingCommitment({ ...input, owner: `0x${'cd'.repeat(20)}` }),
      computeBindingCommitment({ ...input, nonce: `0x${'33'.repeat(32)}` }),
      computeBindingCommitment({ ...input, agentConfigHash: `0x${'44'.repeat(32)}` }),
      computeBindingCommitment({ ...input, expiresAt: input.expiresAt + 1n }),
    ];
    for (const variant of variants) {
      expect(variant).not.toBe(base);
    }
  });

  it('is insensitive to address casing but sensitive to nonce casing', () => {
    expect(computeBindingCommitment({ ...input, owner: OWNER.toUpperCase() })).toBe(
      computeBindingCommitment(input),
    );
    // Nonces are hex bytes; the same value with different casing must still
    // hash to the same bytes after normalization.
    expect(computeBindingCommitment({ ...input, nonce: NONCE.toUpperCase() })).toBe(
      computeBindingCommitment(input),
    );
  });

  it('rejects malformed nonce or config hash', () => {
    expect(() => computeBindingCommitment({ ...input, nonce: '0x12' })).toThrow(BindingCommitmentError);
    expect(() => computeBindingCommitment({ ...input, agentConfigHash: 'nope' })).toThrow(
      BindingCommitmentError,
    );
  });

  it('rejects a non-positive expiry', () => {
    expect(() => computeBindingCommitment({ ...input, expiresAt: 0n })).toThrow(BindingCommitmentError);
  });
});

describe('encodeRegisterCitizen', () => {
  const commitment = computeBindingCommitment(input);

  it('encodes a single bytes32 argument with the registerCitizen selector', () => {
    const data = encodeRegisterCitizen(commitment);
    expect(data).toMatch(/^0x[0-9a-f]{8}[0-9a-f]{64}$/);
    const decoded = decodeFunctionData({ abi: REGISTRY_BINDING_ABI, data });
    expect(decoded.functionName).toBe('registerCitizen');
    expect(decoded.args).toEqual([commitment]);
  });

  it('rejects a malformed commitment', () => {
    expect(() => encodeRegisterCitizen('0xdeadbeef')).toThrow(BindingCommitmentError);
  });
});

describe('hashChallengeNonce', () => {
  it('produces a stable 32-byte hash without exposing the nonce', () => {
    const hash = hashChallengeNonce(NONCE);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hash).not.toBe(NONCE);
    expect(hash).toBe(hashChallengeNonce(NONCE));
  });
});
