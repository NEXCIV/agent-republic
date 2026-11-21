import { Pool } from 'pg';

/**
 * E5-07 reorg recovery for the world projection (docs/WORLD_ENGINE.md §6.1).
 *
 * A reorg can invalidate two things:
 *  1. world ticks built on a block that is no longer canonical
 *  2. chain-derived visual events whose source event became ORPHANED
 *
 * Recovery deletes those rows (child rows first) so the next frame can never
 * replay a milestone that the chain withdrew. Off-chain simulation events are
 * left untouched.
 */

export type WorldRecoveryResult = {
  readonly invalidatedTicks: number;
  readonly removedChainVisualEvents: number;
};

export class WorldRecovery {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    if (connectionString.trim() === '') {
      throw new Error('[worker] DATABASE_URL is required; refusing to start without a database');
    }
    this.pool = new Pool({ connectionString, max: 2 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async recoverAfterReorg(chainId: 56 | 97, sceneVersion: string): Promise<WorldRecoveryResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const orphanedVisuals = await client.query(
        `DELETE FROM world_visual_events v
          WHERE v.scene_version = $1
            AND v.origin = 'CHAIN_CONFIRMED'
            AND NOT EXISTS (
              SELECT 1
                FROM chain_events e
               WHERE e.chain_id = $2
                 AND e.tx_hash || ':' || e.log_index = v.source_id
                 AND e.status = 'INCLUDED'
                 AND e.confirmed_at_block IS NOT NULL
            )`,
        [sceneVersion, chainId],
      );

      const victims = await client.query<{ tick: string }>(
        `SELECT t.tick::text AS tick
           FROM world_ticks t
          WHERE t.scene_version = $1
            AND (
              (t.base_block_hash IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM chain_block_hashes b
                  WHERE b.chain_id = $2
                    AND b.block_number = t.base_block
                    AND b.block_hash = t.base_block_hash))
              OR (t.base_block_hash IS NULL AND NOT EXISTS (
                 SELECT 1 FROM chain_block_hashes b
                  WHERE b.chain_id = $2 AND b.block_number = t.base_block))
            )`,
        [sceneVersion, chainId],
      );

      if (victims.rows.length > 0) {
        const ticks = victims.rows.map((row) => row.tick);
        await client.query(
          `DELETE FROM world_visual_events WHERE scene_version = $1 AND tick = ANY($2::bigint[])`,
          [sceneVersion, ticks],
        );
        await client.query(
          `DELETE FROM world_sim_states WHERE scene_version = $1 AND tick = ANY($2::bigint[])`,
          [sceneVersion, ticks],
        );
        await client.query(
          `DELETE FROM world_ticks WHERE scene_version = $1 AND tick = ANY($2::bigint[])`,
          [sceneVersion, ticks],
        );
      }

      await client.query('COMMIT');
      return {
        invalidatedTicks: victims.rows.length,
        removedChainVisualEvents: orphanedVisuals.rowCount ?? 0,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
