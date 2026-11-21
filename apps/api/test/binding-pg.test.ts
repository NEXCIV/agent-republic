import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BindingService,
  PostgresBindingRepository,
  type ChallengeResponse,
  type VerifyResult,
} from '../src/index.js';

/**
 * E2-04 PostgreSQL integration tests.
 *
 * Covers the parts that only a real database can prove: single-use challenges,
 * transaction rollback (a failed attempt must not burn the challenge), unique
 * binding constraints, and "confirmed event required" gating.
 */

const BASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));
const CHAIN_ID = 56;
const REGISTRY = `0x${'55'.repeat(20)}`;

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const CONFIG_HASH = `0x${'22'.repeat(32)}`;
const H = (seed: number): string => `0x${seed.toString(16).padStart(64, '0')}`;
const address = (seed: string): string => `0x${seed.repeat(20)}`;

function bindingDatabaseUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_binding`;
  return url.toString();
}

const TEST_DATABASE_URL = BASE_URL === undefined ? undefined : bindingDatabaseUrl(BASE_URL);
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

describeWithDb('BindingService (PostgreSQL)', () => {
  let repo: PostgresBindingRepository;
  let client: Client;
  let service: BindingService;
  let current: Date;
  let nonceSeed: number;

  beforeAll(async () => {
    await prepareDatabase(TEST_DATABASE_URL!);
    repo = new PostgresBindingRepository(TEST_DATABASE_URL!);
    client = new Client({ connectionString: TEST_DATABASE_URL! });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await repo?.close();
  });

  beforeEach(async () => {
    await client.query('TRUNCATE chain_events, auth_challenges, identity_bindings, app_users CASCADE');
    await client.query(
      `INSERT INTO app_users (id, auth_provider) VALUES ($1, 'PASSKEY'), ($2, 'PASSKEY')`,
      [USER_A, USER_B],
    );
    current = new Date('2026-11-19T08:00:00.000Z');
    nonceSeed = 0x1000;
    service = new BindingService({
      repo,
      chainId: CHAIN_ID,
      registryAddress: REGISTRY,
      now: () => current,
      generateNonce: () => {
        nonceSeed += 1;
        return H(nonceSeed);
      },
    });
  });

  async function createChallenge(appUserId: string, owner: string): Promise<ChallengeResponse> {
    return service.createChallenge({ appUserId, owner, agentConfigHash: CONFIG_HASH });
  }

  async function insertRegistration(options: {
    commitment: string;
    owner: string;
    txSeed: number;
    block?: number;
    confirmedAtBlock?: number | null;
  }): Promise<string> {
    const txHash = H(options.txSeed);
    const block = options.block ?? 100;
    await client.query(
      `INSERT INTO chain_events
         (chain_id, tx_hash, log_index, block_number, block_hash, event_name, owner, payload, status, confirmed_at_block)
       VALUES ($1, $2, 0, $3, $4, 'CitizenRegistered', $5, $6, 'INCLUDED', $7)`,
      [
        CHAIN_ID,
        txHash,
        block,
        H(block),
        options.owner,
        JSON.stringify({ owner: options.owner, commitment: options.commitment }),
        options.confirmedAtBlock === undefined ? block + 12 : options.confirmedAtBlock,
      ],
    );
    return txHash;
  }

  const verify = (appUserId: string, owner: string, txHash: string, challengeId: string): Promise<VerifyResult> =>
    service.verify({ appUserId, owner, txHash, challengeId });

  it('binds only after a finalized registration event matches the challenge', async () => {
    const owner = address('a1');
    const challenge = await createChallenge(USER_A, owner);
    const txHash = await insertRegistration({ commitment: challenge.commitment, owner, txSeed: 9001 });

    const result = await verify(USER_A, owner, txHash, challenge.challengeId);
    expect(result).toEqual({
      bindingState: 'BOUND',
      owner,
      appUserId: USER_A,
      registryTxHash: txHash,
    });

    const binding = await client.query('SELECT app_user_id, registry_tx_hash FROM identity_bindings WHERE owner = $1', [owner]);
    expect(binding.rows).toEqual([{ app_user_id: USER_A, registry_tx_hash: txHash }]);

    const challengeRow = await client.query('SELECT used_at FROM auth_challenges WHERE id = $1', [challenge.challengeId]);
    expect(challengeRow.rows[0]?.used_at).not.toBeNull();
  });

  it('rejects replay of a consumed challenge', async () => {
    const owner = address('a2');
    const challenge = await createChallenge(USER_A, owner);
    const txHash = await insertRegistration({ commitment: challenge.commitment, owner, txSeed: 9002 });

    await verify(USER_A, owner, txHash, challenge.challengeId);
    await expect(verify(USER_A, owner, txHash, challenge.challengeId)).rejects.toMatchObject({
      code: 'CHALLENGE_USED',
      statusCode: 409,
    });
  });

  it('rejects an expired challenge', async () => {
    const owner = address('a3');
    const challenge = await createChallenge(USER_A, owner);
    const txHash = await insertRegistration({ commitment: challenge.commitment, owner, txSeed: 9003 });

    current = new Date('2026-11-19T08:16:00.000Z');
    await expect(verify(USER_A, owner, txHash, challenge.challengeId)).rejects.toMatchObject({
      code: 'CHALLENGE_EXPIRED',
    });
  });

  it('reports PENDING_CONFIRMATION without consuming the challenge, then binds once finalized', async () => {
    const owner = address('a4');
    const challenge = await createChallenge(USER_A, owner);
    const txHash = await insertRegistration({
      commitment: challenge.commitment,
      owner,
      txSeed: 9004,
      confirmedAtBlock: null,
    });

    await expect(verify(USER_A, owner, txHash, challenge.challengeId)).resolves.toMatchObject({
      bindingState: 'PENDING_CONFIRMATION',
    });
    const untouched = await client.query('SELECT used_at FROM auth_challenges WHERE id = $1', [challenge.challengeId]);
    expect(untouched.rows[0]?.used_at).toBeNull();

    await client.query('UPDATE chain_events SET confirmed_at_block = 120 WHERE tx_hash = $1', [txHash]);
    await expect(verify(USER_A, owner, txHash, challenge.challengeId)).resolves.toMatchObject({
      bindingState: 'BOUND',
    });
  });

  it('rejects a transaction hash that does not match the confirmed event', async () => {
    const owner = address('a5');
    const challenge = await createChallenge(USER_A, owner);
    await insertRegistration({ commitment: challenge.commitment, owner, txSeed: 9005 });

    await expect(verify(USER_A, owner, H(9999), challenge.challengeId)).rejects.toMatchObject({
      code: 'TX_MISMATCH',
    });
  });

  it('rejects verification when no registration event exists', async () => {
    const owner = address('a6');
    const challenge = await createChallenge(USER_A, owner);
    await expect(verify(USER_A, owner, H(9006), challenge.challengeId)).rejects.toMatchObject({
      code: 'EVENT_NOT_FOUND',
    });
  });

  it('rejects an owner that does not match the challenge', async () => {
    const owner = address('a7');
    const other = address('a8');
    const challenge = await createChallenge(USER_A, owner);
    const txHash = await insertRegistration({ commitment: challenge.commitment, owner, txSeed: 9007 });

    await expect(verify(USER_A, other, txHash, challenge.challengeId)).rejects.toMatchObject({
      code: 'OWNER_MISMATCH',
    });
  });

  it("hides another account's challenge", async () => {
    const owner = address('a9');
    const challenge = await createChallenge(USER_A, owner);
    const txHash = await insertRegistration({ commitment: challenge.commitment, owner, txSeed: 9009 });

    await expect(verify(USER_B, owner, txHash, challenge.challengeId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  });

  it('rejects an owner already bound to another account', async () => {
    const owner = address('b1');
    await client.query(
      `INSERT INTO identity_bindings (owner, app_user_id, registry_tx_hash) VALUES ($1, $2, $3)`,
      [owner, USER_B, H(8001)],
    );

    const challenge = await createChallenge(USER_A, owner);
    const txHash = await insertRegistration({ commitment: challenge.commitment, owner, txSeed: 9101 });

    await expect(verify(USER_A, owner, txHash, challenge.challengeId)).rejects.toMatchObject({
      code: 'OWNER_ALREADY_BOUND',
    });

    // Rolled back: the challenge is still usable if the conflict is resolved.
    const challengeRow = await client.query('SELECT used_at FROM auth_challenges WHERE id = $1', [challenge.challengeId]);
    expect(challengeRow.rows[0]?.used_at).toBeNull();
  });

  it('rejects an account already bound to another owner', async () => {
    const owner = address('b2');
    await client.query(
      `INSERT INTO identity_bindings (owner, app_user_id, registry_tx_hash) VALUES ($1, $2, $3)`,
      [address('b3'), USER_A, H(8002)],
    );

    const challenge = await createChallenge(USER_A, owner);
    const txHash = await insertRegistration({ commitment: challenge.commitment, owner, txSeed: 9102 });

    await expect(verify(USER_A, owner, txHash, challenge.challengeId)).rejects.toMatchObject({
      code: 'APP_USER_ALREADY_BOUND',
    });
  });
});
