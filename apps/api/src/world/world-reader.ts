import { Pool } from 'pg';
import type { VerifiedChainEvent } from '@agent-republic/world-engine';

/**
 * E5-06 read model for the world endpoints.
 *
 * Only confirmed, non-orphaned chain events feed the facts reducer; pending or
 * reorged rows are filtered in SQL. Society rows are limited to APPROVED
 * public messages — private agent memory never leaves the database.
 */

export type WorldMessageRow = {
  readonly id: string;
  readonly agentId: string;
  readonly owner: string;
  readonly text: string;
  readonly createdAt: Date;
};

export type WorldAgentRow = {
  readonly agentId: string;
  readonly owner: string;
  readonly displayName: string;
  readonly persona: string;
  readonly active: boolean;
};

export type WorldTickRow = {
  readonly tick: string;
  readonly frameId: string;
  readonly baseBlock: string;
  readonly socialRevision: string;
  readonly stateJson: unknown;
};

export type WorldVisualEventRow = {
  readonly id: string;
  readonly kind: string;
  readonly targetId: string;
  readonly happenedAtTick: string;
  readonly sourceType: 'CHAIN' | 'OFFCHAIN';
  readonly sourceId: string;
};

export type WorldRawData = {
  readonly cursor: { readonly finalizedBlock: bigint; readonly updatedAt: Date } | null;
  readonly block: { readonly number: string; readonly hash: string; readonly timestamp: Date } | null;
  readonly events: readonly VerifiedChainEvent[];
  readonly tick: WorldTickRow | null;
  readonly visualEvents: readonly WorldVisualEventRow[];
  /** True while chain-derived visuals still reference events withdrawn by a reorg. */
  readonly pendingRecovery: boolean;
  readonly society: {
    readonly socialRevision: string;
    readonly messages: readonly WorldMessageRow[];
    readonly agents: readonly WorldAgentRow[];
  };
};

export interface WorldReader {
  loadRaw(chainId: 56 | 97, sceneVersion: string): Promise<WorldRawData>;
}

