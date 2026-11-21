import { describe, expect, it } from 'vitest';
import { decodeFunctionData } from 'viem';
import {
  ActionEncodingError,
  CORE_ACTION_ABI,
  encodeCastVote,
  encodeContribution,
  encodeNote,
  MAX_UINT128,
  VOTE_CHOICE_CODES,
} from '../src/index.js';

/**
 * E2-05 calldata tests. The API must produce exactly what the contract ABI
 * expects — wrong argument order or a NONE vote would burn a real wallet tx.
 */

const OWNER = `0x${'ab'.repeat(20)}`;
const NOTE_HASH = `0x${'11'.repeat(32)}`;

describe('encodeCastVote', () => {
  it('maps YES/NO/ABSTAIN to the contract enum values', () => {
    expect(VOTE_CHOICE_CODES).toEqual({ YES: 1, NO: 2, ABSTAIN: 3 });

    const data = encodeCastVote({ proposalId: 7n, choice: 'ABSTAIN' });
    const decoded = decodeFunctionData({ abi: CORE_ACTION_ABI, data });
    expect(decoded.functionName).toBe('castVote');
    expect(decoded.args).toEqual([7n, 3]);
  });

  it('never encodes NONE (0)', () => {
    expect(() => encodeCastVote({ proposalId: 7n, choice: 'NONE' as never })).toThrow(
      ActionEncodingError,
    );
  });

  it('rejects a non-positive proposal id', () => {
    expect(() => encodeCastVote({ proposalId: 0n, choice: 'YES' })).toThrow(ActionEncodingError);
  });
});

describe('encodeContribution', () => {
  it('encodes projectId and amount as uint256/uint128', () => {
    const data = encodeContribution({ projectId: 1n, amount: 250n });
    const decoded = decodeFunctionData({ abi: CORE_ACTION_ABI, data });
    expect(decoded.functionName).toBe('contribute');
    expect(decoded.args).toEqual([1n, 250n]);
  });

  it('accepts the maximum uint128', () => {
    expect(() => encodeContribution({ projectId: 1n, amount: MAX_UINT128 })).not.toThrow();
  });

  it('rejects zero, negative and oversize amounts', () => {
    expect(() => encodeContribution({ projectId: 1n, amount: 0n })).toThrow(ActionEncodingError);
    expect(() => encodeContribution({ projectId: 1n, amount: -1n })).toThrow(ActionEncodingError);
    expect(() => encodeContribution({ projectId: 1n, amount: MAX_UINT128 + 1n })).toThrow(
      ActionEncodingError,
    );
  });
});

describe('encodeNote', () => {
  it('encodes owner and note hash', () => {
    const data = encodeNote({ owner: OWNER.toUpperCase(), noteHash: NOTE_HASH });
    const decoded = decodeFunctionData({ abi: CORE_ACTION_ABI, data });
    expect(decoded.functionName).toBe('publishNote');
    // viem returns the checksummed form; the address value must still match.
    expect(String(decoded.args[0]).toLowerCase()).toBe(OWNER);
    expect(decoded.args[1]).toBe(NOTE_HASH);
  });

  it('rejects a malformed note hash', () => {
    expect(() => encodeNote({ owner: OWNER, noteHash: '0x12' })).toThrow(ActionEncodingError);
  });
});
