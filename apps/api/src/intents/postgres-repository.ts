import { Pool } from 'pg';
import type { Intent } from '@agent-republic/domain';
import type { IntentRepository, IntentRow, IntentStatus } from './intents.js';

/**
 * E2-05 Postgres persistence for action intents.
 *
 * `action_intents` stores what the user (or an agent suggestion) intends to
 * do; status only advances PROPOSED → PREPARED → SUBMITTED here. CONFIRMED
 * is never written by this repository.
 */

type IntentDbRow = {
  id: string;
  owner: string;
  action_type: Intent;
  target_id: string | null;
  json_payload: Record<string, unknown>;
  status: IntentStatus;
  tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = `id, owner, action_type, target_id, json_payload, status, tx_hash, created_at, updated_at`;

const toIntent = (row: IntentDbRow): IntentRow => ({
  id: row.id,
  owner: row.owner,
  actionType: row.action_type,
  targetId: row.target_id,
  parameters: row.json_payload,
  status: row.status,
  txHash: row.tx_hash,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Stable JSON for idempotency comparison (key order must not matter). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export class PostgresIntentRepository implements IntentRepository {
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

  async resolveOwner(appUserId: string): Promise<string | null> {
    const result = await this.pool.query<{ owner: string }>(
      'SELECT owner FROM identity_bindings WHERE app_user_id = $1',
      [appUserId],
    );
    return result.rows[0]?.owner ?? null;
  }

  async createIntent(input: {
    owner: string;
    actionType: Intent;
    targetId: string | null;
    parameters: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<
    | { kind: 'CREATED'; row: IntentRow }
    | { kind: 'EXISTING'; row: IntentRow }
    | { kind: 'IDEMPOTENCY_CONFLICT' }
  > {
    const inserted = await this.pool.query<IntentDbRow>(
      `INSERT INTO action_intents
         (owner, action_type, target_id, json_payload, policy_version, status, idempotency_key)
       VALUES ($1, $2, $3, $4, 'v1.1', 'PROPOSED', $5)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING ${COLUMNS}`,
      [input.owner, input.actionType, input.targetId, JSON.stringify(input.parameters), input.idempotencyKey],
    );
    const insertedRow = inserted.rows[0];
    if (insertedRow !== undefined) {
      return { kind: 'CREATED', row: toIntent(insertedRow) };
    }

    const existing = await this.pool.query<IntentDbRow>(
      `SELECT ${COLUMNS} FROM action_intents WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (row === undefined) {
      throw new Error('[api] idempotency lookup failed after a conflicting insert');
    }
    const sameIntent =
      row.owner === input.owner &&
      row.action_type === input.actionType &&
      row.target_id === input.targetId &&
      canonicalJson(row.json_payload) === canonicalJson(input.parameters);
    return sameIntent ? { kind: 'EXISTING', row: toIntent(row) } : { kind: 'IDEMPOTENCY_CONFLICT' };
  }

  async findIntent(id: string, owner: string): Promise<IntentRow | null> {
    const result = await this.pool.query<IntentDbRow>(
      `SELECT ${COLUMNS} FROM action_intents WHERE id = $1 AND owner = $2`,
      [id, owner],
    );
    const row = result.rows[0];
    return row === undefined ? null : toIntent(row);
  }

  async markPrepared(id: string, owner: string): Promise<IntentRow | null> {
    const result = await this.pool.query<IntentDbRow>(
      `UPDATE action_intents
          SET status = 'PREPARED', updated_at = now()
        WHERE id = $1 AND owner = $2 AND status IN ('PROPOSED', 'PREPARED')
        RETURNING ${COLUMNS}`,
      [id, owner],
    );
    const row = result.rows[0];
    return row === undefined ? null : toIntent(row);
  }

  async reportSubmission(
    id: string,
    owner: string,
    txHash: string,
  ): Promise<
    | { kind: 'UPDATED'; row: IntentRow }
    | { kind: 'NOT_FOUND' }
    | { kind: 'STATE_CONFLICT' }
    | { kind: 'TX_CONFLICT' }
  > {
    const result = await this.pool.query<IntentDbRow>(
      `UPDATE action_intents
          SET status = 'SUBMITTED', tx_hash = $3, updated_at = now()
        WHERE id = $1
          AND owner = $2
          AND status IN ('PREPARED', 'SUBMITTED')
          AND (tx_hash IS NULL OR tx_hash = $3)
        RETURNING ${COLUMNS}`,
      [id, owner, txHash],
    );
    const updated = result.rows[0];
    if (updated !== undefined) return { kind: 'UPDATED', row: toIntent(updated) };

    const existing = await this.pool.query<IntentDbRow>(
      `SELECT ${COLUMNS} FROM action_intents WHERE id = $1 AND owner = $2`,
      [id, owner],
    );
    const row = existing.rows[0];
    if (row === undefined) return { kind: 'NOT_FOUND' };
    if (row.tx_hash !== null && row.tx_hash !== txHash) return { kind: 'TX_CONFLICT' };
    return { kind: 'STATE_CONFLICT' };
  }

  async findEventsByTx(
    chainId: 56 | 97,
    txHash: string,
  ): Promise<
    readonly {
      eventName: string;
      blockNumber: bigint;
      status: 'INCLUDED' | 'ORPHANED';
      confirmedAtBlock: bigint | null;
    }[]
  > {
    const result = await this.pool.query<{
      event_name: string;
      block_number: string;
      status: 'INCLUDED' | 'ORPHANED';
      confirmed_at_block: string | null;
    }>(
      `SELECT event_name, block_number::text AS block_number, status, confirmed_at_block::text AS confirmed_at_block
         FROM chain_events
        WHERE chain_id = $1 AND tx_hash = $2
        ORDER BY block_number, log_index`,
      [chainId, txHash],
    );
    return result.rows.map((row) => ({
      eventName: row.event_name,
      blockNumber: BigInt(row.block_number),
      status: row.status,
      confirmedAtBlock: row.confirmed_at_block === null ? null : BigInt(row.confirmed_at_block),
    }));
  }

  async findIntentByTx(txHash: string): Promise<IntentRow | null> {
    const result = await this.pool.query<IntentDbRow>(
      `SELECT ${COLUMNS} FROM action_intents WHERE tx_hash = $1 ORDER BY updated_at DESC LIMIT 1`,
      [txHash],
    );
    const row = result.rows[0];
    return row === undefined ? null : toIntent(row);
  }

  async getFinalizedBlock(chainId: 56 | 97): Promise<bigint | null> {
    const result = await this.pool.query<{ finalized_block: string | null }>(
      'SELECT max(finalized_block)::text AS finalized_block FROM chain_sync_cursors WHERE chain_id = $1',
      [chainId],
    );
    const value = result.rows[0]?.finalized_block;
    return value === null || value === undefined ? null : BigInt(value);
  }
}
