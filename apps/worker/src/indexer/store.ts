import { Pool, type PoolClient } from 'pg';
import type { ChainEventDraft, IndexedEventName } from '@agent-republic/chain';
import {
  finalizedBlockFrom,
  findForkPoint,
  type BlockRef,
} from './reorg.js';

/**
 * E2-02 Postgres persistence for the chain event mirror.
 *
 * chain_events is a REBUILDABLE mirror of contract logs; it never authorizes
 * anything by itself (docs/ARCHITECTURE.md §6.1). Confirmed status is derived
 * from block height vs the finality cursor, so pending transactions can never
 * be counted by projections.
 */

export type ApplyBatchInput = {
  readonly chainId: 56 | 97;
  /** Contract whose cursor row this batch belongs to (registry/core address). */
  readonly contract: string;
  /** Every block hash covered by this scan window, ascending. */
  readonly blocks: readonly BlockRef[];
  /** Normalized events from those blocks. */
  readonly events: readonly ChainEventDraft[];
  /** Latest known chain head used to compute finality. */
  readonly headBlock: bigint;
  /** docs/ARCHITECTURE.md §6.1: CONFIRMATIONS_REQUIRED, default 12. */
  readonly confirmationsRequired: number;
  /** Cursor value when no reorg happens; defaults to max(block)+1. */
  readonly nextBlock?: bigint;
};

export type ApplyBatchResult = {
  readonly eventsWritten: number;
  readonly confirmedEvents: number;
  readonly reorg: { readonly fromBlock: bigint; readonly orphanedEvents: number } | null;
  readonly nextBlock: bigint;
  readonly finalizedBlock: bigint;
};

export type StoredChainEvent = {
  readonly txHash: string;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly eventName: IndexedEventName;
  readonly owner: string | null;
  readonly payload: Record<string, string | boolean | null>;
  readonly confirmedAtBlock: bigint;
};

export type EventFilter = {
  readonly fromBlock?: bigint;
  readonly toBlock?: bigint;
  readonly owner?: string;
  readonly eventName?: IndexedEventName;
  readonly limit?: number;
};

const EVENT_INSERT_CHUNK = 200;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toBlockNumber(value: string | number): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

