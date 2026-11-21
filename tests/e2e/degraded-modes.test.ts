import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { normalizeLog } from '@agent-republic/chain';
import { SCENE_VERSION, type AgentObservationV1 } from '@agent-republic/domain';
import { planWithProvider, validateAction, type PolicyContext } from '@agent-republic/agent-engine';
import {
  IntentService,
  PostgresIntentRepository,
  PostgresProjectionReader,
  PostgresWorldReader,
  WorldService,
  buildApiServer,
} from '../../apps/api/src/index.js';
import {
  ChainIndexerStore,
  ReorgBelowFinalityError,
  type BlockRef,
} from '../../apps/worker/src/index.js';
import { toProjectStageView } from '../../apps/web/src/features/world-3d/adapters/projectStage.js';

/**
 * E7-02 — degraded-mode drills across the whole chain.
 *
 * Four failure modes, each asserted to fail closed instead of inventing data:
 *  1. reorg above finality: intent, tx status, WorldFrame and 3D stage revert
 *     together and recover when the replacement chain reconfirms the event;
 *  2. a fork at or below finality is refused and changes nothing;
 *  3. RPC/network outage: identity reads return RPC_DOWN, an unconfirmed tx
 *     stays PENDING/UNKNOWN, and a world without an indexer cursor returns
 *     WORLD_NOT_READY instead of a placeholder frame;
 *  4. LLM disabled: the planner abstains, and the manual wallet path (prepare
 *     calldata) still works without any model call.
 *
 * No mainnet transaction is involved; the chain input is a deterministic
 * fixture. Real wallet evidence still requires Gate A (AGENTS.md §2, §8).
 */

const BASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));

const CHAIN_ID = 56 as const;
const APP_USER = '11111111-1111-4111-8111-111111111111';
const OWNER = `0x${'a1'.repeat(20)}`;
const OTHER_OWNER = `0x${'b2'.repeat(20)}`;
const CORE = `0x${'22'.repeat(20)}`;
const H = (seed: number): string => `0x${seed.toString(16).padStart(64, '0')}`;
const PROJECT_TX = H(1002);
const PRIOR_TX = H(1003);
const OWN_TX = H(1004);
const UNCONFIRMED_TX = H(1005);

function degradedDatabaseUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_degraded`;
  return url.toString();
}

const TEST_DATABASE_URL = BASE_URL === undefined ? undefined : degradedDatabaseUrl(BASE_URL);
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

const block = (n: number, hashSeed = n): BlockRef => ({
  blockNumber: BigInt(n),
  blockHash: H(hashSeed),
  blockTimestamp: new Date(Date.UTC(2026, 10, 20, 7, 0, n % 60)).toISOString(),
});

type JsonRecord = Record<string, unknown>;
const body = (response: { payload: string }): JsonRecord => JSON.parse(response.payload) as JsonRecord;
const asRecord = (value: unknown): JsonRecord => value as JsonRecord;
const errorOf = (payload: JsonRecord): JsonRecord => asRecord(payload.error);

const observationFixture: AgentObservationV1 = {
  worldFrameId: H(11),
  sourceBlock: '108',
  epochId: 20777,
  facts: {
    citizenCount: 1,
    projects: [
      {
        id: '1',
        titleKey: 'golden-toilet-tower',
        goalBuild: '2000',
        fundedBuild: '480',
        status: 'FUNDING',
        completedAtBlock: null,
      },
    ],
    proposals: [],
  },
  self: {
    owner: OWNER,
    hasAgentId: true,
    registered: true,
    build: '100',
    rep: '0',
  },
  approvedPublicMessages: [],
  chainRecentEventIds: [`${PRIOR_TX}:0`],
};

describeWithDb('E7-02 degraded modes (PostgreSQL + API + world + 3D adapter)', () => {
  let client: Client;
  let store: ChainIndexerStore;
  let intentRepo: PostgresIntentRepository;
  let intentService: IntentService;
  let projection: PostgresProjectionReader;
  let worldReader: PostgresWorldReader;
  let worldService: WorldService;
  let app!: FastifyInstance;
  let agentId = '';

  beforeAll(async () => {
    await prepareDatabase(TEST_DATABASE_URL!);
    client = new Client({ connectionString: TEST_DATABASE_URL! });
    await client.connect();

    store = new ChainIndexerStore(TEST_DATABASE_URL!);
    intentRepo = new PostgresIntentRepository(TEST_DATABASE_URL!);
    intentService = new IntentService({
      repo: intentRepo,
      chainId: CHAIN_ID,
      coreAddress: CORE,
      chain: null,
    });
    projection = new PostgresProjectionReader(TEST_DATABASE_URL!);
    worldReader = new PostgresWorldReader(TEST_DATABASE_URL!);
    worldService = new WorldService({ reader: worldReader, chainId: CHAIN_ID, confirmedDepth: 12 });

    app = buildApiServer({
      chainId: CHAIN_ID,
      reader: projection,
      chain: null,
      intents: intentService,
      world: worldService,
      session: async () => ({ appUserId: APP_USER }),
    });
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([
      client?.end(),
      store?.close(),
      intentRepo?.close(),
      projection?.close(),
      worldReader?.close(),
    ]);
  });

  async function resetDatabase(): Promise<void> {
    await client.query(
      `TRUNCATE chain_events, chain_block_hashes, chain_sync_cursors,
                world_visual_events, world_sim_states, world_ticks,
                world_scene_versions, social_revisions, agent_messages,
                agent_configs, agents, action_intents, identity_bindings,
                auth_challenges, epochs, app_users CASCADE`,
    );
    await client.query(`INSERT INTO app_users (id, auth_provider) VALUES ($1, 'PASSKEY')`, [APP_USER]);
    await client.query(
      `INSERT INTO identity_bindings (owner, app_user_id, registry_tx_hash) VALUES ($1, $2, $3)`,
      [OWNER, APP_USER, H(9001)],
    );
    await client.query(
      `INSERT INTO world_scene_versions (scene_version, manifest_hash) VALUES ($1, 'sha256:degraded')`,
      [SCENE_VERSION],
    );
    await client.query(`INSERT INTO social_revisions (revision, reason) VALUES (1, 'degraded')`);

    const agent = await client.query<{ id: string }>(
      `INSERT INTO agents (owner, name, persona, goal, status)
       VALUES ($1, 'Degraded', 'PRAGMATIC', 'BUILD_PUBLIC_GOODS', 'ACTIVE')
       RETURNING id`,
      [OWNER],
    );
    agentId = agent.rows[0]!.id;

    // A user-reported submission that has not been confirmed yet.
    await client.query(
      `INSERT INTO action_intents
         (owner, agent_id, action_type, target_id, json_payload, policy_version, status, idempotency_key, tx_hash)
       VALUES ($1, $2, 'SUGGEST_CONTRIBUTION', '1', $3::jsonb, 'policy-v1', 'SUBMITTED', 'degraded-0001', $4)`,
      [OWNER, agentId, JSON.stringify({ projectId: '1', amount: '50' }), OWN_TX],
    );

    await client.query(
      `INSERT INTO world_ticks (scene_version, tick, base_block, social_revision, frame_id)
       VALUES ($1, 5, 108, 1, $2)`,
      [SCENE_VERSION, H(5000)],
    );
    await client.query(
      `INSERT INTO world_sim_states (scene_version, tick, state_json, state_hash)
       VALUES ($1, 5, $2, 'state-hash-degraded')`,
      [
        SCENE_VERSION,
        JSON.stringify({
          tick: '5',
          worldSeed: 'degraded-seed',
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
    for (const [id, tx, target] of [
      ['degraded-prior', PRIOR_TX, 'project:1'],
      ['degraded-own', OWN_TX, 'project:1'],
    ] as const) {
      await client.query(
        `INSERT INTO world_visual_events (scene_version, tick, origin, source_id, kind, payload)
         VALUES ($1, 5, 'CHAIN_CONFIRMED', $2, 'MILESTONE', $3)`,
        [SCENE_VERSION, `${tx}:0`, JSON.stringify({ id, targetId: target, happenedAtTick: '5' })],
      );
    }
  }

  const applyBatch = (input: {
    blocks: BlockRef[];
    events: ReturnType<typeof normalizeLog>[];
    headBlock: bigint;
  }) =>
    store.applyBatch({
      chainId: CHAIN_ID,
      contract: CORE,
      confirmationsRequired: 12,
      ...input,
    });

  const getFrame = async (): Promise<JsonRecord> => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/world/frame' });
    expect(response.statusCode).toBe(200);
    return body(response);
  };

  const txStatus = async (txHash: string): Promise<JsonRecord> => {
    const response = await app.inject({ method: 'GET', url: `/api/v1/tx/${txHash}` });
    expect(response.statusCode).toBe(200);
    return body(response);
  };

  const projectOf = (frame: JsonRecord): JsonRecord => {
    const projects = asRecord(frame.facts).projects as JsonRecord[];
    expect(projects).toHaveLength(1);
    return projects[0]!;
  };

  const stageOf = (project: JsonRecord) =>
    toProjectStageView({
      fundedBuild: String(project.fundedBuild),
      goalBuild: String(project.goalBuild),
      state: project.status as 'FUNDING' | 'COMPLETED',
    });

  const intentStatus = async (key: string): Promise<string> => {
    const row = await client.query<{ status: string }>(
      'SELECT status FROM action_intents WHERE idempotency_key = $1',
      [key],
    );
    return row.rows[0]!.status;
  };

  it('survives a reorg and reconfirmation without faking success', async () => {
    await resetDatabase();

    // Confirmed baseline: 480 existing + 50 from this owner = 530 / 2000.
    const first = await applyBatch({
      blocks: Array.from({ length: 9 }, (_, index) => block(100 + index)),
      events: [
        normalizeLog(CHAIN_ID, {
          blockNumber: 100n,
          blockHash: H(100),
          transactionHash: PROJECT_TX,
          logIndex: 0,
          address: CORE,
          eventName: 'ProjectCreated',
          args: { projectId: 1n, titleHash: H(910), goal: 2000n, genesis: true },
        }),
        normalizeLog(CHAIN_ID, {
          blockNumber: 101n,
          blockHash: H(101),
          transactionHash: PRIOR_TX,
          logIndex: 0,
          address: CORE,
          eventName: 'ContributionMade',
          args: { owner: OTHER_OWNER, projectId: 1n, amount: 480n, fundedAfter: 480n },
        }),
        normalizeLog(CHAIN_ID, {
          blockNumber: 102n,
          blockHash: H(102),
          transactionHash: OWN_TX,
          logIndex: 0,
          address: CORE,
          eventName: 'ContributionMade',
          args: { owner: OWNER, projectId: 1n, amount: 50n, fundedAfter: 530n },
        }),
      ],
      headBlock: 120n,
    });
    expect(first.reorg).toBeNull();
    expect(await intentStatus('degraded-0001')).toBe('CONFIRMED');
    expect(await txStatus(OWN_TX)).toMatchObject({ status: 'CONFIRMED', source: 'CHAIN_EVENTS' });
    const healthyFrame = await getFrame();
    expect(asRecord(healthyFrame.source).sync).toBe('LIVE');
    expect(projectOf(healthyFrame).fundedBuild).toBe('530');
    expect(stageOf(projectOf(healthyFrame))).toMatchObject({ stage: 'FRAME', progressBasisPoints: 2650 });

    // Reorg above finality: fork 101, incoming finality 98.
    const reorg = await applyBatch({
      blocks: Array.from({ length: 20 }, (_, index) => block(101 + index, 5000 + index)),
      events: [],
      headBlock: 110n,
    });
    expect(reorg.reorg).toMatchObject({ fromBlock: 101n });
    expect(await intentStatus('degraded-0001')).toBe('SUBMITTED');
    const reorgedTx = await txStatus(OWN_TX);
    expect(reorgedTx).toMatchObject({ status: 'PENDING', source: 'CHAIN_EVENTS' });
    const reorgFrame = await getFrame();
    expect(asRecord(reorgFrame.source).sync).toBe('REORG_RECOVERY');
    expect(projectOf(reorgFrame).fundedBuild).toBe('0');
    expect(stageOf(projectOf(reorgFrame))).toMatchObject({ stage: 'FOUNDATION', complete: false });

    // Replacement chain reconfirms both contributions at their new heights.
    const recovered = await applyBatch({
      blocks: Array.from({ length: 20 }, (_, index) => block(101 + index, 5000 + index)),
      events: [
        normalizeLog(CHAIN_ID, {
          blockNumber: 101n,
          blockHash: H(5001),
          transactionHash: PRIOR_TX,
          logIndex: 0,
          address: CORE,
          eventName: 'ContributionMade',
          args: { owner: OTHER_OWNER, projectId: 1n, amount: 480n, fundedAfter: 480n },
        }),
        normalizeLog(CHAIN_ID, {
          blockNumber: 118n,
          blockHash: H(5118),
          transactionHash: OWN_TX,
          logIndex: 0,
          address: CORE,
          eventName: 'ContributionMade',
          args: { owner: OWNER, projectId: 1n, amount: 50n, fundedAfter: 530n },
        }),
      ],
      headBlock: 132n,
    });
    expect(recovered.reorg).toBeNull();
    expect(await intentStatus('degraded-0001')).toBe('CONFIRMED');
    expect(await txStatus(OWN_TX)).toMatchObject({ status: 'CONFIRMED', source: 'CHAIN_EVENTS' });
    const recoveredFrame = await getFrame();
    expect(asRecord(recoveredFrame.source).sync).toBe('LIVE');
    expect(projectOf(recoveredFrame).fundedBuild).toBe('530');
    expect(stageOf(projectOf(recoveredFrame))).toMatchObject({ stage: 'FRAME', progressBasisPoints: 2650 });

    // A fork at or below finality must fail closed and leave state untouched.
    const cursorBefore = await store.getCursor(CHAIN_ID, CORE);
    await expect(
      applyBatch({
        blocks: [block(119, 7000), block(120, 7001)],
        events: [],
        headBlock: 140n,
      }),
    ).rejects.toBeInstanceOf(ReorgBelowFinalityError);
    expect(await intentStatus('degraded-0001')).toBe('CONFIRMED');
    expect(projectOf(await getFrame()).fundedBuild).toBe('530');
    expect(await store.getCursor(CHAIN_ID, CORE)).toEqual(cursorBefore);

    // RPC/network outage: no chain client, no fabricated confirmation.
    const identity = await app.inject({ method: 'GET', url: `/api/v1/identity/${OWNER}` });
    expect(identity.statusCode).toBe(503);
    expect(errorOf(body(identity)).code).toBe('RPC_DOWN');

    const unknown = await txStatus(H(9999));
    expect(unknown).toMatchObject({ status: 'UNKNOWN', source: 'NONE' });

    await client.query(
      `INSERT INTO action_intents
         (owner, agent_id, action_type, target_id, json_payload, policy_version, status, idempotency_key, tx_hash)
       VALUES ($1, $2, 'SUGGEST_CONTRIBUTION', '1', $3::jsonb, 'policy-v1', 'SUBMITTED', 'degraded-0002', $4)`,
      [OWNER, agentId, JSON.stringify({ projectId: '1', amount: '10' }), UNCONFIRMED_TX],
    );
    const unconfirmed = await txStatus(UNCONFIRMED_TX);
    expect(unconfirmed).toMatchObject({ status: 'PENDING', source: 'INTENT' });

    // With no finalized cursor the world endpoint refuses to serve a frame.
    await client.query('DELETE FROM chain_sync_cursors');
    const noWorld = await app.inject({ method: 'GET', url: '/api/v1/world/frame' });
    expect(noWorld.statusCode).toBe(503);
    expect(errorOf(body(noWorld)).code).toBe('WORLD_NOT_READY');
  });

  it('keeps the manual wallet path available when the LLM is disabled', async () => {
    const provider = {
      async complete(): Promise<string> {
        throw new Error('LLM disabled by operator');
      },
    };

    const plan = await planWithProvider(
      {
        observation: observationFixture,
        profile: { agentId, persona: 'PRAGMATIC', goal: 'BUILD_PUBLIC_GOODS' },
      },
      provider,
    );
    expect(plan.source).toBe('ABSTAIN_FALLBACK');
    expect(plan.action).toMatchObject({
      intent: 'ABSTAIN',
      targetType: 'NONE',
      targetId: null,
      buildAmount: null,
      requiresOwnerApproval: false,
    });

    const context: PolicyContext = {
      agent: { agentId, owner: OWNER, status: 'ACTIVE', allowPublicDiscussion: true },
      sessionOwner: OWNER,
      snapshot: { observation: observationFixture, stale: false },
      actionsThisEpoch: 0,
      maxActionsPerEpoch: 5,
      noteDelegateEnabled: false,
      moderatePublicMessage: () => 'APPROVED',
    };
    expect(validateAction(plan.action, context)).toMatchObject({
      allowed: true,
      mode: 'OFFCHAIN_ONLY',
      executable: true,
    });

    // An ABSTAIN can never become calldata, even if someone records it.
    const abstainIntent = await intentService.create({
      appUserId: APP_USER,
      actionType: 'ABSTAIN',
      targetId: null,
      parameters: {},
      idempotencyKey: 'llm-off-abstain-0001',
    });
    await expect(
      intentService.prepare({ appUserId: APP_USER, intentId: abstainIntent.intent.id }),
    ).rejects.toMatchObject({ code: 'NOT_PREPARABLE' });

    // The owner wallet path does not depend on the model at all.
    const manual = await intentService.create({
      appUserId: APP_USER,
      actionType: 'SUGGEST_CONTRIBUTION',
      targetId: '1',
      parameters: { projectId: '1', amount: '10' },
      idempotencyKey: 'llm-off-manual-0001',
    });
    const prepared = await intentService.prepare({
      appUserId: APP_USER,
      intentId: manual.intent.id,
    });
    expect(prepared).toMatchObject({ chainId: CHAIN_ID, to: CORE, value: '0' });
  });
});
