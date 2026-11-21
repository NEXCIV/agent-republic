import { randomBytes } from 'node:crypto';
import { computeBindingCommitment, encodeRegisterCitizen, hashChallengeNonce } from '@agent-republic/chain';
import { ApiError } from '../errors.js';

/**
 * E2-04 Web2 ⇄ owner binding.
 *
 * Security rules (docs/ARCHITECTURE.md §5.1):
 * - The API generates the nonce + commitment; only the nonce HASH is stored.
 * - Binding requires a FINALIZED CitizenRegistered event whose commitment
 *   matches the stored challenge exactly — an address string, an unconfirmed
 *   tx or a self-reported txHash never grants binding.
 * - Challenges are single-use and expire after 15 minutes.
 * - One owner maps to one active Web2 account and vice versa.
 */

export const CHALLENGE_TTL_SECONDS = 15 * 60;

export type ChallengeResponse = {
  readonly challengeId: string;
  readonly commitment: string;
  readonly nonce: string;
  readonly expiresAt: string;
  readonly calldata: {
    readonly chainId: 56 | 97;
    readonly to: string;
    readonly data: string;
    readonly value: '0';
  };
  readonly humanReadable: string;
};

export type VerifyResult =
  | {
      readonly bindingState: 'BOUND';
      readonly owner: string;
      readonly appUserId: string;
      readonly registryTxHash: string;
    }
  | {
      readonly bindingState: 'PENDING_CONFIRMATION';
      readonly owner: string;
      readonly txHash: string;
    };

export type CreateChallengeInput = {
  readonly appUserId: string;
  readonly owner: string;
  readonly agentConfigHash: string;
};

export type VerifyBindingInput = {
  readonly appUserId: string;
  readonly owner: string;
  readonly txHash: string;
  readonly challengeId: string;
};

export type CommitOutcome =
  | { readonly status: 'BOUND'; readonly registryTxHash: string }
  | { readonly status: 'CHALLENGE_NOT_FOUND' }
  | { readonly status: 'CHALLENGE_USED' }
  | { readonly status: 'CHALLENGE_EXPIRED' }
  | { readonly status: 'OWNER_MISMATCH' }
  | { readonly status: 'TX_MISMATCH' }
  | { readonly status: 'EVENT_NOT_FOUND' }
  | { readonly status: 'EVENT_PENDING' }
  | { readonly status: 'OWNER_ALREADY_BOUND' }
  | { readonly status: 'APP_USER_ALREADY_BOUND' };

export interface BindingRepository {
  createChallenge(input: {
    appUserId: string;
    owner: string;
    agentConfigHash: string;
    nonceHash: string;
    commitment: string;
    expiresAt: Date;
  }): Promise<{ id: string }>;

  /**
   * Single transaction: lock challenge → validate → match the finalized
   * registry event → mark used → insert binding. Any failure rolls back so a
   * challenge is not burned by an unsuccessful attempt.
   */
  commitBinding(input: {
    challengeId: string;
    chainId: 56 | 97;
    appUserId: string;
    owner: string;
    txHash: string;
    now: Date;
  }): Promise<CommitOutcome>;
}

export interface BindingPort {
  createChallenge(input: CreateChallengeInput): Promise<ChallengeResponse>;
  verify(input: VerifyBindingInput): Promise<VerifyResult>;
}

export type BindingServiceDeps = {
  readonly repo: BindingRepository;
  readonly chainId: 56 | 97;
  readonly registryAddress: string | undefined;
  readonly now?: () => Date;
  readonly generateNonce?: () => string;
  readonly challengeTtlSeconds?: number;
};

const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/;

export class BindingService implements BindingPort {
  private readonly repo: BindingRepository;
  private readonly chainId: 56 | 97;
  private readonly registryAddress: string | undefined;
  private readonly now: () => Date;
  private readonly generateNonce: () => string;
  private readonly ttlSeconds: number;