export class ChainIndexerStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    if (connectionString.trim() === '') {
      throw new Error('[indexer] DATABASE_URL is required; refusing to start without a database');
    }
    this.pool = new Pool({ connectionString, max: 4 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Apply one scan window atomically:
   *   1. detect a fork by comparing stored vs incoming block hashes,
   *   2. orphan events at/above the fork and drop their block hashes,
   *   3. upsert block hashes and events (idempotent replay),
   *   4. mark finalized events as confirmed,
   *   5. persist the cursor (rewound to the fork on reorg).
   */
  async applyBatch(input: ApplyBatchInput): Promise<ApplyBatchResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const blocks = [...input.blocks].sort((a, b) =>
        a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? -1 : 1,
      );
      const finalizedBlock = finalizedBlockFrom(input.headBlock, input.confirmationsRequired);
      const reorg = await this.rollbackFork(client, input.chainId, blocks, finalizedBlock);

      await this.upsertBlocks(client, input.chainId, blocks);
      const eventsWritten = await this.upsertEvents(client, input.events);

      const confirmed = await client.query(
        `UPDATE chain_events
            SET confirmed_at_block = $2
          WHERE chain_id = $1
            AND status = 'INCLUDED'
            AND confirmed_at_block IS NULL
            AND block_number <= $2`,
        [input.chainId, finalizedBlock.toString()],
      );
      // docs/AGENT_ENGINE.md §10: only the indexer advances intent status.
      // Confirmed events upgrade a SUBMITTED intent; a reorg that orphans the
      // supporting event reverts it instead of leaving a false success.
      await this.reconcileActionIntents(client, input.chainId);

      const lastScanned = blocks.at(-1)?.blockNumber;
      const nextBlock =
        reorg?.fromBlock ??
        input.nextBlock ??
        (lastScanned !== undefined ? lastScanned + 1n : 0n);

      await client.query(
        `INSERT INTO chain_sync_cursors (chain_id, contract, next_block, finalized_block)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (chain_id, contract) DO UPDATE
           SET next_block = EXCLUDED.next_block,
               finalized_block = GREATEST(chain_sync_cursors.finalized_block, EXCLUDED.finalized_block),
               updated_at = now()`,
        [input.chainId, input.contract.toLowerCase(), nextBlock.toString(), finalizedBlock.toString()],
      );

      await client.query('COMMIT');
      return {
        eventsWritten,
        confirmedEvents: confirmed.rowCount ?? 0,
        reorg,
        nextBlock,
        finalizedBlock,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async rollbackFork(
    client: PoolClient,
    chainId: 56 | 97,
    blocks: readonly BlockRef[],
    finalizedBlock: bigint,
  ): Promise<{ fromBlock: bigint; orphanedEvents: number } | null> {
    if (blocks.length === 0) return null;
    const fromBlock = blocks[0]!.blockNumber;
    const toBlock = blocks.at(-1)!.blockNumber;

    const stored = await client.query<{ block_number: string; block_hash: string }>(
      `SELECT block_number, block_hash
         FROM chain_block_hashes
        WHERE chain_id = $1 AND block_number BETWEEN $2 AND $3
        ORDER BY block_number`,
      [chainId, fromBlock.toString(), toBlock.toString()],
    );

    const fork = findForkPoint(
      stored.rows.map((row) => ({
        blockNumber: toBlockNumber(row.block_number),
        blockHash: row.block_hash,
      })),
      blocks,
      finalizedBlock,
    );
    if (fork === null) return null;

    const orphaned = await client.query(
      `UPDATE chain_events
          SET status = 'ORPHANED', orphaned_at = now()
        WHERE chain_id = $1 AND status = 'INCLUDED' AND block_number >= $2`,
      [chainId, fork.toString()],
    );
    await client.query('DELETE FROM chain_block_hashes WHERE chain_id = $1 AND block_number >= $2', [
      chainId,
      fork.toString(),
    ]);

    return { fromBlock: fork, orphanedEvents: orphaned.rowCount ?? 0 };
  }

  private async upsertBlocks(
    client: PoolClient,
    chainId: 56 | 97,
    blocks: readonly BlockRef[],
  ): Promise<void> {
    if (blocks.length === 0) return;
    for (const batch of chunk(blocks, EVENT_INSERT_CHUNK)) {
      const values: string[] = [];
      const params: unknown[] = [];
      batch.forEach((block, index) => {
        const base = index * 5;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
        params.push(
          chainId,
          block.blockNumber.toString(),
          block.blockHash.toLowerCase(),
          block.parentHash?.toLowerCase() ?? '0x' + '0'.repeat(64),
          block.blockTimestamp ?? null,
        );
      });
      await client.query(
        `INSERT INTO chain_block_hashes (chain_id, block_number, block_hash, parent_hash, block_timestamp)
         VALUES ${values.join(', ')}
         ON CONFLICT (chain_id, block_number) DO UPDATE
           SET block_hash = EXCLUDED.block_hash,
               parent_hash = EXCLUDED.parent_hash,
               block_timestamp = COALESCE(EXCLUDED.block_timestamp, chain_block_hashes.block_timestamp),
               indexed_at = now()`,
        params,
      );
    }
  }

  private async upsertEvents(
    client: PoolClient,
    events: readonly ChainEventDraft[],
  ): Promise<number> {
    if (events.length === 0) return 0;
    let written = 0;
    for (const batch of chunk(events, EVENT_INSERT_CHUNK)) {
      const values: string[] = [];
      const params: unknown[] = [];
      batch.forEach((event, index) => {
        const base = index * 8;
        values.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
            `$${base + 6}, $${base + 7}, $${base + 8})`,
        );
        params.push(
          event.chainId,
          event.txHash,
          event.logIndex,
          event.blockNumber.toString(),
          event.blockHash,
          event.eventName,
          event.owner,
          JSON.stringify(event.payload),
        );
      });
      const result = await client.query(
        `INSERT INTO chain_events
           (chain_id, tx_hash, log_index, block_number, block_hash, event_name, owner, payload)
         VALUES ${values.join(', ')}
         ON CONFLICT (chain_id, tx_hash, log_index) DO UPDATE
           SET block_number = EXCLUDED.block_number,
               block_hash = EXCLUDED.block_hash,
               event_name = EXCLUDED.event_name,
               owner = EXCLUDED.owner,
               payload = EXCLUDED.payload,
               status = 'INCLUDED',
               orphaned_at = NULL,
               -- An event replayed at a new height must be re-finalized in
               -- this transaction; keeping the old height can violate the
               -- finality CHECK when the new block is higher.
               confirmed_at_block = NULL`,
        params,
      );
      written += result.rowCount ?? 0;
    }
    return written;
  }

  /**
   * Reconciles `action_intents` with finalized chain events.
   *
   * Matching is deliberately strict: owner, action type, target and the
   * economic parameter must all match an INCLUDED event that reached finality.
   * A self-reported tx hash alone is never enough.
   */
  private async reconcileActionIntents(
    client: PoolClient,
    chainId: 56 | 97,
  ): Promise<void> {
    const matchesEvent = `
      ce.chain_id = $1
      AND ce.tx_hash = ai.tx_hash
      AND ce.status = 'INCLUDED'
      AND ce.confirmed_at_block IS NOT NULL
      AND ce.owner = ai.owner
      AND CASE ai.action_type
            WHEN 'SUGGEST_CONTRIBUTION' THEN ce.event_name = 'ContributionMade'
              AND ce.payload->>'projectId' = ai.target_id
              AND ce.payload->>'amount' = ai.json_payload->>'amount'
            WHEN 'SUGGEST_VOTE' THEN ce.event_name = 'VoteCast'
              AND ce.payload->>'proposalId' = ai.target_id
            WHEN 'PUBLISH_NOTE_REQUEST' THEN ce.event_name = 'NotePublished'
              AND ce.payload->>'noteHash' = ai.json_payload->>'noteHash'
            ELSE FALSE
          END`;

    await client.query(
      `UPDATE action_intents AS ai
          SET status = 'CONFIRMED', updated_at = now()
        WHERE ai.status = 'SUBMITTED'
          AND ai.tx_hash IS NOT NULL
          AND EXISTS (SELECT 1 FROM chain_events AS ce WHERE ${matchesEvent})`,
      [chainId],
    );

    await client.query(
      `UPDATE action_intents AS ai
          SET status = 'SUBMITTED', updated_at = now()
        WHERE ai.status = 'CONFIRMED'
          AND ai.tx_hash IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM chain_events AS ce WHERE ${matchesEvent})`,
      [chainId],
    );
  }

  /**
   * Projection read path: ONLY confirmed, non-orphaned events. Pending
   * (included but not yet final) rows are intentionally invisible here.
   */
  async listConfirmedEvents(chainId: 56 | 97, filter: EventFilter = {}): Promise<StoredChainEvent[]> {
    const where: string[] = [
      'chain_id = $1',
      "status = 'INCLUDED'",
      'confirmed_at_block IS NOT NULL',
    ];
    const params: unknown[] = [chainId];

    if (filter.fromBlock !== undefined) {
      params.push(filter.fromBlock.toString());
      where.push(`block_number >= $${params.length}`);
    }
    if (filter.toBlock !== undefined) {
      params.push(filter.toBlock.toString());
      where.push(`block_number <= $${params.length}`);
    }
    if (filter.owner !== undefined) {
      params.push(filter.owner.toLowerCase());
      where.push(`owner = $${params.length}`);
    }
    if (filter.eventName !== undefined) {
      params.push(filter.eventName);
      where.push(`event_name = $${params.length}`);
    }

    const limit = filter.limit ?? 1000;
    params.push(limit);

    const result = await this.pool.query<{
      tx_hash: string;
      log_index: number;
      block_number: string;
      block_hash: string;
      event_name: IndexedEventName;
      owner: string | null;
      payload: Record<string, string | boolean | null>;
      confirmed_at_block: string;
    }>(
      `SELECT tx_hash, log_index, block_number, block_hash, event_name, owner, payload, confirmed_at_block
         FROM chain_events
        WHERE ${where.join(' AND ')}
        ORDER BY block_number, log_index
        LIMIT $${params.length}`,
      params,
    );

    return result.rows.map((row) => ({
      txHash: row.tx_hash,
      logIndex: row.log_index,
      blockNumber: toBlockNumber(row.block_number),
      blockHash: row.block_hash,
      eventName: row.event_name,
      owner: row.owner,
      payload: row.payload,
      confirmedAtBlock: toBlockNumber(row.confirmed_at_block),
    }));
  }

  async getCursor(
    chainId: 56 | 97,
    contract: string,
  ): Promise<{ nextBlock: bigint; finalizedBlock: bigint } | null> {
    const result = await this.pool.query<{ next_block: string; finalized_block: string }>(
      `SELECT next_block, finalized_block FROM chain_sync_cursors
        WHERE chain_id = $1 AND contract = $2`,
      [chainId, contract.toLowerCase()],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { nextBlock: toBlockNumber(row.next_block), finalizedBlock: toBlockNumber(row.finalized_block) };
  }

  /** Counts by status; used for reconciliation and tests. */
  async countEvents(
    chainId: 56 | 97,
    status: 'INCLUDED' | 'ORPHANED',
  ): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM chain_events WHERE chain_id = $1 AND status = $2',
      [chainId, status],
    );
    return Number(result.rows[0]?.count ?? '0');
  }
}
