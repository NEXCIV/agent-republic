/**
 * E2-02 reorg detection and finality math. Pure functions only — the caller
 * supplies stored hashes and freshly fetched hashes.
 *
 * Rules (docs/ARCHITECTURE.md §6.1, docs/WORLD_ENGINE.md §6.1):
 * - A block whose stored hash differs from the fresh hash marks a fork; every
 *   event at or above that block must be marked ORPHANED and replayed.
 * - Blocks at or below the finality depth are treated as irreversible. If the
 *   RPC claims a different hash there, the node and our finality assumption
 *   disagree — fail closed and alert instead of silently rewriting history.
 */

export type BlockRef = {
  readonly blockNumber: bigint;
  readonly blockHash: string;
  /** Optional parent hash; persisted for future fork-walk diagnostics. */
  readonly parentHash?: string;
  /** Confirmed block time (ISO8601) — required by WorldFrameV1.source. */
  readonly blockTimestamp?: string;
};

export class ReorgBelowFinalityError extends Error {
  constructor(
    readonly forkBlock: bigint,
    readonly lastFinalizedBlock: bigint,
  ) {
    super(
      `[indexer] reorg at block ${forkBlock} is at or below finalized block ` +
        `${lastFinalizedBlock}; refusing to rewrite finalized history`,
    );
    this.name = 'ReorgBelowFinalityError';
  }
}

function hashKey(value: string): string {
  return value.toLowerCase();
}

/**
 * Lowest block number where `incoming` diverges from `stored`.
 * Returns null when the chains agree (or no overlap exists).
 * Throws ReorgBelowFinalityError when divergence touches finalized history.
 */
export function findForkPoint(
  stored: readonly BlockRef[],
  incoming: readonly BlockRef[],
  lastFinalizedBlock: bigint,
): bigint | null {
  if (stored.length === 0 || incoming.length === 0) return null;

  const storedHashes = new Map<string, string>();
  for (const block of stored) {
    storedHashes.set(block.blockNumber.toString(), hashKey(block.blockHash));
  }

  let fork: bigint | null = null;
  for (const block of incoming) {
    const previous = storedHashes.get(block.blockNumber.toString());
    if (previous !== undefined && previous !== hashKey(block.blockHash)) {
      if (fork === null || block.blockNumber < fork) fork = block.blockNumber;
    }
  }

  if (fork !== null && fork <= lastFinalizedBlock) {
    throw new ReorgBelowFinalityError(fork, lastFinalizedBlock);
  }
  return fork;
}

/** Blocks at or below this height are final for projection purposes. */
export function finalizedBlockFrom(headBlock: bigint, confirmationsRequired: number): bigint {
  if (!Number.isInteger(confirmationsRequired) || confirmationsRequired < 0) {
    throw new RangeError(`confirmationsRequired must be a non-negative integer, got ${confirmationsRequired}`);
  }
  const depth = BigInt(confirmationsRequired);
  return headBlock > depth ? headBlock - depth : 0n;
}

/** An event only counts once its block is finalized. */
export function isConfirmed(blockNumber: bigint, finalizedBlock: bigint): boolean {
  return blockNumber <= finalizedBlock;
}

/**
 * One bounded scan window. Returns null when the cursor is already at head.
 * `toBlock` never exceeds headBlock, so we never ask the RPC for future blocks.
 */
export function nextScanRange(
  nextBlock: bigint,
  headBlock: bigint,
  batchSize: number,
): { fromBlock: bigint; toBlock: bigint } | null {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new RangeError(`batchSize must be a positive integer, got ${batchSize}`);
  }
  if (nextBlock > headBlock) return null;
  const size = BigInt(batchSize);
  const lastOffset = headBlock - nextBlock;
  const toBlock = lastOffset >= size - 1n ? nextBlock + size - 1n : headBlock;
  return { fromBlock: nextBlock, toBlock };
}
