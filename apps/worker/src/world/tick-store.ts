import { Pool } from 'pg';

/**
 * E5-05 world tick persistence with compare-and-swap (docs/WORLD_ENGINE.md §5.1).
 *
 * Job key `world:tick:{sceneVersion}:{tick}` is enforced by the database:
 * `world_ticks` is UNIQUE(scene_version, tick), so the first worker to INSERT
 * wins and everyone else is told `claimed: false`. Retries therefore cannot
 * duplicate a tick, a snapshot or a visual event.
 */

export type VisualEventInput = {
  readonly id: string;
  readonly kind: string;
  readonly targetId: string;
  readonly happenedAtTick: string;
  readonly sourceType: 'CHAIN' | 'OFFCHAIN';
  readonly sourceId: string;
};

export type ClaimTickInput = {
  readonly sceneVersion: string;
  readonly tick: string;
  readonly baseBlock: string;
  /** Hash of the block the tick was built on; used by reorg recovery. */
  readonly baseBlockHash?: string;
  readonly socialRevision: string;
  readonly frameId: string;
  readonly stateJson: unknown;
  readonly stateHash: string;
  readonly visualEvents: readonly VisualEventInput[];
};

export type StoredTick = {
  readonly frameId: string;
  readonly baseBlock: string;
  readonly stateHash: string;
  readonly stateJson: unknown;
};

export class WorldTickStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    if (connectionString.trim() === '') {
      throw new Error('[worker] DATABASE_URL is required; refusing to start without a database');
    }
    this.pool = new Pool({ connectionString, max: 4 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Atomically claims a tick and stores its snapshot + visual events.
   * Returns claimed:false when another worker already produced this tick.
   */
  async claimAndStore(input: ClaimTickInput): Promise<{ claimed: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const claim = await client.query(
        `INSERT INTO world_ticks (scene_version, tick, base_block, base_block_hash, social_revision, frame_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (scene_version, tick) DO NOTHING
         RETURNING id`,
        [
          input.sceneVersion,
          input.tick,
          input.baseBlock,
          input.baseBlockHash ?? null,
          input.socialRevision,
          input.frameId,
        ],
      );
      if ((claim.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return { claimed: false };
      }

      await client.query(
        `INSERT INTO world_sim_states (scene_version, tick, state_json, state_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (scene_version, tick) DO NOTHING`,
        [input.sceneVersion, input.tick, JSON.stringify(input.stateJson), input.stateHash],
      );

      for (const event of input.visualEvents) {
        await client.query(
          `INSERT INTO world_visual_events
             (scene_version, tick, origin, source_id, kind, payload)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (scene_version, tick, source_id, kind) DO NOTHING`,
          [
            input.sceneVersion,
            input.tick,
            event.sourceType === 'CHAIN' ? 'CHAIN_CONFIRMED' : 'OFFCHAIN_APPROVED',
            event.sourceId,
            event.kind,
            JSON.stringify({
              id: event.id,
              targetId: event.targetId,
              happenedAtTick: event.happenedAtTick,
            }),
          ],
        );
      }

      await client.query('COMMIT');
      return { claimed: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async loadTick(sceneVersion: string, tick: string): Promise<StoredTick | null> {
    const result = await this.pool.query<{
      frame_id: string;
      base_block: string;
      state_hash: string;
      state_json: unknown;
    }>(
      `SELECT t.frame_id, t.base_block::text AS base_block, s.state_hash, s.state_json
         FROM world_ticks t
         JOIN world_sim_states s
           ON s.scene_version = t.scene_version AND s.tick = t.tick
        WHERE t.scene_version = $1 AND t.tick = $2`,
      [sceneVersion, tick],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { frameId: row.frame_id, baseBlock: row.base_block, stateHash: row.state_hash, stateJson: row.state_json };
  }

  async latestTick(sceneVersion: string): Promise<string | null> {
    const result = await this.pool.query<{ tick: string }>(
      'SELECT max(tick)::text AS tick FROM world_ticks WHERE scene_version = $1',
      [sceneVersion],
    );
    return result.rows[0]?.tick ?? null;
  }

  async countVisualEvents(sceneVersion: string, tick: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM world_visual_events
        WHERE scene_version = $1 AND tick = $2`,
      [sceneVersion, tick],
    );
    return Number(result.rows[0]?.count ?? '0');
  }
}
