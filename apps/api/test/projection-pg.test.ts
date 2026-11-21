import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApiServer, PostgresProjectionReader } from '../src/index.js';

/**
 * E2-03 SQL integration tests against a real PostgreSQL instance.
 *
 * Skipped unless TEST_DATABASE_URL is set. Uses its own database derived from
 * that URL (suffix `_api`) so it can run in parallel with the worker suite.
 */

const BASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));
const CHAIN_ID = 56;
const OWNER_A = `0x${'aa'.repeat(20)}`;
const OWNER_B = `0x${'bb'.repeat(20)}`;
const CONTRACT = `0x${'22'.repeat(20)}`;
const H = (seed: number): string => `0x${seed.toString(16).padStart(64, '0')}`;

function apiDatabaseUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_api`;
  return url.toString();
}

const TEST_DATABASE_URL = BASE_URL === undefined ? undefined : apiDatabaseUrl(BASE_URL);
const describeWithDb = TEST_DATABASE_URL === undefined ? describe.skip : describe;

type EventSeed = {
  txSeed: number;
  logIndex?: number;
  block: number;
  event: string;
  owner: string | null;
  payload: Record<string, string>;
  status?: 'INCLUDED' | 'ORPHANED';
  confirmedAtBlock: number | null;
};

async function insertEvent(client: Client, seed: EventSeed): Promise<void> {
  await client.query(
    `INSERT INTO chain_events
       (chain_id, tx_hash, log_index, block_number, block_hash, event_name, owner, payload, status, confirmed_at_block)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      CHAIN_ID,
      H(seed.txSeed),
      seed.logIndex ?? 0,
      seed.block,
      H(seed.block),
      seed.event,
      seed.owner,
      JSON.stringify(seed.payload),
      seed.status ?? 'INCLUDED',
      seed.confirmedAtBlock,
    ],
  );
}

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

