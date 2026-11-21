import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  toBytes,
  type Address,
  type Hex,
} from 'viem';

/**
 * E2-04 binding commitment (docs/ARCHITECTURE.md §5.1).
 *
 * commitment = keccak256(abi.encode(
 *   keccak256(utf8(appUserId)),
 *   owner,
 *   nonce,
 *   personaConfigHash,
 *   expiry,
 * ))
 *
 * The order and types are fixed here and must never drift: the API persists
 * the commitment it generated, and verification compares it byte-for-byte
 * with the `CitizenRegistered` event emitted by the contract.
 */

const COMMITMENT_PARAMETERS = [
  { name: 'appUserIdHash', type: 'bytes32' },
  { name: 'owner', type: 'address' },
  { name: 'nonce', type: 'bytes32' },
  { name: 'agentConfigHash', type: 'bytes32' },
  { name: 'expiresAt', type: 'uint64' },
] as const;

/** Registry entry point that consumes a commitment. */
export const REGISTRY_BINDING_ABI = parseAbi([
  'function registerCitizen(bytes32 commitment)',
]);

const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/;

export class BindingCommitmentError extends Error {
  constructor(message: string) {
    super(`[binding-commitment] ${message}`);
    this.name = 'BindingCommitmentError';
  }
}

function assertBytes32(value: string, field: string): Hex {
  const lower = value.toLowerCase();
  if (!BYTES32_PATTERN.test(lower)) {
    throw new BindingCommitmentError(`${field} must be a 0x-prefixed 32-byte hex value`);
  }
  return lower as Hex;
}

export function hashAppUserId(appUserId: string): Hex {
  if (appUserId.trim() === '') {
    throw new BindingCommitmentError('appUserId must not be empty');
  }
  return keccak256(toBytes(appUserId));
}

/** Stored nonce hash — the raw nonce is never persisted. */
export function hashChallengeNonce(nonce: string): Hex {
  return keccak256(assertBytes32(nonce, 'nonce'));
}

export type BindingCommitmentInput = {
  readonly appUserId: string;
  readonly owner: string;
  /** 32 random bytes generated server-side per challenge. */
  readonly nonce: string;
  readonly agentConfigHash: string;
  /** Unix seconds; the same value is stored as the challenge expiry. */
  readonly expiresAt: bigint;
};

export function computeBindingCommitment(input: BindingCommitmentInput): Hex {
  if (input.expiresAt <= 0n) {
    throw new BindingCommitmentError('expiresAt must be a positive unix timestamp');
  }
  return keccak256(
    encodeAbiParameters(COMMITMENT_PARAMETERS, [
      hashAppUserId(input.appUserId),
      input.owner.toLowerCase() as Address,
      assertBytes32(input.nonce, 'nonce'),
      assertBytes32(input.agentConfigHash, 'agentConfigHash'),
      input.expiresAt,
    ]),
  );
}

/** Calldata for the owner's wallet: registerCitizen(commitment), value=0. */
export function encodeRegisterCitizen(commitment: string): Hex {
  return encodeFunctionData({
    abi: REGISTRY_BINDING_ABI,
    functionName: 'registerCitizen',
    args: [assertBytes32(commitment, 'commitment')],
  });
}