export class PostgresWorldReader implements WorldReader {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    if (connectionString.trim() === '') {
      throw new Error('[api] DATABASE_URL is required; refusing to start without a database');
    }
    this.pool = new Pool({ connectionString, max: 5 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async loadRaw(chainId: 56 | 97, sceneVersion: string): Promise<WorldRawData> {
    const cursorResult = await this.pool.query<{
      finalized_block: string | null;
      updated_at: Date | null;
    }>(
      `SELECT max(finalized_block)::text AS finalized_block, max(updated_at) AS updated_at
         FROM chain_sync_cursors
        WHERE chain_id = $1`,
      [chainId],
    );
    // An aggregate over zero rows returns one row of NULLs, not no row.
    const cursorRow = cursorResult.rows[0];
    const cursor =
      cursorRow === undefined || cursorRow.finalized_block === null || cursorRow.updated_at === null
        ? null
        : { finalizedBlock: BigInt(cursorRow.finalized_block), updatedAt: cursorRow.updated_at };

    const blockResult =
      cursor === null
        ? { rows: [] as { block_number: string; block_hash: string; block_timestamp: Date }[] }
        : await this.pool.query<{ block_number: string; block_hash: string; block_timestamp: Date }>(
            `SELECT block_number::text AS block_number, block_hash, block_timestamp
               FROM chain_block_hashes
              WHERE chain_id = $1
                AND block_timestamp IS NOT NULL
                AND block_number <= $2
              ORDER BY block_number DESC
              LIMIT 1`,
            [chainId, cursor.finalizedBlock.toString()],
          );
    const blockRow = blockResult.rows[0];
    const block =
      blockRow === undefined
        ? null
        : { number: blockRow.block_number, hash: blockRow.block_hash, timestamp: blockRow.block_timestamp };

    const events = await this.pool.query<{
      event_name: string;
      tx_hash: string;
      log_index: number;
      block_number: string;
      block_hash: string;
      owner: string | null;
      payload: Record<string, string | boolean | null>;
    }>(
      `SELECT event_name, tx_hash, log_index, block_number::text AS block_number, block_hash, owner, payload
         FROM chain_events
        WHERE chain_id = $1
          AND status = 'INCLUDED'
          AND confirmed_at_block IS NOT NULL
        ORDER BY block_number, log_index`,
      [chainId],
    );

    const tickResult = await this.pool.query<{
      tick: string;
      frame_id: string;
      base_block: string;
      social_revision: string;
      state_json: unknown;
    }>(
      `SELECT t.tick::text AS tick, t.frame_id, t.base_block::text AS base_block,
              t.social_revision::text AS social_revision, s.state_json
         FROM world_ticks t
         LEFT JOIN world_sim_states s
           ON s.scene_version = t.scene_version AND s.tick = t.tick
        WHERE t.scene_version = $1
        ORDER BY t.tick DESC
        LIMIT 1`,
      [sceneVersion],
    );
    const tickRow = tickResult.rows[0];
    const tick =
      tickRow === undefined
        ? null
        : {
            tick: tickRow.tick,
            frameId: tickRow.frame_id,
            baseBlock: tickRow.base_block,
            socialRevision: tickRow.social_revision,
            stateJson: tickRow.state_json,
          };

    let visualEvents: WorldVisualEventRow[] = [];
    if (tick !== null) {
      const visual = await this.pool.query<{
        origin: 'CHAIN_CONFIRMED' | 'OFFCHAIN_APPROVED' | 'SYSTEM_SIMULATED';
        source_id: string;
        kind: string;
        payload: { id?: string; targetId?: string; happenedAtTick?: string };
      }>(
        `SELECT origin, source_id, kind, payload
           FROM world_visual_events
          WHERE scene_version = $1 AND tick = $2
          ORDER BY created_at, source_id, kind`,
        [sceneVersion, tick.tick],
      );
      visualEvents = visual.rows.map((row) => ({
        id: row.payload.id ?? `${row.source_id}:${row.kind}`,
        kind: row.kind,
        targetId: row.payload.targetId ?? row.source_id,
        happenedAtTick: row.payload.happenedAtTick ?? tick.tick,
        sourceType: row.origin === 'CHAIN_CONFIRMED' ? 'CHAIN' : 'OFFCHAIN',
        sourceId: row.source_id,
      }));
    }

    const messages = await this.pool.query<{
      id: string;
      agent_id: string;
      owner: string;
      body: string;
      created_at: Date;
    }>(
      `SELECT m.id::text AS id, m.agent_id::text AS agent_id, a.owner, m.body, m.created_at
         FROM agent_messages m
         JOIN agents a ON a.id = m.agent_id
        WHERE m.moderation_state = 'APPROVED' AND m.visibility = 'PUBLIC'
        ORDER BY m.created_at DESC
        LIMIT 20`,
      [],
    );

    const agents = await this.pool.query<{
      id: string;
      owner: string;
      name: string;
      persona: string;
      status: 'ACTIVE' | 'PAUSED';
    }>(`SELECT id::text AS id, owner, name, persona, status FROM agents ORDER BY created_at ASC LIMIT 30`);

    const revisions = await this.pool.query<{ revision: string | null }>(
      `SELECT max(revision)::text AS revision FROM social_revisions`,
    );

    const recovery = await this.pool.query<{ pending: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM world_visual_events v
          WHERE v.scene_version = $2
            AND v.origin = 'CHAIN_CONFIRMED'
            AND NOT EXISTS (
              SELECT 1
                FROM chain_events e
               WHERE e.chain_id = $1
                 AND e.tx_hash || ':' || e.log_index = v.source_id
                 AND e.status = 'INCLUDED'
                 AND e.confirmed_at_block IS NOT NULL
            )
       ) AS pending`,
      [chainId, sceneVersion],
    );

    return {
      cursor,
      block,
      events: events.rows.map((row) => ({
        eventName: row.event_name,
        txHash: row.tx_hash,
        logIndex: row.log_index,
        blockNumber: BigInt(row.block_number),
        blockHash: row.block_hash,
        owner: row.owner,
        payload: row.payload,
      })),
      tick,
      visualEvents,
      pendingRecovery: recovery.rows[0]?.pending === true,
      society: {
        socialRevision: revisions.rows[0]?.revision ?? '0',
        messages: messages.rows.map((row) => ({
          id: row.id,
          agentId: row.agent_id,
          owner: row.owner,
          text: row.body,
          createdAt: row.created_at,
        })),
        agents: agents.rows.map((row) => ({
          agentId: row.id,
          owner: row.owner,
          displayName: row.name,
          persona: row.persona,
          active: row.status === 'ACTIVE',
        })),
      },
    };
  }
}
