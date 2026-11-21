import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorldTickStore } from '../src/index.js';

/**
 * E5-05 CAS tests: a tick is produced at most once (W-05), retries never
 * duplicate snapshots or visual events, and the stored state is exactly what
 * the deterministic step produced.
 */

const BASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));
const SCENE = 'district-01@1';
const FRAME_ID = `0x${'ab'.repeat(32)}`;

function worldDatabaseUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_world`;
  return url.toString();
}

const TEST_DATABASE_URL = BASE_URL === undefined ? undefined : worldDatabaseUrl(BASE_URL);
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

const state = (tick: string) => ({
  tick,
  agents: [{ agentId: 'agent-01', waypointId: 'P0', position: [0, 0, 0], facingRadians: 0 }],
});

const visualEvent = (tick: string) => ({
  id: `${tick}:agent-01:MOVE`,
  kind: 'MOVE',
  targetId: 'agent-01',
  happenedAtTick: tick,
  sourceType: 'OFFCHAIN' as const,
  sourceId: 'agent-01',
});

describeWithDb('WorldTickStore (PostgreSQL)', () => {
  let store: WorldTickStore;
  let client: Client;

  beforeAll(async () => {
    await prepareDatabase(TEST_DATABASE_URL!);
    store = new WorldTickStore(TEST_DATABASE_URL!);
    client = new Client({ connectionString: TEST_DATABASE_URL! });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await store?.close();
  });

  beforeEach(async () => {
    await client.query(
      'TRUNCATE world_visual_events, world_sim_states, world_ticks, world_scene_versions, social_revisions CASCADE',
    );
    await client.query(
      `INSERT INTO world_scene_versions (scene_version, manifest_hash) VALUES ($1, 'sha256:district-01')`,
      [SCENE],
    );
    await client.query(`INSERT INTO social_revisions (revision, reason) VALUES (1, 'test')`);
  });

  const claim = (tick: string, overrides: Partial<Parameters<WorldTickStore['claimAndStore']>[0]> = {}) =>
    store.claimAndStore({
      sceneVersion: SCENE,
      tick,
      baseBlock: '70000000',
      socialRevision: '1',
      frameId: FRAME_ID,
      stateJson: state(tick),
      stateHash: `hash-${tick}`,
      visualEvents: [visualEvent(tick)],
      ...overrides,
    });

  it('claims a tick once and stores the snapshot and events', async () => {
    const result = await claim('100');
    expect(result.claimed).toBe(true);

    const stored = await store.loadTick(SCENE, '100');
    expect(stored).toMatchObject({ frameId: FRAME_ID, baseBlock: '70000000', stateHash: 'hash-100' });
    expect(stored?.stateJson).toEqual(state('100'));
    expect(await store.countVisualEvents(SCENE, '100')).toBe(1);
  });

  it('rejects a duplicate producer without overwriting state or events', async () => {
    expect((await claim('101')).claimed).toBe(true);

    const duplicate = await claim('101', {
      frameId: `0x${'cd'.repeat(32)}`,
      stateJson: { tick: '101', agents: [] },
      stateHash: 'other',
      visualEvents: [visualEvent('101'), { ...visualEvent('101'), kind: 'WORLD_ALERT' }],
    });
    expect(duplicate.claimed).toBe(false);

    const stored = await store.loadTick(SCENE, '101');
    expect(stored?.frameId).toBe(FRAME_ID);
    expect(stored?.stateHash).toBe('hash-101');
    expect(await store.countVisualEvents(SCENE, '101')).toBe(1);
  });

  it('awards exactly one winner under concurrent claims', async () => {
    const results = await Promise.all([claim('102'), claim('102'), claim('102')]);
    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(await store.countVisualEvents(SCENE, '102')).toBe(1);
  });

  it('reports the latest produced tick but not future ticks', async () => {
    await claim('10');
    await claim('11');
    expect(await store.latestTick(SCENE)).toBe('11');
    expect(await store.loadTick(SCENE, '12')).toBeNull();
  });

  it('keeps ticks independent per scene version', async () => {
    await client.query(
      `INSERT INTO world_scene_versions (scene_version, manifest_hash) VALUES ('district-01@2', 'sha256:v2')`,
    );
    expect((await claim('200')).claimed).toBe(true);
    const other = await store.claimAndStore({
      sceneVersion: 'district-01@2',
      tick: '200',
      baseBlock: '70000001',
      socialRevision: '1',
      frameId: FRAME_ID,
      stateJson: state('200'),
      stateHash: 'hash-v2',
      visualEvents: [],
    });
    expect(other.claimed).toBe(true);
    expect(await store.countVisualEvents(SCENE, '200')).toBe(1);
    expect(await store.countVisualEvents('district-01@2', '200')).toBe(0);
  });
});