  constructor(deps: BindingServiceDeps) {
    this.repo = deps.repo;
    this.chainId = deps.chainId;
    this.registryAddress = deps.registryAddress;
    this.now = deps.now ?? (() => new Date());
    this.generateNonce = deps.generateNonce ?? (() => `0x${randomBytes(32).toString('hex')}`);
    this.ttlSeconds = deps.challengeTtlSeconds ?? CHALLENGE_TTL_SECONDS;
  }

  async createChallenge(input: CreateChallengeInput): Promise<ChallengeResponse> {
    if (this.registryAddress === undefined) {
      throw new ApiError(
        503,
        'NOT_CONFIGURED',
        'REGISTRY_ADDRESS is not configured; a binding commitment cannot target a contract',
      );
    }
    const agentConfigHash = input.agentConfigHash.toLowerCase();
    if (!BYTES32_PATTERN.test(agentConfigHash)) {
      throw new ApiError(400, 'INVALID_BODY', 'agentConfigHash must be a 0x-prefixed 32-byte hash');
    }

    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + this.ttlSeconds * 1000);
    const expiresAtSeconds = BigInt(Math.floor(expiresAt.getTime() / 1000));
    const nonce = this.generateNonce();

    const commitment = computeBindingCommitment({
      appUserId: input.appUserId,
      owner: input.owner,
      nonce,
      agentConfigHash,
      expiresAt: expiresAtSeconds,
    });

    const { id } = await this.repo.createChallenge({
      appUserId: input.appUserId,
      owner: input.owner,
      agentConfigHash,
      nonceHash: hashChallengeNonce(nonce),
      commitment,
      expiresAt,
    });

    return {
      challengeId: id,
      commitment,
      nonce,
      expiresAt: expiresAt.toISOString(),
      calldata: {
        chainId: this.chainId,
        to: this.registryAddress,
        data: encodeRegisterCitizen(commitment),
        value: '0',
      },
      humanReadable:
        'Call registerCitizen(commitment) on RepublicRegistry from the wallet that holds the Agent ID. ' +
        'The transaction is signed by your wallet; this API never signs or submits it.',
    };
  }

  async verify(input: VerifyBindingInput): Promise<VerifyResult> {
    const outcome = await this.repo.commitBinding({
      challengeId: input.challengeId,
      chainId: this.chainId,
      appUserId: input.appUserId,
      owner: input.owner,
      txHash: input.txHash,
      now: this.now(),
    });

    switch (outcome.status) {
      case 'BOUND':
        return {
          bindingState: 'BOUND',
          owner: input.owner,
          appUserId: input.appUserId,
          registryTxHash: outcome.registryTxHash,
        };
      case 'EVENT_PENDING':
        return { bindingState: 'PENDING_CONFIRMATION', owner: input.owner, txHash: input.txHash };
      case 'CHALLENGE_NOT_FOUND':
        throw new ApiError(404, 'NOT_FOUND', 'binding challenge not found');
      case 'CHALLENGE_USED':
        throw new ApiError(409, 'CHALLENGE_USED', 'binding challenge was already consumed');
      case 'CHALLENGE_EXPIRED':
        throw new ApiError(409, 'CHALLENGE_EXPIRED', 'binding challenge has expired; request a new one');
      case 'OWNER_MISMATCH':
        throw new ApiError(409, 'OWNER_MISMATCH', 'challenge, event owner and requesting account do not match');
      case 'TX_MISMATCH':
        throw new ApiError(400, 'TX_MISMATCH', 'txHash does not match the confirmed registration event');
      case 'EVENT_NOT_FOUND':
        throw new ApiError(404, 'EVENT_NOT_FOUND', 'no confirmed CitizenRegistered event for this commitment');
      case 'OWNER_ALREADY_BOUND':
        throw new ApiError(409, 'OWNER_ALREADY_BOUND', 'this owner is already bound to another account');
      case 'APP_USER_ALREADY_BOUND':
        throw new ApiError(409, 'APP_USER_ALREADY_BOUND', 'this account is already bound to another owner');
    }
  }
}
