import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import type { VoteChoice } from '@agent-republic/domain';

/**
 * E2-05 intent calldata encoding (docs/SMART_CONTRACTS.md §5.5–§5.8).
 *
 * The API only ENCODES calls; signing and submission stay with the owner's
 * wallet (docs/ARCHITECTURE.md §7.3). All values are validated here so a
 * malformed intent never reaches a wallet prompt.
 */

export const CORE_ACTION_ABI = parseAbi([
  'function castVote(uint256 proposalId, uint8 choice)',
  'function contribute(uint256 projectId, uint128 amount)',
  'function publishNote(address owner, bytes32 noteHash)',
]);

/** VoteChoice enum on chain: NONE=0 is never submitted. */
export const VOTE_CHOICE_CODES: Readonly<Record<VoteChoice, 1 | 2 | 3>> = {
  YES: 1,
  NO: 2,
  ABSTAIN: 3,
};

export const MAX_UINT128 = (1n << 128n) - 1n;

export class ActionEncodingError extends Error {
  constructor(message: string) {
    super(`[action-encoding] ${message}`);
    this.name = 'ActionEncodingError';
  }
}

const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/;

export function encodeCastVote(input: { proposalId: bigint; choice: VoteChoice }): Hex {
  if (input.proposalId <= 0n) {
    throw new ActionEncodingError('proposalId must be a positive integer');
  }
  const code = VOTE_CHOICE_CODES[input.choice];
  if (code === undefined) {
    throw new ActionEncodingError(`unsupported vote choice ${String(input.choice)}`);
  }
  return encodeFunctionData({
    abi: CORE_ACTION_ABI,
    functionName: 'castVote',
    args: [input.proposalId, code],
  });
}

export function encodeContribution(input: { projectId: bigint; amount: bigint }): Hex {
  if (input.projectId <= 0n) {
    throw new ActionEncodingError('projectId must be a positive integer');
  }
  if (input.amount <= 0n) {
    throw new ActionEncodingError('amount must be greater than zero');
  }
  if (input.amount > MAX_UINT128) {
    throw new ActionEncodingError('amount exceeds uint128');
  }
  return encodeFunctionData({
    abi: CORE_ACTION_ABI,
    functionName: 'contribute',
    args: [input.projectId, input.amount],
  });
}

export function encodeNote(input: { owner: string; noteHash: string }): Hex {
  const noteHash = input.noteHash.toLowerCase();
  if (!BYTES32_PATTERN.test(noteHash)) {
    throw new ActionEncodingError('noteHash must be a 0x-prefixed 32-byte hash');
  }
  return encodeFunctionData({
    abi: CORE_ACTION_ABI,
    functionName: 'publishNote',
    args: [input.owner.toLowerCase() as `0x${string}`, noteHash as `0x${string}`],
  });
}
