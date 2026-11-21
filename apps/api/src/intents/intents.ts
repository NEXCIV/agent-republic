import {
  encodeCastVote,
  encodeContribution,
  encodeNote,
  type ChainReadPort,
  type TransactionReceipt,
} from '@agent-republic/chain';
import { INTENTS, VOTE_CHOICES, type Intent, type VoteChoice } from '@agent-republic/domain';
import { ApiError } from '../errors.js';

/**
 * E2-05 action intents.
 *
 * The API never signs or sends a transaction: `prepare` only encodes
 * `{chainId, to, data, value: 0}`, and `report-submission` records a
 * user-declared txHash as PENDING (docs/ARCHITECTURE.md §7.2–§7.3).
 * A tx only becomes CONFIRMED through indexed, finalized chain_events.
 */

export type IntentStatus =
  | 'PROPOSED'
  | 'APPROVED'
  | 'PREPARED'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED'
  | 'EXPIRED'
  | 'REJECTED';

export type IntentRow = {
  readonly id: string;
  readonly owner: string;
  readonly actionType: Intent;
  readonly targetId: string | null;
  readonly parameters: Record<string, unknown>;
  readonly status: IntentStatus;
  readonly txHash: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type PreparedIntent = {
  readonly intentId: string;
  readonly status: 'PREPARED';
  readonly chainId: 56 | 97;
  readonly to: string;
  readonly data: string;
  readonly value: '0';
  readonly humanReadable: string;
};

export type TxStatus = 'UNKNOWN' | 'PENDING' | 'INCLUDED' | 'CONFIRMED' | 'FAILED';

export type TxStatusResult = {
  readonly txHash: string;
  readonly status: TxStatus;
  /** Where the answer came from — never presented as more than it is. */
  readonly source: 'CHAIN_EVENTS' | 'RPC_RECEIPT' | 'INTENT' | 'NONE';
  readonly events: readonly { eventName: string; blockNumber: string; confirmed: boolean }[];
  readonly receiptChecked: boolean;
  readonly receiptBlockNumber: string | null;
  readonly note?: string;
};

type CreateIntentResult =
  | { readonly kind: 'CREATED'; readonly row: IntentRow }
  | { readonly kind: 'EXISTING'; readonly row: IntentRow }
  | { readonly kind: 'IDEMPOTENCY_CONFLICT' };

export interface IntentRepository {
  resolveOwner(appUserId: string): Promise<string | null>;
  createIntent(input: {
    owner: string;
    actionType: Intent;
    targetId: string | null;
    parameters: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<CreateIntentResult>;
  findIntent(id: string, owner: string): Promise<IntentRow | null>;
  markPrepared(id: string, owner: string): Promise<IntentRow | null>;
  reportSubmission(
    id: string,
    owner: string,
    txHash: string,
  ): Promise<{ kind: 'UPDATED'; row: IntentRow } | { kind: 'NOT_FOUND' } | { kind: 'STATE_CONFLICT' } | { kind: 'TX_CONFLICT' }>;
  findEventsByTx(
    chainId: 56 | 97,
    txHash: string,
  ): Promise<
    readonly {
      eventName: string;
      blockNumber: bigint;
      status: 'INCLUDED' | 'ORPHANED';
      confirmedAtBlock: bigint | null;
    }[]
  >;
  findIntentByTx(txHash: string): Promise<IntentRow | null>;
  getFinalizedBlock(chainId: 56 | 97): Promise<bigint | null>;
}

export type IntentServiceDeps = {
  readonly repo: IntentRepository;
  readonly chainId: 56 | 97;
  readonly coreAddress: string | undefined;
  readonly chain: ChainReadPort | null;
};

const UINT_PATTERN = /^\d{1,78}$/;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** Which intents map to a real contract call. */
const PREPARABLE: ReadonlySet<Intent> = new Set<Intent>([
  'SUGGEST_VOTE',
  'SUGGEST_CONTRIBUTION',
  'PUBLISH_NOTE_REQUEST',
]);

export function isIntent(value: string): value is Intent {
  return (INTENTS as readonly string[]).includes(value);
}

function parseUint(value: unknown, field: string): bigint {
  if (typeof value === 'string' && UINT_PATTERN.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return BigInt(value);
  throw new ApiError(400, 'INVALID_BODY', `${field} must be a positive decimal integer`);
}

function parseChoice(value: unknown): VoteChoice {
  if (typeof value === 'string' && (VOTE_CHOICES as readonly string[]).includes(value)) {
    return value as VoteChoice;
  }
  throw new ApiError(400, 'INVALID_BODY', `choice must be one of: ${VOTE_CHOICES.join(', ')}`);
}

export class IntentService {
  private readonly repo: IntentRepository;
  private readonly chainId: 56 | 97;
  private readonly coreAddress: string | undefined;
  private readonly chain: ChainReadPort | null;

  constructor(deps: IntentServiceDeps) {
    this.repo = deps.repo;
    this.chainId = deps.chainId;
    this.coreAddress = deps.coreAddress;
    this.chain = deps.chain;
  }

  validateIdempotencyKey(value: string): string {
    if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
      throw new ApiError(
        400,
        'INVALID_BODY',
        'Idempotency-Key header must be 8-128 characters of [A-Za-z0-9._:-]',
      );
    }
    return value;
  }

  validateTxHash(value: string): string {
    const txHash = value.toLowerCase();
    if (!HASH_PATTERN.test(txHash)) {
      throw new ApiError(400, 'INVALID_BODY', 'txHash must be a 0x-prefixed 32-byte hash');
    }
    return txHash;
  }

  private async requireOwner(appUserId: string): Promise<string> {
    const owner = await this.repo.resolveOwner(appUserId);
    if (owner === null) {
      throw new ApiError(
        403,
        'OWNER_NOT_BOUND',
        'no verified owner is bound to this account; complete binding first',
      );
    }
    return owner;
  }

  async create(input: {
    appUserId: string;
    actionType: string;
    targetId: string | null;
    parameters: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<{ intent: IntentRow; created: boolean }> {
    if (!isIntent(input.actionType)) {
      throw new ApiError(400, 'INVALID_BODY', `actionType must be one of: ${INTENTS.join(', ')}`);
    }
    const owner = await this.requireOwner(input.appUserId);

    const result = await this.repo.createIntent({
      owner,
      actionType: input.actionType,
      targetId: input.targetId,
      parameters: input.parameters,
      idempotencyKey: input.idempotencyKey,
    });

    switch (result.kind) {
      case 'CREATED':
        return { intent: result.row, created: true };
      case 'EXISTING':
        return { intent: result.row, created: false };
      case 'IDEMPOTENCY_CONFLICT':
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'this Idempotency-Key was already used for a different intent',
        );
    }
  }

  async prepare(input: { appUserId: string; intentId: string }): Promise<PreparedIntent> {
    const owner = await this.requireOwner(input.appUserId);
    const intent = await this.repo.findIntent(input.intentId, owner);
    if (intent === null) {
      throw new ApiError(404, 'NOT_FOUND', `intent ${input.intentId} not found`);
    }
    if (intent.status !== 'PROPOSED' && intent.status !== 'PREPARED') {
      throw new ApiError(
        409,
        'INTENT_STATE_CONFLICT',
        `intent is ${intent.status}; only PROPOSED intents can be prepared`,
      );
    }
    if (!PREPARABLE.has(intent.actionType)) {
      throw new ApiError(
        409,
        'NOT_PREPARABLE',
        `${intent.actionType} has no on-chain call; it is an off-chain note only`,
      );
    }
    if (this.coreAddress === undefined) {
      throw new ApiError(503, 'NOT_CONFIGURED', 'CORE_ADDRESS is not configured; cannot encode calldata');
    }

    const { data, humanReadable } = this.encode(intent);
    const updated = await this.repo.markPrepared(intent.id, owner);
    if (updated === null) {
      throw new ApiError(409, 'INTENT_STATE_CONFLICT', 'intent state changed; reload and retry');
    }

    return {
      intentId: intent.id,
      status: 'PREPARED',
      chainId: this.chainId,
      to: this.coreAddress,
      data,
      value: '0',
      humanReadable,
    };
  }

  private encode(intent: IntentRow): { data: string; humanReadable: string } {
    const params = intent.parameters;
    try {
      if (intent.actionType === 'SUGGEST_VOTE') {
        return {
          data: encodeCastVote({
            proposalId: parseUint(params.proposalId, 'proposalId'),
            choice: parseChoice(params.choice),
          }),
          humanReadable: 'Cast one vote for this proposal from your Agent ID wallet.',
        };
      }
      if (intent.actionType === 'SUGGEST_CONTRIBUTION') {
        return {
          data: encodeContribution({
            projectId: parseUint(params.projectId, 'projectId'),
            amount: parseUint(params.amount, 'amount'),
          }),
          humanReadable: 'Spend BUILD from your balance toward this project.',
        };
      }
      if (intent.actionType === 'PUBLISH_NOTE_REQUEST') {
        if (typeof params.noteHash !== 'string') {
          throw new ApiError(400, 'INVALID_BODY', 'noteHash is required');
        }
        return {
          data: encodeNote({ owner: intent.owner, noteHash: params.noteHash }),
          humanReadable: 'Publish a note hash on chain (NOTE scope, no economic effect).',
        };
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, 'INVALID_BODY', error instanceof Error ? error.message : 'invalid parameters');
    }
    throw new ApiError(409, 'NOT_PREPARABLE', `${intent.actionType} has no on-chain call`);
  }

  async reportSubmission(input: {
    appUserId: string;
    intentId: string;
    txHash: string;
  }): Promise<{ intentId: string; status: 'PENDING'; txHash: string }> {
    const owner = await this.requireOwner(input.appUserId);
    const txHash = this.validateTxHash(input.txHash);
    const result = await this.repo.reportSubmission(input.intentId, owner, txHash);

    switch (result.kind) {
      case 'UPDATED':
        return { intentId: result.row.id, status: 'PENDING', txHash };
      case 'NOT_FOUND':
        throw new ApiError(404, 'NOT_FOUND', `intent ${input.intentId} not found`);
      case 'STATE_CONFLICT':
        throw new ApiError(
          409,
          'INTENT_STATE_CONFLICT',
          'intent must be PREPARED before a submission can be reported',
        );
      case 'TX_CONFLICT':
        throw new ApiError(409, 'INTENT_STATE_CONFLICT', 'intent already reports a different txHash');
    }
  }

  /**
   * Receipt/status view. Never upgrades a self-reported txHash to CONFIRMED:
   * only finalized indexed events (or a successful receipt corroborated by
   * the projection) do that.
   */
  async txStatus(txHashRaw: string): Promise<TxStatusResult> {
    const txHash = this.validateTxHash(txHashRaw);
    const [events, intent, finalizedBlock] = await Promise.all([
      this.repo.findEventsByTx(this.chainId, txHash),
      this.repo.findIntentByTx(txHash),
      this.repo.getFinalizedBlock(this.chainId),
    ]);

    let receipt: TransactionReceipt | null = null;
    let receiptChecked = false;
    let receiptUnavailable = false;
    if (events.length === 0 && this.chain !== null) {
      try {
        receipt = await this.chain.readTransactionReceipt(txHash);
        receiptChecked = true;
      } catch {
        receiptUnavailable = true;
      }
    }

    if (events.length === 0) {
      if (receipt !== null && receipt.status === 'REVERTED') {
        return {
          txHash,
          status: 'FAILED',
          source: 'RPC_RECEIPT',
          events: [],
          receiptChecked: true,
          receiptBlockNumber: receipt.blockNumber.toString(),
          note: 'the transaction reverted on chain and emitted no indexed event',
        };
      }
      if (receipt !== null) {
        return {
          txHash,
          status: 'INCLUDED',
          source: 'RPC_RECEIPT',
          events: [],
          receiptChecked: true,
          receiptBlockNumber: receipt.blockNumber.toString(),
          note: 'receipt found but the event has not been indexed yet',
        };
      }
      if (intent !== null) {
        return {
          txHash,
          status: 'PENDING',
          source: 'INTENT',
          events: [],
          receiptChecked,
          receiptBlockNumber: null,
          note: receiptUnavailable
            ? 'no receipt yet (RPC unavailable); PENDING is not confirmation'
            : 'reported by the user; no receipt yet. PENDING is not confirmation',
        };
      }
      return {
        txHash,
        status: 'UNKNOWN',
        source: 'NONE',
        events: [],
        receiptChecked,
        receiptBlockNumber: null,
      };
    }

    const active = events.filter((event) => event.status === 'INCLUDED');
    const summarized = events.map((event) => ({
      eventName: event.eventName,
      blockNumber: event.blockNumber.toString(),
      confirmed: event.confirmedAtBlock !== null,
    }));

    if (active.length === 0) {
      return {
        txHash,
        status: 'PENDING',
        source: 'CHAIN_EVENTS',
        events: summarized,
        receiptChecked,
        receiptBlockNumber: null,
        note: 'events were orphaned by a reorg; waiting for re-indexing',
      };
    }

    const allConfirmed = active.every(
      (event) =>
        event.confirmedAtBlock !== null &&
        (finalizedBlock === null || event.blockNumber <= finalizedBlock),
    );

    return {
      txHash,
      status: allConfirmed ? 'CONFIRMED' : 'INCLUDED',
      source: 'CHAIN_EVENTS',
      events: summarized,
      receiptChecked,
      receiptBlockNumber: null,
    };
  }
}
