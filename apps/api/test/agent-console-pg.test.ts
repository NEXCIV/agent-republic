import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AgentVersionConflictError,
  PostgresAgentConsoleRepository,
} from '../src/index.js';

/**
 * E3-07 PostgreSQL integration tests.
 *
 * Only a real database can prove that config writes are append-only, that a
 * stale expectedVersion cannot overwrite a newer version, and that every read
 * and write is scoped to the owner from the binding.
 */

const BASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';
const OWNER_A = `0x${'a1'.repeat(20)}`;
const OWNER_B = `0x${'b1'.repeat(20)}`;
const REGISTRY_TX = `0x${'11'.repeat(32)}`;

function consoleDatabaseUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_console`;
  return url.toString();
}

const TEST_DATABASE_URL = BASE_URL === undefined ? undefined : consoleDatabaseUrl(BASE_URL);
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

describeWithDb('PostgresAgentConsoleRepository', () => {
  let repo: PostgresAgentConsoleRepository;
  let client: Client;

  beforeAll(async () => {
    await prepareDatabase(TEST_DATABASE_URL!);
    repo = new PostgresAgentConsoleRepository(TEST_DATABASE_URL!);
    client = new Client({ connectionString: TEST_DATABASE_URL! });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await repo?.close();
  });

  beforeEach(async () => {
    await client.query(
      'TRUNCATE chain_events, auth_challenges, identity_bindings, app_users, agents, agent_configs, action_intents CASCADE',
    );
    await client.query(
      `INSERT INTO app_users (id, auth_provider) VALUES ($1, 'PASSKEY'), ($2, 'PASSKEY')`,
      [USER_A, USER_B],
    );
    await client.query(
      `INSERT INTO identity_bindings (owner, app_user_id, registry_tx_hash)
       VALUES ($1, $2, $3), ($4, $5, $3)`,
      [OWNER_A, USER_A, REGISTRY_TX, OWNER_B, USER_B],
    );
  });

  const createAgent = (owner: string, name = 'Archivist') =>
    repo.saveConfig({
      owner,
      name,
      persona: 'PRAGMATIC',
      goal: 'BUILD_PUBLIC_GOODS',
      expectedVersion: null,
    });

  it('creates version 1 and appends an immutable version on update', async () => {
    const created = await createAgent(OWNER_A);
    expect(created).toMatchObject({ configVersion: 1, status: 'ACTIVE' });

    const updated = await repo.saveConfig({
      owner: OWNER_A,
      name: 'Archivist II',
      persona: 'RULE_BASED',
      goal: 'DEFEND_RULES',
      expectedVersion: 1,
    });
    expect(updated).toMatchObject({ agentId: created.agentId, configVersion: 2, status: 'ACTIVE' });

    const view = await repo.getByOwner(OWNER_A);
    expect(view).not.toBeNull();
    expect(view!.name).toBe('Archivist II');
    expect(view!.configVersion).toBe(2);
    expect(view!.versions.map((entry) => entry.version)).toEqual([2, 1]);
    // The old version is still readable and unchanged.
    expect(view!.versions[1]).toMatchObject({ name: 'Archivist', persona: 'PRAGMATIC' });

    const rows = await client.query(
      'SELECT version FROM agent_configs WHERE agent_id = $1 ORDER BY version',
      [created.agentId],
    );
    expect(rows.rows.map((row: { version: number }) => row.version)).toEqual([1, 2]);
  });

  it('rejects a stale expectedVersion without writing anything', async () => {
    const created = await createAgent(OWNER_A);

    await expect(
      repo.saveConfig({
        owner: OWNER_A,
        name: 'Overwrite Attempt',
        persona: 'COMPETITIVE',
        goal: 'MAXIMIZE_REPUTATION',
        expectedVersion: 5,
      }),
    ).rejects.toBeInstanceOf(AgentVersionConflictError);

    const view = await repo.getByOwner(OWNER_A);
    expect(view!.configVersion).toBe(1);
    expect(view!.versions).toHaveLength(1);

    const rows = await client.query('SELECT count(*)::int AS count FROM agent_configs WHERE agent_id = $1', [
      created.agentId,
    ]);
    expect(rows.rows[0]).toEqual({ count: 1 });
  });

  it('records pause and resume as versions and no-ops on the same state', async () => {
    await createAgent(OWNER_A);

    const paused = await repo.setPaused(OWNER_A, true);
    expect(paused).toMatchObject({ configVersion: 2, status: 'PAUSED' });

    const again = await repo.setPaused(OWNER_A, true);
    expect(again).toMatchObject({ configVersion: 2, status: 'PAUSED' });

    const resumed = await repo.setPaused(OWNER_A, false);
    expect(resumed).toMatchObject({ configVersion: 3, status: 'ACTIVE' });

    const view = await repo.getByOwner(OWNER_A);
    expect(view!.status).toBe('ACTIVE');
    expect(view!.versions.map((entry) => entry.version)).toEqual([3, 2, 1]);
    expect(view!.versions[1]).toMatchObject({ paused: true });
  });

  it('returns null when pausing an owner without an agent', async () => {
    await expect(repo.setPaused(OWNER_A, true)).resolves.toBeNull();
  });

  it('keeps owners isolated for reads and writes', async () => {
    await createAgent(OWNER_A, 'Alpha');
    await createAgent(OWNER_B, 'Beta');

    expect((await repo.getByOwner(OWNER_A))!.name).toBe('Alpha');
    expect((await repo.getByOwner(OWNER_B))!.name).toBe('Beta');

    await repo.saveConfig({
      owner: OWNER_A,
      name: 'Alpha II',
      persona: 'COOPERATIVE',
      goal: 'EXPLORE_COALITIONS',
      expectedVersion: 1,
    });

    expect((await repo.getByOwner(OWNER_B))!.configVersion).toBe(1);
    expect((await repo.getByOwner(OWNER_B))!.name).toBe('Beta');

    await expect(repo.findOwnerForAppUser(USER_A)).resolves.toBe(OWNER_A);
    await expect(repo.findOwnerForAppUser(USER_B)).resolves.toBe(OWNER_B);
    await expect(repo.findOwnerForAppUser(USER_C)).resolves.toBeNull();
  });

  it('returns only the owner recent action intents, newest first', async () => {
    const agent = await createAgent(OWNER_A);
    const insert = (owner: string, key: string, updatedAt: string, status = 'PROPOSED') =>
      client.query(
        `INSERT INTO action_intents
           (owner, agent_id, action_type, target_id, json_payload, policy_version, status, idempotency_key, created_at, updated_at)
         VALUES ($1, $2, 'SUGGEST_VOTE', '1', '{}'::jsonb, 'policy-v1', $3, $4, $5, $5)`,
        [owner, owner === OWNER_A ? agent.agentId : null, status, key, updatedAt],
      );

    await insert(OWNER_A, 'key-a-1', '2026-11-20T07:00:00.000Z', 'PROPOSED');
    await insert(OWNER_A, 'key-a-2', '2026-11-20T09:00:00.000Z', 'APPROVED');
    await insert(OWNER_B, 'key-b-1', '2026-11-20T10:00:00.000Z');

    const view = await repo.getByOwner(OWNER_A);
    expect(view!.recentActions).toHaveLength(2);
    expect(view!.recentActions.map((action) => action.status)).toEqual(['APPROVED', 'PROPOSED']);
    expect(view!.recentActions[0]!.updatedAt).toBe('2026-11-20T09:00:00.000Z');
  });
});
