import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { encodeContribution, normalizeLog } from '@agent-republic/chain';
import { SCENE_VERSION, type WorldFrameV1 } from '@agent-republic/domain';
import {
  buildAgentObservation,
  planRuleBased,
  validateAction,
  type PolicyContext,
} from '@agent-republic/agent-engine';
import {
  AgentConsoleService,
  BindingService,
  IntentService,
  PostgresAgentConsoleRepository,
  PostgresBindingRepository,
  PostgresIntentRepository,
  PostgresProjectionReader,
  PostgresWorldReader,
  WorldService,
  buildApiServer,
} from '../../apps/api/src/index.js';
import { ChainIndexerStore, type BlockRef } from '../../apps/worker/src/index.js';
import { toProjectStageView } from '../../apps/web/src/features/world-3d/adapters/projectStage.js';

/**
 * E7-01 — one end-to-end evidence chain over the real stack.
 *
 *   finalized CitizenRegistered → verified owner binding
 *   → agent console config → WorldFrame read at a finalized block
 *   → rule-based AI suggestion → deterministic policy (AWAITING_OWNER)
 *   → intent PROPOSED → PREPARED calldata → SUBMITTED (PENDING)
 *   → indexer confirms ContributionMade → intent CONFIRMED
 *   → WorldFrame facts update → 3D stage FOUNDATION → FRAME
 *
 * Failure states are asserted with the same pipeline: a reported but
 * unconfirmed tx stays PENDING and cannot move the building; a reorg above
 * finality orphans the event and reverts both the intent and the 3D stage.
 *
 * This is an integration test: the chain input is a deterministic fixture
 * standing in for an RPC. It is NOT a mainnet transaction and never claims to
 * be one. Real wallet evidence still requires Gate A (AGENTS.md §2, §8).
 */

const BASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));

const CHAIN_ID = 56 as const;
const APP_USER = '11111111-1111-4111-8111-111111111111';
const OWNER = `0x${'a1'.repeat(20)}`;
const OTHER_OWNER = `0x${'b2'.repeat(20)}`;
const REGISTRY = `0x${'55'.repeat(20)}`;
const CORE = `0x${'22'.repeat(20)}`;
const CONFIG_HASH = `0x${'77'.repeat(32)}`;
const NOW = new Date('2026-11-20T08:00:00.000Z');
const H = (seed: number): string => `0x${seed.toString(16).padStart(64, '0')}`;
const REGISTRATION_TX = H(1001);
const CONTRIBUTION_TX = H(1004);

function evidenceDatabaseUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_e2e`;
  return url.toString();
}

const TEST_DATABASE_URL = BASE_URL === undefined ? undefined : evidenceDatabaseUrl(BASE_URL);
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

describeWithDb('E7-01 evidence chain (PostgreSQL + API + world + 3D adapter)', () => {
  let client: Client;
  let store: ChainIndexerStore;
  let bindingService: BindingService;
  let consoleRepo: PostgresAgentConsoleRepository;
  let consoleService: AgentConsoleService;
  let intentService: IntentService;
  let worldService: WorldService;
  let app!: FastifyInstance;
  let projection: PostgresProjectionReader;
  let intentRepo: PostgresIntentRepository;
  let bindingRepo: PostgresBindingRepository;
  let worldReader: PostgresWorldReader;

  beforeAll(async () => {
    await prepareDatabase(TEST_DATABASE_URL!);
    client = new Client({ connectionString: TEST_DATABASE_URL! });
    await client.connect();

    store = new ChainIndexerStore(TEST_DATABASE_URL!);
    bindingRepo = new PostgresBindingRepository(TEST_DATABASE_URL!);
    bindingService = new BindingService({
      repo: bindingRepo,
      chainId: CHAIN_ID,
      registryAddress: REGISTRY,
      now: () => NOW,
      generateNonce: () => H(9001),
    });
    consoleRepo = new PostgresAgentConsoleRepository(TEST_DATABASE_URL!);
    consoleService = new AgentConsoleService(consoleRepo);
    intentRepo = new PostgresIntentRepository(TEST_DATABASE_URL!);
    intentService = new IntentService({
      repo: intentRepo,
      chainId: CHAIN_ID,
      coreAddress: CORE,
      chain: null,
    });
    worldReader = new PostgresWorldReader(TEST_DATABASE_URL!);
    worldService = new WorldService({
      reader: worldReader,
      chainId: CHAIN_ID,
      confirmedDepth: 12,
    });
    projection = new PostgresProjectionReader(TEST_DATABASE_URL!);
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([
      client?.end(),
      store?.close(),
      bindingRepo?.close(),
      consoleRepo?.close(),
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
      `INSERT INTO world_scene_versions (scene_version, manifest_hash) VALUES ($1, 'sha256:e2e')`,
      [SCENE_VERSION],
    );
    await client.query(`INSERT INTO social_revisions (revision, reason) VALUES (1, 'e2e')`);
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

  const getMyAgent = async (): Promise<JsonRecord> => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/my-agent' });
    expect(response.statusCode).toBe(200);
    return asRecord(body(response).data);
  };

  const getWorldFrame = async (): Promise<JsonRecord> => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/world/frame' });
    expect(response.statusCode).toBe(200);
    return body(response);
  };

  const getTxStatus = async (txHash: string): Promise<JsonRecord> => {
    const response = await app.inject({ method: 'GET', url: `/api/v1/tx/${txHash}` });
    expect(response.statusCode).toBe(200);
    return body(response);
  };

  const onlyProject = (frame: JsonRecord): JsonRecord => {
    const facts = asRecord(frame.facts);
    const projects = facts.projects as JsonRecord[];
    expect(projects).toHaveLength(1);
    return projects[0]!;
  };

  const stageOf = (project: JsonRecord) =>
    toProjectStageView({
      fundedBuild: String(project.fundedBuild),
      goalBuild: String(project.goalBuild),
      state: project.status as 'FUNDING' | 'COMPLETED',
    });

  it('carries one event from a confirmed registration to a confirmed 3D stage', async () => {
    await resetDatabase();

    // 1. Owner registration: the challenge commitment becomes the finalized
    //    CitizenRegistered payload, exactly like the wallet-signed event.
    const challenge = await bindingService.createChallenge({
      appUserId: APP_USER,
      owner: OWNER,
      agentConfigHash: CONFIG_HASH,
    });

    const batch1 = await applyBatch({
      blocks: Array.from({ length: 9 }, (_, index) => block(100 + index)),
      events: [
        normalizeLog(CHAIN_ID, {
          blockNumber: 100n,
          blockHash: H(100),
          transactionHash: REGISTRATION_TX,
          logIndex: 0,
          address: REGISTRY,
          eventName: 'CitizenRegistered',
          args: { owner: OWNER, commitment: challenge.commitment },
        }),
        normalizeLog(CHAIN_ID, {
          blockNumber: 101n,
          blockHash: H(101),
          transactionHash: H(1002),
          logIndex: 0,
          address: CORE,
          eventName: 'ProjectCreated',
          args: { projectId: 1n, titleHash: H(910), goal: 2000n, genesis: true },
        }),
        // Existing confirmed funding from another citizen: 24% of the goal.
        normalizeLog(CHAIN_ID, {
          blockNumber: 102n,
          blockHash: H(102),
          transactionHash: H(1003),
          logIndex: 0,
          address: CORE,
          eventName: 'ContributionMade',
          args: { owner: OTHER_OWNER, projectId: 1n, amount: 480n, fundedAfter: 480n },
        }),
      ],
      headBlock: 120n,
    });
    expect(batch1.finalizedBlock).toBe(108n);

    const verified = await bindingService.verify({
      appUserId: APP_USER,
      owner: OWNER,
      txHash: REGISTRATION_TX,
      challengeId: challenge.challengeId,
    });
    expect(verified).toMatchObject({ bindingState: 'BOUND', owner: OWNER });

    // 2. Agent console: one ACTIVE agent, owner derived from the binding.
    const saved = await consoleService.updateConfig(APP_USER, {
      name: 'Archivist',
      persona: 'PRAGMATIC',
      goal: 'BUILD_PUBLIC_GOODS',
    });
    expect(saved).toMatchObject({ configVersion: 1, status: 'ACTIVE' });

    // World rows: one deterministic tick based on the current finalized block.
    await client.query(
      `INSERT INTO world_ticks (scene_version, tick, base_block, social_revision, frame_id)
       VALUES ($1, 5, 108, 1, $2)`,
      [SCENE_VERSION, H(5000)],
    );
    await client.query(
      `INSERT INTO world_sim_states (scene_version, tick, state_json, state_hash)
       VALUES ($1, 5, $2, 'state-hash-e2e')`,
      [
        SCENE_VERSION,
        JSON.stringify({
          tick: '5',
          worldSeed: 'e2e-seed',
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
       VALUES ($1, 5, 'CHAIN_CONFIRMED', $2, 'MILESTONE', $3)`,
      [
        SCENE_VERSION,
        `${REGISTRATION_TX}:0`,
        JSON.stringify({ id: 'e7-registration', targetId: 'IDENTITY', happenedAtTick: '5' }),
      ],
    );

    app = buildApiServer({
      chainId: CHAIN_ID,
      reader: projection,
      chain: null,
      intents: intentService,
      agents: consoleService,
      world: worldService,
      session: async () => ({ appUserId: APP_USER }),
    });

    const consoleView = await getMyAgent();
    expect(consoleView).toMatchObject({ owner: OWNER, status: 'ACTIVE', configVersion: 1 });
    expect(consoleView.recentActions).toEqual([]);

    // 3. WorldFrame → observation. Self state is read at the SAME block.
    const frameJson = await getWorldFrame();
    const frame = frameJson as unknown as WorldFrameV1;
    expect(frame.source.sync).toBe('LIVE');
    expect(frame.source.blockNumber).toBe('108');

    const observation = buildAgentObservation(
      frame,
      {
        owner: OWNER,
        blockNumber: frame.source.blockNumber,
        blockHash: frame.source.blockHash,
        hasAgentId: true,
        registered: true,
        build: '100',
        rep: '0',
      },
      { networkBlockNumber: frame.source.blockNumber },
    );
    expect(observation.chainRecentEventIds).toContain(`${REGISTRATION_TX}:0`);
    expect(observation.facts.projects[0]).toMatchObject({ fundedBuild: '480', status: 'FUNDING' });

    // 4. Deterministic planner + policy: a suggestion that can only wait for
    //    the owner wallet. No signing, no submission.
    const plan = planRuleBased({
      observation,
      profile: { agentId: saved.agentId, persona: 'PRAGMATIC', goal: 'BUILD_PUBLIC_GOODS' },
    });
    expect(plan.source).toBe('RULE_BASED');
    expect(plan.action).toMatchObject({
      owner: OWNER,
      agentId: saved.agentId,
      intent: 'SUGGEST_CONTRIBUTION',
      targetType: 'PROJECT',
      targetId: '1',
      buildAmount: '50',
      requiresOwnerApproval: true,
    });

    const policyContext: PolicyContext = {
      agent: { agentId: saved.agentId, owner: OWNER, status: 'ACTIVE', allowPublicDiscussion: true },
      sessionOwner: OWNER,
      snapshot: { observation, stale: false },
      actionsThisEpoch: 0,
      maxActionsPerEpoch: 5,
      noteDelegateEnabled: false,
      moderatePublicMessage: () => 'APPROVED',
    };
    expect(validateAction(plan.action, policyContext)).toMatchObject({
      allowed: true,
      mode: 'AWAITING_OWNER',
      executable: false,
    });
    // Failure states stay explicit: wrong owner and unaffordable amounts never
    // become intents.
    expect(validateAction({ ...plan.action, owner: OTHER_OWNER }, policyContext)).toMatchObject({
      allowed: false,
      code: 'OWNER_MISMATCH',
    });
    expect(validateAction({ ...plan.action, buildAmount: '500' }, policyContext)).toMatchObject({
      allowed: false,
      code: 'AMOUNT_EXCEEDS_BALANCE',
    });

    // 5. Intent lifecycle through the HTTP API.
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/intents',
      headers: { 'idempotency-key': 'e7-01-contribution-0001' },
      payload: {
        type: plan.action.intent,
        targetId: plan.action.targetId,
        parameters: { projectId: '1', amount: plan.action.buildAmount },
      },
    });
    expect(created.statusCode).toBe(201);
    const intentId = String(body(created).intentId);

    const prepared = await app.inject({
      method: 'POST',
      url: `/api/v1/intents/${intentId}/prepare`,
      payload: {},
    });
    expect(prepared.statusCode).toBe(200);
    const preparedBody = body(prepared);
    expect(preparedBody).toMatchObject({ chainId: CHAIN_ID, to: CORE, value: '0' });
    expect(preparedBody.data).toBe(encodeContribution({ projectId: 1n, amount: 50n }));

    const reported = await app.inject({
      method: 'POST',
      url: `/api/v1/intents/${intentId}/report-submission`,
      payload: { txHash: CONTRIBUTION_TX },
    });
    expect(reported.statusCode).toBe(200);
    expect(body(reported)).toMatchObject({ status: 'PENDING', txHash: CONTRIBUTION_TX });

    // Pending is not success: tx stays PENDING, the building does not move.
    expect(await getTxStatus(CONTRIBUTION_TX)).toMatchObject({
      status: 'PENDING',
      source: 'INTENT',
    });
    const pendingProject = onlyProject(await getWorldFrame());
    expect(pendingProject.fundedBuild).toBe('480');
    expect(stageOf(pendingProject)).toMatchObject({
      stage: 'FOUNDATION',
      progressBasisPoints: 2400,
      complete: false,
    });
    const pendingActions = (await getMyAgent()).recentActions as JsonRecord[];
    expect(pendingActions[0]).toMatchObject({ status: 'SUBMITTED', txHash: CONTRIBUTION_TX });

    // 6. The indexer receives the finalized ContributionMade event.
    const batch2 = await applyBatch({
      blocks: Array.from({ length: 12 }, (_, index) => block(109 + index)),
      events: [
        normalizeLog(CHAIN_ID, {
          blockNumber: 118n,
          blockHash: H(118),
          transactionHash: CONTRIBUTION_TX,
          logIndex: 0,
          address: CORE,
          eventName: 'ContributionMade',
          args: { owner: OWNER, projectId: 1n, amount: 50n, fundedAfter: 530n },
        }),
      ],
      headBlock: 132n,
    });
    expect(batch2.reorg).toBeNull();
    expect(batch2.confirmedEvents).toBeGreaterThanOrEqual(1);

    await client.query(
      `INSERT INTO world_visual_events (scene_version, tick, origin, source_id, kind, payload)
       VALUES ($1, 5, 'CHAIN_CONFIRMED', $2, 'MILESTONE', $3)`,
      [
        SCENE_VERSION,
        `${CONTRIBUTION_TX}:0`,
        JSON.stringify({ id: 'e7-contribution', targetId: 'project:1', happenedAtTick: '5' }),
      ],
    );

    expect(await getTxStatus(CONTRIBUTION_TX)).toMatchObject({
      status: 'CONFIRMED',
      source: 'CHAIN_EVENTS',
    });
    const confirmedProject = onlyProject(await getWorldFrame());
    expect(confirmedProject).toMatchObject({ fundedBuild: '530', goalBuild: '2000', status: 'FUNDING' });
    expect(stageOf(confirmedProject)).toMatchObject({
      stage: 'FRAME',
      progressBasisPoints: 2650,
      complete: false,
    });
    const confirmedActions = (await getMyAgent()).recentActions as JsonRecord[];
    expect(confirmedActions[0]).toMatchObject({ status: 'CONFIRMED', txHash: CONTRIBUTION_TX });

    // 7. A reorg above finality orphans the event: intent, tx status and the
    //    3D stage all revert together instead of keeping a false success.
    const batch3 = await applyBatch({
      blocks: Array.from({ length: 14 }, (_, index) => block(117 + index, 5000 + index)),
      events: [],
      headBlock: 125n,
    });
    expect(batch3.reorg).toMatchObject({ fromBlock: 117n });

    const reorgedTx = await getTxStatus(CONTRIBUTION_TX);
    expect(reorgedTx).toMatchObject({ status: 'PENDING', source: 'CHAIN_EVENTS' });
    expect(String(reorgedTx.note)).toContain('orphaned');

    const reorgedFrame = await getWorldFrame();
    expect(asRecord(reorgedFrame.source).sync).toBe('REORG_RECOVERY');
    const reorgedProject = onlyProject(reorgedFrame);
    expect(reorgedProject.fundedBuild).toBe('480');
    expect(stageOf(reorgedProject)).toMatchObject({
      stage: 'FOUNDATION',
      progressBasisPoints: 2400,
      complete: false,
    });
    const reorgedActions = (await getMyAgent()).recentActions as JsonRecord[];
    expect(reorgedActions[0]).toMatchObject({ status: 'SUBMITTED', txHash: CONTRIBUTION_TX });
  });
});
