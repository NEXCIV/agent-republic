import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorldRecovery } from '../src/index.js';

/**
 * E5-07 reorg recovery tests: after a fork, every visual milestone that came
 * from a withdrawn chain event (and every tick built on a vanished block) must
 * disappear. Off-chain simulation events must survive.
 */

const BASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));
const SCENE = 'district-01@1';
const H = (seed: number): string => `0x${seed.toString(16).padStart(64, '0')}`;

function recoveryDatabaseUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_recovery`;
  return url.toString();
}

const TEST_DATABASE_URL = BASE_URL === undefined ? undefined : recoveryDatabaseUrl(BASE_URL);
const describeWithDb = TEST_DATABASE_URL === undefined ? describe.skip : describe;

async function prepareDatabase(connectionString: string): Promise<void> {
  const parsed = new URL(connectionString);
  const databaseName = parsed.pathname.replace(/^\//, '');
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = '/postgres';

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
  if (existing.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  }
  await admin.end();

  const client = new Client({ connectionString });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort()) {
    await client.query(readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8'));
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file.replace(/\.sql$/, '')]);
  }
  await client.end();
}

describeWithDb('WorldRecovery (PostgreSQL)', () => {
  let recovery: WorldRecovery;
  let client: Client;

  beforeAll(async () => {
    await prepareDatabase(TEST_DATABASE_URL!);
    recovery = new WorldRecovery(TEST_DATABASE_URL!);
    client = new Client({ connectionString: TEST_DATABASE_URL! });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await recovery?.close();
  });

  beforeEach(async () => {
    await client.query(
      `TRUNCATE world_visual_events, world_sim_states, world_ticks, world_scene_versions,
                social_revisions, chain_events, chain_block_hashes CASCADE`,
    );
    await client.query(`INSERT INTO world_scene_versions (scene_version, manifest_hash) VALUES ($1, 'sha256:v1')`, [SCENE]);
    await client.query(`INSERT INTO social_revisions (revision, reason) VALUES (1, 'initial')`);

    await client.query(
      `INSERT INTO chain_block_hashes (chain_id, block_number, block_hash, parent_hash)
       VALUES (56, 100, $1, $2), (56, 101, $3, $1)`,
      [H(100), H(99), H(101)],
    );
    await client.query(
      `INSERT INTO chain_events
         (chain_id, tx_hash, log_index, block_number, block_hash, event_name, owner, payload, status, confirmed_at_block)
       VALUES (56, $1, 0, 100, $2, 'ContributionMade', $3, $4, 'INCLUDED', 112),
              (56, $5, 0, 101, $6, 'ContributionMade', $3, $7, 'INCLUDED', 113)`,
      [
        H(1),
        H(100),
        `0x${'aa'.repeat(20)}`,
        JSON.stringify({ projectId: '1', amount: '10', fundedAfter: '10' }),
        H(2),
        H(101),
        JSON.stringify({ projectId: '1', amount: '20', fundedAfter: '30' }),
      ],
    );

    await client.query(
      `INSERT INTO world_ticks (scene_version, tick, base_block, base_block_hash, social_revision, frame_id)
       VALUES ($1, 10, 100, $2, 1, $3), ($1, 11, 101, $4, 1, $5)`,
      [SCENE, H(100), H(910), H(101), H(911)],
    );
    await client.query(
      `INSERT INTO world_sim_states (scene_version, tick, state_json, state_hash)
       VALUES ($1, 10, '{}', 'h10'), ($1, 11, '{}', 'h11')`,
      [SCENE],
    );
    await client.query(
      `INSERT INTO world_visual_events (scene_version, tick, origin, source_id, kind, payload)
       VALUES ($1, 10, 'CHAIN_CONFIRMED', $2, 'MILESTONE', $3),
              ($1, 10, 'OFFCHAIN_APPROVED', 'agent-01', 'MOVE', $4),
              ($1, 11, 'CHAIN_CONFIRMED', $5, 'MILESTONE', $6),
              ($1, 11, 'OFFCHAIN_APPROVED', 'agent-02', 'MOVE', $7)`,
      [
        SCENE,
        `${H(1)}:0`,
        JSON.stringify({ id: 'chain-1', targetId: 'project:1', happenedAtTick: '10' }),
        JSON.stringify({ id: 'move-1', targetId: 'agent-01', happenedAtTick: '10' }),
        `${H(2)}:0`,
        JSON.stringify({ id: 'chain-2', targetId: 'project:1', happenedAtTick: '11' }),
        JSON.stringify({ id: 'move-2', targetId: 'agent-02', happenedAtTick: '11' }),
      ],
    );
  });

  /** Simulates a fork at block 101: hash ledger trimmed, event withdrawn. */
  const fork = async (): Promise<void> => {
    await client.query('DELETE FROM chain_block_hashes WHERE chain_id = 56 AND block_number = 101');
    await client.query(
      `UPDATE chain_events
          SET status = 'ORPHANED', confirmed_at_block = NULL, orphaned_at = now()
        WHERE chain_id = 56 AND tx_hash = $1`,
      [H(2)],
    );
  };

  it('removes withdrawn chain visuals and ticks built on vanished blocks', async () => {
    await fork();
    const result = await recovery.recoverAfterReorg(56, SCENE);

    expect(result.invalidatedTicks).toBe(1);
    expect(result.removedChainVisualEvents).toBe(1);

    const ticks = await client.query<{ tick: string }>(
      `SELECT tick::text AS tick FROM world_ticks WHERE scene_version = $1 ORDER BY tick`,
      [SCENE],
    );
    expect(ticks.rows.map((row) => row.tick)).toEqual(['10']);

    const states = await client.query<{ tick: string }>(
      `SELECT tick::text AS tick FROM world_sim_states WHERE scene_version = $1 ORDER BY tick`,
      [SCENE],
    );
    expect(states.rows.map((row) => row.tick)).toEqual(['10']);

    const visuals = await client.query<{ origin: string; source_id: string }>(
      `SELECT origin, source_id FROM world_visual_events WHERE scene_version = $1 ORDER BY origin, source_id`,
      [SCENE],
    );
    expect(visuals.rows).toEqual([
      { origin: 'CHAIN_CONFIRMED', source_id: `${H(1)}:0` },
      { origin: 'OFFCHAIN_APPROVED', source_id: 'agent-01' },
    ]);
  });

  it('is idempotent when recovery runs again', async () => {
    await fork();
    await recovery.recoverAfterReorg(56, SCENE);
    const second = await recovery.recoverAfterReorg(56, SCENE);
    expect(second).toEqual({ invalidatedTicks: 0, removedChainVisualEvents: 0 });
  });

  it('leaves the world untouched when the chain did not fork', async () => {
    const result = await recovery.recoverAfterReorg(56, SCENE);
    expect(result).toEqual({ invalidatedTicks: 0, removedChainVisualEvents: 0 });

    const ticks = await client.query(`SELECT 1 FROM world_ticks WHERE scene_version = $1`, [SCENE]);
    expect(ticks.rowCount).toBe(2);
    const visuals = await client.query(`SELECT 1 FROM world_visual_events WHERE scene_version = $1`, [SCENE]);
    expect(visuals.rowCount).toBe(4);
  });
});