describeWithDb('PostgresProjectionReader (PostgreSQL)', () => {
  let reader: PostgresProjectionReader;
  let client: Client;

  beforeAll(async () => {
    await prepareDatabase(TEST_DATABASE_URL!);
    reader = new PostgresProjectionReader(TEST_DATABASE_URL!);
    client = new Client({ connectionString: TEST_DATABASE_URL! });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await reader?.close();
  });

  beforeEach(async () => {
    await client.query('TRUNCATE chain_events, chain_sync_cursors, proposals, projects');
    await client.query(
      `INSERT INTO proposals (chain_proposal_id, owner, content_hash, deadline, status)
       VALUES (7, $1, $2, now() + interval '2 days', 'OPEN'),
              (8, $1, $2, now() - interval '1 day', 'PASSED')`,
      [OWNER_A, H(7001)],
    );
    await client.query(
      `INSERT INTO projects (chain_project_id, name, goal_build, funded_build, state)
       VALUES (1, 'Golden Toilet Tower', 2000, 150, 'FUNDING')`,
    );
    await client.query(
      `INSERT INTO chain_sync_cursors (chain_id, contract, next_block, finalized_block, updated_at)
       VALUES ($1, $2, 2000, 1500, '2026-11-19T07:59:00Z')`,
      [CHAIN_ID, CONTRACT],
    );

    await insertEvent(client, {
      txSeed: 1001,
      block: 1100,
      event: 'VoteCast',
      owner: OWNER_A,
      payload: { proposalId: '7', owner: OWNER_A, choice: '1' },
      confirmedAtBlock: 1500,
    });
    // Pending vote: must never be counted.
    await insertEvent(client, {
      txSeed: 1002,
      block: 1400,
      event: 'VoteCast',
      owner: OWNER_B,
      payload: { proposalId: '7', owner: OWNER_B, choice: '2' },
      confirmedAtBlock: null,
    });
    // Orphaned vote: must never be counted.
    await insertEvent(client, {
      txSeed: 1003,
      block: 1050,
      event: 'VoteCast',
      owner: OWNER_B,
      payload: { proposalId: '7', owner: OWNER_B, choice: '3' },
      status: 'ORPHANED',
      confirmedAtBlock: 1500,
    });

    await insertEvent(client, {
      txSeed: 2001,
      block: 1200,
      event: 'ContributionMade',
      owner: OWNER_A,
      payload: { owner: OWNER_A, projectId: '1', amount: '100', fundedAfter: '100' },
      confirmedAtBlock: 1500,
    });
    await insertEvent(client, {
      txSeed: 2002,
      block: 1210,
      event: 'ContributionMade',
      owner: OWNER_A,
      payload: { owner: OWNER_A, projectId: '1', amount: '50', fundedAfter: '150' },
      confirmedAtBlock: 1500,
    });
    await insertEvent(client, {
      txSeed: 2003,
      block: 1215,
      event: 'ContributionMade',
      owner: OWNER_B,
      payload: { owner: OWNER_B, projectId: '1', amount: '20', fundedAfter: '170' },
      confirmedAtBlock: 1500,
    });
    // Pending contribution: excluded from totals.
    await insertEvent(client, {
      txSeed: 2004,
      block: 1490,
      event: 'ContributionMade',
      owner: OWNER_A,
      payload: { owner: OWNER_A, projectId: '1', amount: '999', fundedAfter: '1169' },
      confirmedAtBlock: null,
    });

    await insertEvent(client, {
      txSeed: 3001,
      block: 1000,
      event: 'CitizenRegistered',
      owner: OWNER_A,
      payload: { owner: OWNER_A, commitment: H(9001) },
      confirmedAtBlock: 1500,
    });
    await insertEvent(client, {
      txSeed: 3002,
      block: 1300,
      event: 'CitizenRegistered',
      owner: OWNER_B,
      payload: { owner: OWNER_B, commitment: H(9002) },
      confirmedAtBlock: null,
    });
  });

  it('reads sync status from the cursor', async () => {
    const sync = await reader.getSyncStatus(56);
    expect(sync.finalizedBlock).toBe(1500n);
    expect(sync.syncedAt).toBeInstanceOf(Date);
    expect(await reader.getSyncStatus(97)).toMatchObject({ state: 'UNKNOWN', finalizedBlock: null });
  });

  it('lists and filters proposals', async () => {
    const all = await reader.listProposals();
    expect(all.map((row) => row.chainProposalId)).toEqual(['8', '7']);
    const open = await reader.listProposals('OPEN');
    expect(open).toHaveLength(1);
    expect(open[0]?.chainProposalId).toBe('7');
    expect(await reader.findProposal('123')).toBeNull();
  });

  it('counts only confirmed, non-orphaned votes', async () => {
    expect(await reader.getProposalVotes(56, '7')).toEqual({
      yes: 1,
      no: 0,
      abstain: 0,
      unclassified: 0,
    });
  });

  it('exposes only confirmed tx links in chain order', async () => {
    const links = await reader.listProposalTxLinks(56, '7');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ eventName: 'VoteCast', blockNumber: '1100' });
  });

  it('aggregates contributor BUILD excluding pending contributions', async () => {
    const contributors = await reader.getProjectContributors(56, '1');
    expect(contributors).toEqual([
      { owner: OWNER_A, amount: '150' },
      { owner: OWNER_B, amount: '20' },
    ]);
  });

  it('treats unconfirmed registrations as not registered in the projection', async () => {
    expect(await reader.getIdentityProjection(56, OWNER_A)).toEqual({
      registered: true,
      registeredTxHash: H(3001),
      registeredBlock: '1000',
    });
    expect((await reader.getIdentityProjection(56, OWNER_B)).registered).toBe(false);
    expect((await reader.getIdentityProjection(56, `0x${'ee'.repeat(20)}`)).registered).toBe(false);
  });

  it('lists projects and only confirmed activity entries', async () => {
    const projects = await reader.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ chainProjectId: '1', fundedBuild: '150' });

    const activity = await reader.listActivity(56, 50);
    expect(activity.length).toBeGreaterThan(0);
    // Pending rows (confirmed_at_block NULL) must never appear in the feed.
    expect(activity.every((row) => row.confirmedAtBlock !== null)).toBe(true);
    expect(activity.some((row) => row.txHash === H(1002))).toBe(false);
    // Newest first.
    const blocks = activity.map((row) => Number(row.blockNumber));
    expect([...blocks].sort((a, b) => b - a)).toEqual(blocks);
  });

  it('serves the same facts over HTTP', async () => {
    const app = buildApiServer({
      chainId: 56,
      reader,
      chain: null,
      now: () => new Date('2026-11-19T08:00:00.000Z'),
    });
    const asRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/projects/1' });
      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload) as Record<string, unknown>;
      const projectData = asRecord(payload.data);
      expect(projectData).toMatchObject({ goalBuild: '2000', fundedBuild: '150' });
      expect(projectData.contributors).toHaveLength(2);
      expect(asRecord(payload.sync)).toMatchObject({ finalizedBlock: '1500', state: 'SYNCED' });

      const proposalResponse = await app.inject({ method: 'GET', url: '/api/v1/proposals/7' });
      const proposalPayload = JSON.parse(proposalResponse.payload) as Record<string, unknown>;
      const votes = asRecord(asRecord(proposalPayload.data).votes);
      expect(votes.yes).toBe(1);
      expect(votes.no).toBe(0);
    } finally {
      await app.close();
    }
  });
});
