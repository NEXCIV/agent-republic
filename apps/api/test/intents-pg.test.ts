import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IntentService, PostgresIntentRepository } from '../src/index.js';

/**
 * E2-05 PostgreSQL integration tests: idempotency, owner scoping, state
 * machine, and tx status derived from confirmed chain events.
 */

const BASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));
const CHAIN_ID = 56;
const APP_USER_A = '11111111-1111-4111-8111-111111111111';
const APP_USER_B = '22222222-2222-4222-8222-222222222222';
const OWNER_A = `0x${'aa'.repeat(20)}`;
const OWNER_B = `0x${'bb'.repeat(20)}`;
const CONTRACT = `0x${'22'.repeat(20)}`;
const H = (seed: number): string => `0x${seed.toString(16).padStart(64, '0')}`;

function intentsDatabaseUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_intents`;
  return url.toString();
}

const TEST_DATABASE_URL = BASE_URL === undefined ? undefined : intentsDatabaseUrl(BASE_URL);
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

describeWithDb('IntentService (PostgreSQL)', () => {
  let repo: PostgresIntentRepository;
  let client: Client;
  let service: IntentService;
  let keyCounter: number;

  beforeAll(async () => {
    await prepareDatabase(TEST_DATABASE_URL!);
    repo = new PostgresIntentRepository(TEST_DATABASE_URL!);
    client = new Client({ connectionString: TEST_DATABASE_URL! });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await repo?.close();
  });

  beforeEach(async () => {
    await client.query(
      'TRUNCATE chain_events, action_intents, identity_bindings, auth_challenges, app_users, chain_sync_cursors CASCADE',
    );
    await client.query(
      `INSERT INTO app_users (id, auth_provider) VALUES ($1, 'PASSKEY'), ($2, 'PASSKEY')`,
      [APP_USER_A, APP_USER_B],
    );
    await client.query(
      `INSERT INTO identity_bindings (owner, app_user_id, registry_tx_hash) VALUES ($1, $2, $3), ($4, $5, $6)`,
      [OWNER_A, APP_USER_A, H(7001), OWNER_B, APP_USER_B, H(7002)],
    );
    keyCounter = 0;
    service = new IntentService({
      repo,
      chainId: CHAIN_ID,
      coreAddress: CONTRACT,
      chain: null,
    });
  });

  const nextKey = (): string => {
    keyCounter += 1;
    return `idem-key-${String(keyCounter).padStart(4, '0')}`;
  };

  const createVoteIntent = (appUserId = APP_USER_A) =>
    service.create({
      appUserId,
      actionType: 'SUGGEST_VOTE',
      targetId: '7',
      parameters: { proposalId: '7', choice: 'YES' },
      idempotencyKey: nextKey(),
    });

  it('creates a PROPOSED intent and replays the same idempotency key', async () => {
    const key = nextKey();
    const input = {
      appUserId: APP_USER_A,
      actionType: 'SUGGEST_VOTE',
      targetId: '7',
      parameters: { proposalId: '7', choice: 'YES' },
      idempotencyKey: key,
    };

    const first = await service.create(input);
    expect(first.created).toBe(true);
    expect(first.intent.status).toBe('PROPOSED');
    expect(first.intent.owner).toBe(OWNER_A);

    const replay = await service.create(input);
    expect(replay.created).toBe(false);
    expect(replay.intent.id).toBe(first.intent.id);

    await expect(
      service.create({ ...input, parameters: { proposalId: '8', choice: 'NO' } }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('scopes intents to the bound owner', async () => {
    const { intent } = await createVoteIntent();
    await expect(
      service.prepare({ appUserId: APP_USER_B, intentId: intent.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
  });

  it('moves PROPOSED → PREPARED → SUBMITTED and refuses prepare afterwards', async () => {
    const { intent } = await createVoteIntent();

    const prepared = await service.prepare({ appUserId: APP_USER_A, intentId: intent.id });
    expect(prepared.status).toBe('PREPARED');
    expect(prepared.value).toBe('0');
    expect(prepared.data).toMatch(/^0x[0-9a-f]{8}(?:[0-9a-f]{64})+$/);

    await expect(
      service.reportSubmission({ appUserId: APP_USER_A, intentId: intent.id, txHash: H(9001) }),
    ).resolves.toMatchObject({ status: 'PENDING' });

    await expect(
      service.prepare({ appUserId: APP_USER_A, intentId: intent.id }),
    ).rejects.toMatchObject({ code: 'INTENT_STATE_CONFLICT' });

    await expect(
      service.reportSubmission({ appUserId: APP_USER_A, intentId: intent.id, txHash: H(9002) }),
    ).rejects.toMatchObject({ code: 'INTENT_STATE_CONFLICT' });
  });

  it('refuses to report a submission before prepare', async () => {
    const { intent } = await createVoteIntent();
    await expect(
      service.reportSubmission({ appUserId: APP_USER_A, intentId: intent.id, txHash: H(9003) }),
    ).rejects.toMatchObject({ code: 'INTENT_STATE_CONFLICT' });
  });

  it('reports status from indexed events, never from the self-reported hash alone', async () => {
    const { intent } = await createVoteIntent();
    const txHash = H(9100);
    await service.prepare({ appUserId: APP_USER_A, intentId: intent.id });
    await service.reportSubmission({ appUserId: APP_USER_A, intentId: intent.id, txHash });

    const pending = await service.txStatus(txHash);
    expect(pending).toMatchObject({ status: 'PENDING', source: 'INTENT' });

    await client.query(
      `INSERT INTO chain_events
         (chain_id, tx_hash, log_index, block_number, block_hash, event_name, owner, payload, status, confirmed_at_block)
       VALUES ($1, $2, 0, 50, $3, 'VoteCast', $4, $5, 'INCLUDED', NULL)`,
      [CHAIN_ID, txHash, H(50), OWNER_A, JSON.stringify({ proposalId: '7', owner: OWNER_A, choice: '1' })],
    );
    const included = await service.txStatus(txHash);
    expect(included).toMatchObject({ status: 'INCLUDED', source: 'CHAIN_EVENTS' });
    expect(included.events[0]).toMatchObject({ eventName: 'VoteCast', blockNumber: '50', confirmed: false });

    await client.query(`UPDATE chain_events SET confirmed_at_block = 62 WHERE tx_hash = $1`, [txHash]);
    await client.query(
      `INSERT INTO chain_sync_cursors (chain_id, contract, next_block, finalized_block)
       VALUES ($1, $2, 100, 62)`,
      [CHAIN_ID, CONTRACT],
    );
    const confirmed = await service.txStatus(txHash);
    expect(confirmed).toMatchObject({ status: 'CONFIRMED' });
  });

  it('keeps INCLUDED status when the event is above the finalized block', async () => {
    const txHash = H(9200);
    await client.query(
      `INSERT INTO chain_events
         (chain_id, tx_hash, log_index, block_number, block_hash, event_name, owner, payload, status, confirmed_at_block)
       VALUES ($1, $2, 0, 80, $3, 'VoteCast', $4, $5, 'INCLUDED', 80)`,
      [CHAIN_ID, txHash, H(80), OWNER_A, JSON.stringify({ proposalId: '7', owner: OWNER_A, choice: '1' })],
    );
    await client.query(
      `INSERT INTO chain_sync_cursors (chain_id, contract, next_block, finalized_block)
       VALUES ($1, $2, 100, 62)`,
      [CHAIN_ID, CONTRACT],
    );
    expect(await service.txStatus(txHash)).toMatchObject({ status: 'INCLUDED' });
  });

  it('reports PENDING while all events for the tx are orphaned', async () => {
    const txHash = H(9300);
    await client.query(
      `INSERT INTO chain_events
         (chain_id, tx_hash, log_index, block_number, block_hash, event_name, owner, payload, status, confirmed_at_block)
       VALUES ($1, $2, 0, 60, $3, 'VoteCast', $4, $5, 'ORPHANED', NULL)`,
      [CHAIN_ID, txHash, H(60), OWNER_A, JSON.stringify({ proposalId: '7', owner: OWNER_A, choice: '1' })],
    );
    const status = await service.txStatus(txHash);
    expect(status).toMatchObject({ status: 'PENDING', source: 'CHAIN_EVENTS' });
    expect(String(status.note)).toContain('orphaned');
  });
});
