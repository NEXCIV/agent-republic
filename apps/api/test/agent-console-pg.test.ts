import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { worldFrameV1Schema, type CommandMode, type CommandRecord } from '@agent-republic/domain';
import { withFrameId } from '@agent-republic/world-engine';
import type { CommandIdentityReader } from '@agent-republic/chain';
import demoFrame from '../../../examples/world-frame.demo.json';
import { CommandService, readCommandContext } from '../src/agents/commands.js';
import { LocalCommandModel } from '../src/agents/command-model.js';
import { PostgresProjectionReader } from '../src/repositories/postgres.js';
import { PgCommandStore, type CommandScope } from '../src/agents/command-store.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AgentVersionConflictError,
  AgentConsoleService,
  buildApiServer,
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

  describe('private agent commands', () => {
    let commands: PgCommandStore;
    let scope: CommandScope;
    beforeAll(() => { commands = new PgCommandStore(TEST_DATABASE_URL!); });
    afterAll(() => commands?.close());
    beforeEach(async () => {
      const agent = await createAgent(OWNER_A);
      scope = { appUserId: USER_A, owner: OWNER_A, agentId: agent.agentId, configVersion: agent.configVersion };
    });

    const task = (mode: CommandMode = 'EXECUTE', decline: string | null = null) => ({
      request: { requestId: randomUUID(), mode, text: 'Explore the district' },
      plan: { steps: [{ kind: 'REPORT' as const }], decline },
      sourceBlock: '10', worldFrameId: REGISTRY_TX,
    });
    const finish = (row: CommandRecord): CommandRecord => ({
      ...row, status: 'COMPLETED', results: ['District reviewed.'], report: 'District reviewed.',
    });

    it('rechecks the session binding and rejects another agent or changed version', async () => {
      const job = await commands.submit(scope, task());
      const foreign = { ...scope, appUserId: USER_B };
      await expect(commands.list(foreign)).rejects.toMatchObject({ statusCode: 403 });
      await expect(commands.findRequest(foreign, job.requestId)).rejects.toMatchObject({ statusCode: 403 });
      await expect(commands.submit(foreign, task())).rejects.toMatchObject({ statusCode: 403 });
      await expect(commands.advance(foreign, {commandId: job.id, expectedRevision: 1}, finish))
        .rejects.toMatchObject({ statusCode: 403 });
      const {agentId, configVersion} = await createAgent(OWNER_B);
      const other = {owner: OWNER_B, appUserId: USER_B, agentId, configVersion};
      await expect(commands.advance(other, {commandId: job.id, expectedRevision: 1}, finish))
        .rejects.toMatchObject({ statusCode: 404 });
      await expect(commands.list(other)).resolves.toEqual([]);
      await expect(commands.findRequest(other, job.requestId)).resolves.toBeNull();
    });

    it('replays identical submissions, rejects key reuse and serializes competing launches and steps', async () => {
      const input = task();
      const [first, duplicate] = await Promise.all([commands.submit(scope, input), commands.submit(scope, input)]);
      expect(first.id).toBe(duplicate.id);
      await expect(commands.submit(scope, { ...input, request: {...input.request, text: 'Inspect council'} }))
        .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      await expect(commands.submit(scope, task())).rejects.toMatchObject({ statusCode: 409 });
      await expect(commands.submit(scope, task('SUGGEST'))).rejects.toMatchObject({ statusCode: 409 });
      const ticket = { commandId: first.id, expectedRevision: first.revision };
      const attempts = await Promise.allSettled([
        commands.advance(scope, ticket, finish), commands.advance(scope, ticket, finish),
      ]);
      expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
      expect((await commands.list(scope))[0]).toMatchObject({ status: 'COMPLETED', revision: 2 });
    });

    it('resumes the innermost interrupted task after completion and leaves it running on declined interrupt', async () => {
      const original = await commands.submit(scope, task());
      await commands.submit(scope, task('INTERRUPT', 'Unknown destination.'));
      expect((await commands.list(scope)).find((row) => row.id === original.id)?.status).toBe('RUNNING');
      const nested = await commands.submit(scope, task('INTERRUPT'));
      const last = await commands.submit(scope, task('INTERRUPT'));
      await commands.advance(scope, {commandId: last.id, expectedRevision: 1}, finish);
      const middle = (await commands.list(scope)).find((row) => row.id === nested.id)!;
      expect(middle).toMatchObject({status: 'RUNNING', revision: 3});
      await commands.advance(scope, {commandId: middle.id, expectedRevision: middle.revision}, finish);
      expect((await commands.list(scope)).find((row) => row.id === original.id)?.status).toBe('RUNNING');
    });

    it('a paused or replaced configuration stops the scheduler and retains private history', async () => {
      const original = await commands.submit(scope, task());
      const top = await commands.submit(scope, task('INTERRUPT'));
      const pending = await commands.pending(5);
      expect(pending).toEqual([{scope, commandId: top.id, expectedRevision: top.revision}]);
      // Another scheduler may process a different owner while this attempt is in flight.
      await expect(commands.pending(5)).resolves.toEqual([]);
      await repo.setPaused(OWNER_A, true);
      await expect(commands.findRequest(scope, original.requestId)).resolves.toMatchObject({ id: original.id, status: 'FAILED' });
      await expect(commands.advance(scope, {commandId: original.id, expectedRevision: 1}, finish))
        .rejects.toMatchObject({ statusCode: 409 });
      const resumed = (await repo.setPaused(OWNER_A, false))!;
      const current = { ...scope, configVersion: resumed.configVersion };
      expect((await commands.list(current)).map((row) => row.status)).toEqual(['FAILED','FAILED']);
      const active = await commands.submit(current, task());
      await repo.saveConfig({ owner: OWNER_A, name: 'Next', persona: 'PRAGMATIC', goal: 'DEFEND_RULES',
        expectedVersion: current.configVersion });
      await expect(commands.advance(current, {commandId: active.id, expectedRevision: 1}, finish))
        .rejects.toMatchObject({ statusCode: 409 });
      await expect(commands.pending(5)).resolves.toEqual([]);
    });

    it('reclaims abandoned work after restart, gives the next owner a turn, and rolls back a failed step', async () => {
      const first = await commands.submit(scope, { ...task(), sourceBlockHash: REGISTRY_TX });
      const otherAgent = await createAgent(OWNER_B);
      const other = { appUserId: USER_B, owner: OWNER_B, agentId: otherAgent.agentId, configVersion: 1 };
      const second = await commands.submit(other, task());
      const restarted = new PgCommandStore(TEST_DATABASE_URL!);
      try {
        const firstTicket = { commandId: first.id, expectedRevision: 1 };
        const expectedClaim = { scope, ...firstTicket, sourceBlock: '10', sourceBlockHash: REGISTRY_TX };
        await expect(commands.pending(1)).resolves.toEqual([expectedClaim]);
        await expect(restarted.pending(1)).resolves.toEqual([
          { scope: other, commandId: second.id, expectedRevision: 1 },
        ]);
        await expect(restarted.advance(scope, firstTicket, () => { throw new Error('step failed'); }))
          .rejects.toThrow('step failed');
        expect((await restarted.list(scope))[0]).toMatchObject({ status: 'RUNNING', revision: 1, results: [] });
        // Expire only the first lease, as if the old server stopped after claiming it.
        await client.query('UPDATE agent_commands SET next_attempt_at = now() WHERE id = $1', [first.id]);
        await expect(restarted.pending(1)).resolves.toEqual([expectedClaim]);
        const outcome = await restarted.advance(scope, firstTicket, (row) => ({
          ...finish(row), sourceBlock: '11', sourceBlockHash: `0x${'33'.repeat(32)}`, worldFrameId: `0x${'22'.repeat(32)}`,
        }));
        expect((await commands.list(scope))[0]).toEqual(outcome);
        expect(outcome).toMatchObject({ status: 'COMPLETED', revision: 2, sourceBlock: '11', sourceBlockHash: `0x${'33'.repeat(32)}` });
      } finally {
        await restarted.close();
      }
    });

    it('reserves local model calls once per step and atomically enforces actor and platform UTC-day limits', async () => {
      const second = await createAgent(OWNER_B);
      const call = (agentId: string, kind: 'MAIN_DECISION' | 'DEBATE_REPLY', key: string, cap = 6) =>
        commands.reserveModelCall({ agentId, kind, requestKey: key, model: 'local-test', maxDailyCalls: cap });
      const main = await Promise.all([call(scope.agentId, 'MAIN_DECISION', 'a'), call(scope.agentId, 'MAIN_DECISION', 'b')]);
      expect(main.filter(Boolean)).toHaveLength(1);
      const duplicate = await Promise.all([
        call(scope.agentId, 'DEBATE_REPLY', 'same'), call(scope.agentId, 'DEBATE_REPLY', 'same'),
      ]);
      expect(duplicate.filter(Boolean)).toHaveLength(1);
      const replies = await Promise.all(Array.from({ length: 5 }, (_, i) => call(scope.agentId, 'DEBATE_REPLY', String(i))));
      expect(replies.filter(Boolean)).toHaveLength(3);
      const global = await Promise.all([
        call(second.agentId, 'MAIN_DECISION', 'one'), call(second.agentId, 'DEBATE_REPLY', 'two'),
      ]);
      expect(global.filter(Boolean)).toHaveLength(1);
      await client.query("UPDATE llm_usage SET created_at = date_trunc('day', now(), 'UTC') - interval '1 microsecond'");
      await expect(call(scope.agentId, 'DEBATE_REPLY', 'same')).resolves.toBe(false);
      await expect(call(scope.agentId, 'MAIN_DECISION', 'next-day')).resolves.toBe(true);
      await repo.setPaused(OWNER_B, true);
      await expect(call(second.agentId, 'DEBATE_REPLY', 'paused-peer')).resolves.toBe(false);
    });

    it('drops an in-flight private reply when its recipient has been paused', async () => {
      const recipient = await createAgent(OWNER_B);
      const job = await commands.submit(scope, {
        ...task(), plan: { steps: [{ kind: 'DISCUSS', targetAgentId: recipient.agentId }], decline: null },
      });
      await repo.setPaused(OWNER_B, true);
      const result = await commands.advance(scope, { commandId: job.id, expectedRevision: 1 }, (row) => ({
        ...row, status: 'COMPLETED', results: ['A stale simulated reply.'], report: 'A stale simulated reply.',
      }));
      expect(result.status).toBe('FAILED');
      expect(result.report).toMatch(/unavailable/i);
      expect(result.results).toEqual([result.report]);
    });

    it('starts a resumed visit at the location reached by the interrupt', async () => {
      const original = await commands.submit(scope, { ...task(), plan: { decline: null, steps: [
        { kind: 'VISIT', location: 'COUNCIL' }, { kind: 'VISIT', location: 'CORE' }, { kind: 'REPORT' },
      ] } });
      const move = (row: CommandRecord): CommandRecord => ({ ...row, results: [...row.results, 'Visited.'] });
      await commands.advance(scope, { commandId: original.id, expectedRevision: 1 }, move);
      const diversion = await commands.submit(scope, { ...task('INTERRUPT'), plan: { decline: null, steps: [
        { kind: 'VISIT', location: 'IDENTITY' }, { kind: 'REPORT' },
      ] } });
      expect(diversion.steps[0]).toMatchObject({ from: 'COUNCIL' });
      await commands.advance(scope, { commandId: diversion.id, expectedRevision: 1 }, move);
      await commands.advance(scope, { commandId: diversion.id, expectedRevision: 2 }, (row) => ({
        ...row, status: 'COMPLETED', report: 'Visit reported.', results: [...row.results, 'Visit reported.'],
      }));
      const resumed = (await commands.list(scope)).find((row) => row.id === original.id)!;
      expect(resumed.steps[0]).toMatchObject({ from: 'PLAZA', location: 'COUNCIL' });
      expect(resumed.steps[1]).toMatchObject({ from: 'IDENTITY', location: 'CORE' });
    });

    it('executes a private owner command across an API restart and returns the invited agent’s counterproposal', async () => {
      const peer = await createAgent(OWNER_B, 'Nova');
      const ids = [scope.agentId, peer.agentId];
      const frame = withFrameId(worldFrameV1Schema.parse({
        ...demoFrame,
        society: { ...demoFrame.society, agentSummaries: demoFrame.society.agentSummaries.map((entry, i) => ({
          ...entry, agentId: ids[i], owner: [OWNER_A, OWNER_B][i], displayName: ['Archivist', 'Nova'][i],
          persona: 'PRAGMATIC',
        })) },
        simulation: { ...demoFrame.simulation, agents: demoFrame.simulation.agents.map((entry, i) => ({
          ...entry, agentId: ids[i],
        })) },
      }));
      const chain: CommandIdentityReader = {
        readCanonicalHash: async () => frame.source.blockHash,
        readCommandIdentity: async (owner, block) => ({
          registered: true, hasAgentId: true, eligibleNow: owner === OWNER_A,
          networkBlockNumber: block + 12n, blockHash: frame.source.blockHash, build: 100n, rep: 0n,
        }),
      };
      const reader = new PostgresProjectionReader(TEST_DATABASE_URL!);
      const agents = new AgentConsoleService(repo);
      const opinion = 'I would try the smaller workshop first.';
      const startApi = (store: PgCommandStore) => {
        // The model server and mainnet are the only external systems replaced here.
        const model = new LocalCommandModel('test-model', 4, (call) => store.reserveModelCall(call), async (url, init) => {
          if (String(url).endsWith('/show')) return Response.json({ model_info: { 'general.architecture': 'test' } });
          const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
          const prompt = JSON.parse(body.messages[1]!.content) as { task?: string; persona?: string };
          const output = prompt.task ? { steps: [
            { kind: 'VISIT', location: 'PROJECT' }, { kind: 'DISCUSS', targetAgentId: peer.agentId, subject: 'PROJECTS' },
          ] } : { decision: 'COUNTER', opinion };
          return Response.json({ done: true, message: { content: JSON.stringify(output) } });
        });
        const service = new CommandService(agents, store, (actor) =>
          readCommandContext(actor, { getFrame: async () => frame }, chain), model, chain.readCanonicalHash);
        const app = buildApiServer({
          chainId: 56, chain: null, reader, agents, commands: service,
          session: async (request) => {
            const session = request.headers['x-test-session'];
            return session === USER_A || session === USER_B ? { appUserId: session } : null;
          },
        });
        return { app, service };
      };
      const url = '/api/v1/my-agent/commands';
      const ownerHeaders = { 'x-test-session': USER_A };
      const stepsFailed = (error: unknown) => { throw error; };
      const request = { requestId: randomUUID(), mode: 'EXECUTE', text: 'Visit the workshop, then sound Nova out on a smaller workshop.' };
      let server = startApi(commands);
      const restarted = new PgCommandStore(TEST_DATABASE_URL!);
      try {
        expect((await server.app.inject({ method: 'POST', url, payload: request })).statusCode).toBe(401);
        const denied = await server.app.inject({ method: 'POST', url, headers: { 'x-test-session': USER_B }, payload: request });
        expect(denied.statusCode).toBe(403);
        const sent = await server.app.inject({ method: 'POST', url, headers: ownerHeaders, payload: request });
        expect(sent.statusCode).toBe(200);
        expect(sent.json().data.steps.map((step: { kind: string }) => step.kind)).toEqual(['VISIT', 'DISCUSS', 'REPORT']);
        await server.service.dispatch(stepsFailed);
        await server.app.close();
        server = startApi(restarted);
        await server.service.dispatch(stepsFailed);
        await server.service.dispatch(stepsFailed);
        const history = await server.app.inject({ method: 'GET', url, headers: ownerHeaders });
        const [completed] = history.json<{ data: CommandRecord[] }>().data;
        expect(history.json().source).toBe('AI_SIMULATED');
        expect(completed).toMatchObject({ id: sent.json().data.id, status: 'COMPLETED', revision: 4 });
        expect(completed?.results[1]).toContain('COUNTER');
        expect(completed?.report).toContain(opinion);
        expect((await server.app.inject({ method: 'GET', url, headers: { 'x-test-session': USER_B } })).json().data).toEqual([]);
        const usage = await client.query('SELECT agent_id, call_kind FROM llm_usage ORDER BY created_at');
        expect(usage.rows).toEqual([
          { agent_id: scope.agentId, call_kind: 'MAIN_DECISION' },
          { agent_id: peer.agentId, call_kind: 'DEBATE_REPLY' },
        ]);
      } finally {
        await server.app.close();
        await restarted.close();
        await reader.close();
      }
    });
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
