import { evmAddressSchema, type EvmAddress } from '@agent-republic/domain';

/**
 * E2-02 event catalog and normalization.
 *
 * Truth source: docs/SMART_CONTRACTS.md §4.3 / §5.10 and the Solidity
 * declarations in contracts/src/{RepublicRegistry,RepublicCore}.sol.
 *
 * This module is pure: no network, no DB. The worker's indexer feeds it raw
 * logs (from any RPC client) and persists the resulting drafts.
 */

/** Events emitted by our contracts that the indexer must mirror. */
export const INDEXED_EVENT_NAMES = [
  // RepublicRegistry
  'CitizenRegistered',
  'DelegateUpdated',
  'DelegateRevoked',
  'DelegateLocked',
  'DelegateUnlocked',
  // RepublicCore
  'ProjectCreated',
  'ProjectCompleted',
  'ProposalSubmitted',
  'VoteCast',
  'ProposalFinalized',
  'ContributionMade',
  'NotePublished',
  'ReputationUpdated',
] as const;

export type IndexedEventName = (typeof INDEXED_EVENT_NAMES)[number];

const INDEXED_EVENT_SET: ReadonlySet<string> = new Set(INDEXED_EVENT_NAMES);

export function isIndexedEventName(name: string): name is IndexedEventName {
  return INDEXED_EVENT_SET.has(name);
}

/**
 * Which argument names the citizen/owner that the event concerns.
 * Events without a single owner subject (project/proposal-wide) use null;
 * those rows must not be attributed to a citizen address.
 */
const OWNER_ARGUMENT: Readonly<Record<IndexedEventName, string | null>> = {
  CitizenRegistered: 'owner',
  DelegateUpdated: 'owner',
  DelegateRevoked: 'owner',
  DelegateLocked: 'owner',
  DelegateUnlocked: 'owner',
  ProjectCreated: null,
  ProjectCompleted: null,
  ProposalSubmitted: 'owner',
  VoteCast: 'owner',
  ProposalFinalized: null,
  ContributionMade: 'owner',
  NotePublished: 'owner',
  ReputationUpdated: 'owner',
};

export class ChainEventError extends Error {
  constructor(message: string) {
    super(`[chain-event] ${message}`);
    this.name = 'ChainEventError';
  }
}

/** Shape of a decoded log as delivered by an RPC client adapter. */
export type RawChainLog = {
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly address: string;
  readonly eventName: string;
  readonly args: Readonly<Record<string, unknown>>;
  /** RPCs report logs from reorged blocks with removed=true. */
  readonly removed?: boolean;
};

export type ChainEventDraft = {
  readonly chainId: 56 | 97;
  readonly txHash: string;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly eventName: IndexedEventName;
  readonly owner: EvmAddress | null;
  readonly payload: Readonly<Record<string, string | boolean | null>>;
};

const HASH_PATTERN = /^0x[0-9a-f]{64}$/;

function normalizedHash(value: string, field: string): string {
  const lower = value.toLowerCase();
  if (!HASH_PATTERN.test(lower)) {
    throw new ChainEventError(`${field} must be a 0x-prefixed 32-byte hash, got ${value}`);
  }
  return lower;
}

/**
 * JSON-safe argument serialization: uint256 values stay decimal strings so
 * they never lose precision in JS numbers (ARCHITECTURE §6: bigint ids are
 * transported as strings).
 */
function serializeArgument(name: string, value: unknown): string | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString(10);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new ChainEventError(`argument "${name}" must be a safe integer, got ${value}`);
    }
    return value.toString(10);
  }
  if (typeof value === 'string') {
    return value.startsWith('0x') ? value.toLowerCase() : value;
  }
  throw new ChainEventError(`argument "${name}" has unsupported type ${typeof value}`);
}

/** Stable identity of one on-chain log: (chainId, txHash, logIndex). */
export function eventDedupeKey(draft: Pick<ChainEventDraft, 'chainId' | 'txHash' | 'logIndex'>): string {
  return `${draft.chainId}:${draft.txHash}:${draft.logIndex}`;
}

/**
 * Normalize one raw log into a persistable draft.
 * Fails closed on unknown events, malformed hashes or missing owners — a
 * malformed log indicates an ABI/spec mismatch and must not be guessed at.
 */
export function normalizeLog(chainId: 56 | 97, log: RawChainLog): ChainEventDraft {
  if (log.removed === true) {
    throw new ChainEventError('removed logs must be dropped by the caller, not normalized');
  }
  if (!isIndexedEventName(log.eventName)) {
    throw new ChainEventError(`unknown event "${log.eventName}" — not part of the indexed set`);
  }
  if (!Number.isInteger(log.logIndex) || log.logIndex < 0) {
    throw new ChainEventError(`invalid logIndex ${log.logIndex}`);
  }
  if (log.blockNumber < 0n) {
    throw new ChainEventError(`invalid blockNumber ${log.blockNumber}`);
  }
  evmAddressSchema.parse(log.address);

  const ownerArg = OWNER_ARGUMENT[log.eventName];
  let owner: EvmAddress | null = null;
  if (ownerArg !== null) {
    const rawOwner = log.args[ownerArg];
    if (rawOwner === undefined || rawOwner === null) {
      throw new ChainEventError(`event "${log.eventName}" is missing the "${ownerArg}" argument`);
    }
    owner = evmAddressSchema.parse(rawOwner);
  }

  const payload: Record<string, string | boolean | null> = {};
  for (const [name, value] of Object.entries(log.args)) {
    payload[name] = serializeArgument(name, value);
  }

  return {
    chainId,
    txHash: normalizedHash(log.transactionHash, 'txHash'),
    logIndex: log.logIndex,
    blockNumber: log.blockNumber,
    blockHash: normalizedHash(log.blockHash, 'blockHash'),
    eventName: log.eventName,
    owner,
    payload,
  };
}

/**
 * Normalize a batch: drops removed logs (they belong to a discarded fork),
 * rejects unknown events, de-duplicates by (txHash, logIndex) and returns
 * chain order (blockNumber, logIndex).
 */
export function normalizeLogs(chainId: 56 | 97, logs: readonly RawChainLog[]): ChainEventDraft[] {
  const seen = new Set<string>();
  const drafts: ChainEventDraft[] = [];
  for (const log of logs) {
    if (log.removed === true) continue;
    const draft = normalizeLog(chainId, log);
    const key = eventDedupeKey(draft);
    if (seen.has(key)) continue;
    seen.add(key);
    drafts.push(draft);
  }
  return drafts.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );
}
