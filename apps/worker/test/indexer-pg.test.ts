import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { normalizeLog, type ChainEventDraft, type RawChainLog } from '@agent-republic/chain';
import { ChainIndexerStore, ReorgBelowFinalityError, type BlockRef } from '../src/index.js';

/**
 * E2-02 integration tests against a real PostgreSQL instance.
 *
 * They run only when TEST_DATABASE_URL is set (CI without a database must
 * skip rather than fake a pass):
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/agent_republic_test
 *
 * The database is reset (public schema dropped) and rebuilt from
 * db/migrations before the suite runs.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

const CHAIN_ID = 56 as const;
const CORE = '0x2222222222222222222222222222222222222222';
const OWNER_A = `0x${'aa'.repeat(20)}`;
const OWNER_B = `0x${'bb'.repeat(20)}`;

const H = (seed: number): string => `0x${seed.toString(16).padStart(64, '0')}`;
const block = (n: number, hashSeed = n): BlockRef => ({
  blockNumber: BigInt(n),
  blockHash: H(hashSeed),
});

function rawLog(overrides: Partial<RawChainLog> = {}): RawChainLog {
  return {
    blockNumber: 2n,
    blockHash: H(2),
    transactionHash: H(1002),
    logIndex: 0,
    address: CORE,
    eventName: 'VoteCast',
    args: { proposalId: 1n, owner: OWNER_A, choice: 1 },
    ...overrides,
  };
}

const draft = (overrides: Partial<RawChainLog> = {}): ChainEventDraft =>
  normalizeLog(CHAIN_ID, rawLog(overrides));

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
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await client.query(readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8'));
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file.replace(/\.sql$/, '')]);
  }
  await client.end();
}

const describeWithDb = TEST_DATABASE_URL === undefined ? describe.skip : describe;

describeWithDb('ChainIndexerStore (PostgreSQL)', () => {
  let store: ChainIndexerStore;

  beforeAll(async () => {
    await prepareDatabase(TEST_DATABASE_URL!);
    store = new ChainIndexerStore(TEST_DATABASE_URL!);
  });

  afterAll(async () => {
    await store?.close();
  });

  beforeEach(async () => {
    const client = new Client({ connectionString: TEST_DATABASE_URL! });
    await client.connect();
    await client.query('TRUNCATE chain_events, chain_block_hashes, chain_sync_cursors');
    await client.end();
  });

  const apply = (input: {
    blocks: BlockRef[];
    events: ChainEventDraft[];
    headBlock: bigint;
    confirmationsRequired?: number;
    nextBlock?: bigint;
  }) =>
    store.applyBatch({
      chainId: CHAIN_ID,
      contract: CORE,
      confirmationsRequired: 12,
      ...input,
    });

  it('replaying the same batch is idempotent (no duplicated events)', async () => {
    const batch = {
      blocks: [block(1), block(2), block(3)],
      events: [draft()],
      headBlock: 30n,
    };

    const first = await apply(batch);
    expect(first.reorg).toBeNull();
    expect(first.eventsWritten).toBe(1);
    expect(await store.countEvents(CHAIN_ID, 'INCLUDED')).toBe(1);

    await apply(batch);
    await apply(batch);
    expect(await store.countEvents(CHAIN_ID, 'INCLUDED')).toBe(1);
  });

  it('does not expose included-but-unconfirmed events to projections', async () => {
    // head 10 with 12 confirmations required => nothing is final yet.
    await apply({ blocks: [block(1), block(2)], events: [draft()], headBlock: 10n });

    expect(await store.countEvents(CHAIN_ID, 'INCLUDED')).toBe(1);
    expect(await store.listConfirmedEvents(CHAIN_ID)).toEqual([]);

    // Finality advances: the same event becomes visible.
    const result = await apply({ blocks: [block(1), block(2)], events: [draft()], headBlock: 20n });
    expect(result.confirmedEvents).toBe(1);

    const confirmed = await store.listConfirmedEvents(CHAIN_ID);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.owner).toBe(OWNER_A);
    expect(confirmed[0]?.payload.proposalId).toBe('1');
    expect(confirmed[0]?.confirmedAtBlock).toBe(8n);
  });

  it('orphans events at and above the fork, then accepts the replacement chain', async () => {
    await apply({
      blocks: [block(1), block(2), block(3), block(4), block(5)],
      events: [
        draft({ blockNumber: 4n, blockHash: H(4), transactionHash: H(1004) }),
        draft({ blockNumber: 5n, blockHash: H(5), transactionHash: H(1005), args: { proposalId: 1n, owner: OWNER_B, choice: 2 } }),
      ],
      headBlock: 5n,
    });
    expect(await store.countEvents(CHAIN_ID, 'INCLUDED')).toBe(2);

    // Blocks 4-5 are replaced; only a new event at block 4 survives.
    const result = await apply({
      blocks: [block(1), block(2), block(3), block(4, 44), block(5, 55)],
      events: [
        draft({ blockNumber: 4n, blockHash: H(44), transactionHash: H(2004) }),
      ],
      headBlock: 5n,
    });

    expect(result.reorg).toEqual({ fromBlock: 4n, orphanedEvents: 2 });
    expect(result.nextBlock).toBe(4n);
    expect(await store.countEvents(CHAIN_ID, 'ORPHANED')).toBe(2);
    expect(await store.countEvents(CHAIN_ID, 'INCLUDED')).toBe(1);

    const cursor = await store.getCursor(CHAIN_ID, CORE);
    expect(cursor?.nextBlock).toBe(4n);
    expect(cursor?.finalizedBlock).toBe(0n);

    // Fully resynced: remaining event belongs to the new fork's block 4.
    const confirmedRows = await store.listConfirmedEvents(CHAIN_ID);
    expect(confirmedRows).toEqual([]);
  });

  it('restores orphaned events when the original fork becomes canonical again', async () => {
    await apply({
      blocks: [block(1), block(2), block(3), block(4), block(5)],
      events: [
        draft({ blockNumber: 4n, blockHash: H(4), transactionHash: H(1004) }),
        draft({ blockNumber: 5n, blockHash: H(5), transactionHash: H(1005), args: { proposalId: 1n, owner: OWNER_B, choice: 2 } }),
      ],
      headBlock: 5n,
    });
    await apply({
      blocks: [block(1), block(2), block(3), block(4, 44), block(5, 55)],
      events: [draft({ blockNumber: 4n, blockHash: H(44), transactionHash: H(2004) })],
      headBlock: 5n,
    });

    const back = await apply({
      blocks: [block(1), block(2), block(3), block(4), block(5)],
      events: [
        draft({ blockNumber: 4n, blockHash: H(4), transactionHash: H(1004) }),
        draft({ blockNumber: 5n, blockHash: H(5), transactionHash: H(1005), args: { proposalId: 1n, owner: OWNER_B, choice: 2 } }),
      ],
      headBlock: 5n,
    });

    expect(back.reorg?.fromBlock).toBe(4n);
    expect(await store.countEvents(CHAIN_ID, 'INCLUDED')).toBe(2);
    expect(await store.countEvents(CHAIN_ID, 'ORPHANED')).toBe(1);
  });

  it('refuses to rewrite finalized history (fail closed, no partial writes)', async () => {
    await apply({
      blocks: [block(1), block(2), block(3), block(4), block(5)],
      events: [
        draft({ blockNumber: 4n, blockHash: H(4), transactionHash: H(1004) }),
      ],
      headBlock: 5n,
    });

    // head 16 - 12 confirmations => block 4 is final.
    await expect(
      apply({
        blocks: [block(1), block(2), block(3), block(4, 44), block(5, 55)],
        events: [],
        headBlock: 16n,
      }),
    ).rejects.toBeInstanceOf(ReorgBelowFinalityError);

    expect(await store.countEvents(CHAIN_ID, 'INCLUDED')).toBe(1);
    expect(await store.countEvents(CHAIN_ID, 'ORPHANED')).toBe(0);
    expect((await store.getCursor(CHAIN_ID, CORE))?.nextBlock).toBe(6n);
  });

  it('filters confirmed events by owner', async () => {
    await apply({
      blocks: [block(1), block(2), block(3)],
      events: [
        draft({ transactionHash: H(1002) }),
        draft({
          transactionHash: H(1003),
          args: { proposalId: 2n, owner: OWNER_B, choice: 0 },
        }),
      ],
      headBlock: 30n,
    });

    const onlyB = await store.listConfirmedEvents(CHAIN_ID, { owner: OWNER_B.toUpperCase() });
    expect(onlyB).toHaveLength(1);
    expect(onlyB[0]?.payload.proposalId).toBe('2');
  });
});
