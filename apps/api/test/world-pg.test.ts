import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { worldFrameV1Schema } from '@agent-republic/domain';
import { PostgresWorldReader, WorldService } from '../src/index.js';

/**
 * E5-06 SQL integration: the world reader must return exactly the confirmed,
 * moderated data the frame protocol expects — no pending events, no private
 * or unmoderated messages.
 */

const BASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));
const SCENE = 'district-01@1';
const OWNER = `0x${'aa'.repeat(20)}`;
const CONTRACT = `0x${'22'.repeat(20)}`;
const H = (seed: number): string => `0x${seed.toString(16).padStart(64, '0')}`;

function worldApiDatabaseUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_worldapi`;
  return url.toString();
}

const TEST_DATABASE_URL = BASE_URL === undefined ? undefined : worldApiDatabaseUrl(BASE_URL);
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

describeWithDb('PostgresWorldReader + WorldService (PostgreSQL)', () => {
  let reader: PostgresWorldReader;
  let client: Client;

  beforeAll(async () => {
    await prepareDatabase(TEST_DATABASE_URL!);
    reader = new PostgresWorldReader(TEST_DATABASE_URL!);
    client = new Client({ connectionString: TEST_DATABASE_URL! });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await reader?.close();
  });

  beforeEach(async () => {
    await client.query(
      `TRUNCATE chain_events, chain_block_hashes, chain_sync_cursors, world_visual_events,
                world_sim_states, world_ticks, world_scene_versions, social_revisions,
                agent_messages, agents, epochs, app_users CASCADE`,
    );

    await client.query(`INSERT INTO world_scene_versions (scene_version, manifest_hash) VALUES ($1, 'sha256:v1')`, [SCENE]);
    await client.query(`INSERT INTO social_revisions (revision, reason) VALUES (1, 'initial')`);
    await client.query(
      `INSERT INTO chain_sync_cursors (chain_id, contract, next_block, finalized_block, updated_at)
       VALUES (56, $1, 1600, 1500, now())`,
      [CONTRACT],
    );
    await client.query(
      `INSERT INTO chain_block_hashes (chain_id, block_number, block_hash, parent_hash, block_timestamp)
       VALUES (56, 1500, $1, $2, '2026-11-19T07:59:48Z')`,
      [H(1500), H(1499)],
    );

    const events: Array<{
      tx: number;
      block: number;
      name: string;
      owner: string | null;
      payload: Record<string, unknown>;
      confirmed: number | null;
    }> = [
      {
        tx: 1,
        block: 1490,
        name: 'CitizenRegistered',
        owner: OWNER,
        payload: { owner: OWNER, commitment: H(90) },
        confirmed: 1500,
      },
      {
        tx: 2,
        block: 1491,
        name: 'ProjectCreated',
        owner: null,
        payload: { projectId: '1', titleHash: H(91), goal: '2000', genesis: true },
        confirmed: 1500,
      },
      {
        tx: 3,
        block: 1492,
        name: 'ContributionMade',
        owner: OWNER,
        payload: { owner: OWNER, projectId: '1', amount: '100', fundedAfter: '100' },
        confirmed: 1500,
      },
      // Included but not finalized: must never reach facts.
      {
        tx: 4,
        block: 1499,
        name: 'ContributionMade',
        owner: OWNER,
        payload: { owner: OWNER, projectId: '1', amount: '900', fundedAfter: '1000' },
        confirmed: null,
      },
    ];
    for (const event of events) {
      await client.query(
        `INSERT INTO chain_events
           (chain_id, tx_hash, log_index, block_number, block_hash, event_name, owner, payload, status, confirmed_at_block)
         VALUES (56, $1, 0, $2, $3, $4, $5, $6, 'INCLUDED', $7)`,
        [H(event.tx), event.block, H(event.block), event.name, event.owner, JSON.stringify(event.payload), event.confirmed],
      );
    }

    await client.query(
      `INSERT INTO world_ticks (scene_version, tick, base_block, social_revision, frame_id)
       VALUES ($1, 5, 1500, 1, $2)`,
      [SCENE, H(500)],
    );
    await client.query(
      `INSERT INTO world_sim_states (scene_version, tick, state_json, state_hash)
       VALUES ($1, 5, $2, 'state-hash-5')`,
      [
        SCENE,
        JSON.stringify({
          tick: '5',
          worldSeed: 'genesis-2026',
          agents: [
            {
              agentId: 'agent-01',
              position: [0, 0, 0],
              facingRadians: 0,
              action: 'IDLE',
              locationId: 'PLAZA',
              isSimulated: true,
            },
          ],
        }),
      ],
    );
    await client.query(
      `INSERT INTO world_visual_events (scene_version, tick, origin, source_id, kind, payload)
       VALUES ($1, 5, 'OFFCHAIN_APPROVED', 'agent-01', 'MOVE', $2)`,
      [SCENE, JSON.stringify({ id: '5:agent-01:MOVE', targetId: 'agent-01', happenedAtTick: '5' })],
    );

    await client.query(
      `INSERT INTO epochs (id, start_at, end_at, state) VALUES (20776, now() - interval '1 day', now(), 'ACTIVE')`,
    );
    const agent = await client.query<{ id: string }>(
      `INSERT INTO agents (owner, name, persona, goal, status)
       VALUES ($1, 'Ada', 'COOPERATIVE', 'BUILD_PUBLIC_GOODS', 'ACTIVE')
       RETURNING id`,
      [OWNER],
    );
    const agentId = agent.rows[0]!.id;

    const messages: Array<[string, string, string]> = [
      ['public approved', 'APPROVED', 'PUBLIC'],
      ['public pending', 'PENDING', 'PUBLIC'],
      ['private approved', 'APPROVED', 'PRIVATE'],
    ];
    for (const [text, moderation, visibility] of messages) {
      await client.query(
        `INSERT INTO agent_messages (epoch_id, agent_id, body, moderation_state, visibility)
         VALUES (20776, $1, $2, $3, $4)`,
        [agentId, text, moderation, visibility],
      );
    }
  });

  const service = () =>
    new WorldService({
      reader,
      chainId: 56,
      confirmedDepth: 12,
      now: () => new Date('2026-11-19T08:00:00.000Z'),
    });

  it('reads only finalized events and moderated public messages', async () => {
    const raw = await reader.loadRaw(56, SCENE);
    expect(raw.cursor?.finalizedBlock).toBe(1500n);
    expect(raw.block?.timestamp.toISOString()).toBe('2026-11-19T07:59:48.000Z');
    expect(raw.events).toHaveLength(3);
    expect(raw.events.every((event) => event.eventName !== 'ContributionMade' || event.blockNumber < 1499n)).toBe(true);
    expect(raw.society.messages.map((message) => message.text)).toEqual(['public approved']);
    expect(raw.society.agents[0]).toMatchObject({ displayName: 'Ada', active: true });
    expect(raw.society.socialRevision).toBe('1');
  });

  it('assembles a valid frame from the database', async () => {
    const frame = await service().getFrame();
    expect(() => worldFrameV1Schema.parse(frame)).not.toThrow();
    expect(frame.facts.citizenCount).toBe(1);
    expect(frame.facts.projects[0]).toMatchObject({ fundedBuild: '100', status: 'FUNDING' });
    expect(frame.simulation.tick).toBe('5');
    expect(frame.simulation.visualEvents).toHaveLength(1);
    expect(frame.society.publicMessages[0]?.provenance).toBe('AI_SIMULATED');
    expect(frame.source.blockNumber).toBe('1500');
    expect(frame.epochId).toBe(20776);
  });

  it('is deterministic across two reads of unchanged data', async () => {
    const first = await service().getFrame();
    const second = await service().getFrame();
    expect(second.frameId).toBe(first.frameId);
  });

  it('flags REORG_RECOVERY while withdrawn chain visuals remain', async () => {
    await client.query(
      `INSERT INTO world_visual_events (scene_version, tick, origin, source_id, kind, payload)
       VALUES ($1, 5, 'CHAIN_CONFIRMED', $2, 'MILESTONE', $3)`,
      [
        SCENE,
        `${H(77)}:0`,
        JSON.stringify({ id: 'withdrawn', targetId: 'project:1', happenedAtTick: '5' }),
      ],
    );

    const raw = await reader.loadRaw(56, SCENE);
    expect(raw.pendingRecovery).toBe(true);

    const frame = await service().getFrame();
    expect(frame.source.sync).toBe('REORG_RECOVERY');
  });
});
