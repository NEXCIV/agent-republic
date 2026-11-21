import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { decodeFunctionData } from 'viem';
import { CORE_ACTION_ABI, ChainReadError, type ChainReadPort, type TransactionReceipt } from '@agent-republic/chain';
import {
  IntentService,
  buildApiServer,
  type ApiDeps,
  type ApiProjectionReader,
  type IntentRepository,
  type IntentRow,
  type ContributorRow,
  type IdentityProjection,
  type ProposalRow,
  type ProjectRow,
  type SyncStatus,
  type TxLink,
  type VoteTally,
} from '../src/index.js';

/**
 * E2-05 route tests: the API encodes calldata but never signs, and a
 * user-reported txHash is only ever PENDING.
 */

const OWNER = `0x${'ab'.repeat(20)}`;
const APP_USER = '11111111-1111-4111-8111-111111111111';
const INTENT_ID = '33333333-3333-4333-8333-333333333333';
const TX_HASH = `0x${'33'.repeat(32)}`;
const CORE = `0x${'66'.repeat(20)}`;
const NOW = new Date('2026-11-19T08:00:00.000Z');

type JsonRecord = Record<string, unknown>;
const body = (response: { payload: string }): JsonRecord => JSON.parse(response.payload) as JsonRecord;
const asRecord = (value: unknown): JsonRecord => value as JsonRecord;
const errorOf = (payload: JsonRecord): JsonRecord => asRecord(payload.error);

class EmptyReader implements ApiProjectionReader {
  async ping(): Promise<void> {}
  async getSyncStatus(): Promise<SyncStatus> {
    return { state: 'UNKNOWN', finalizedBlock: null, syncedAt: null };
  }
  async listProposals(): Promise<ProposalRow[]> {
    return [];
  }
  async findProposal(): Promise<ProposalRow | null> {
    return null;
  }
  async getProposalVotes(): Promise<VoteTally> {
    return { yes: 0, no: 0, abstain: 0, unclassified: 0 };
  }
  async listProposalTxLinks(): Promise<TxLink[]> {
    return [];
  }
  async findProject(): Promise<ProjectRow | null> {
    return null;
  }
  async listProjects(): Promise<ProjectRow[]> {
    return [];
  }
  async listActivity() {
    return [];
  }
  async getProjectContributors(): Promise<ContributorRow[]> {
    return [];
  }
  async listProjectTxLinks(): Promise<TxLink[]> {
    return [];
  }
  async getIdentityProjection(): Promise<IdentityProjection> {
    return { registered: false, registeredTxHash: null, registeredBlock: null };
  }
}

class FakeChain implements ChainReadPort {
  receipt: TransactionReceipt | null = null;
  receiptFails = false;

  async readCitizenState() {
    throw new Error('not used in intent tests');
  }

  async readTransactionReceipt(): Promise<TransactionReceipt | null> {
    if (this.receiptFails) throw new ChainReadError('RPC_DOWN', 'node unreachable');
    return this.receipt;
  }
}

class MemoryIntentRepository implements IntentRepository {
  owner: string | null = OWNER;
  readonly intents = new Map<string, IntentRow>();
  events: { eventName: string; blockNumber: bigint; status: 'INCLUDED' | 'ORPHANED'; confirmedAtBlock: bigint | null }[] = [];
  intentByTx: IntentRow | null = null;
  finalizedBlock: bigint | null = 100n;
  duplicate: 'NONE' | 'EXISTING' | 'CONFLICT' = 'NONE';
  private counter = 0;

  async resolveOwner(): Promise<string | null> {
    return this.owner;
  }

  async createIntent(input: {
    owner: string;
    actionType: IntentRow['actionType'];
    targetId: string | null;
    parameters: Record<string, unknown>;
    idempotencyKey: string;
  }) {
    if (this.duplicate === 'CONFLICT') return { kind: 'IDEMPOTENCY_CONFLICT' as const };
    if (this.duplicate === 'EXISTING') {
      const existing = [...this.intents.values()][0];
      if (existing !== undefined) return { kind: 'EXISTING' as const, row: existing };
    }
    this.counter += 1;
    const row: IntentRow = {
      id: INTENT_ID,
      owner: input.owner,
      actionType: input.actionType,
      targetId: input.targetId,
      parameters: input.parameters,
      status: 'PROPOSED',
      txHash: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    this.intents.set(row.id, row);
    return { kind: 'CREATED' as const, row };
  }

  async findIntent(id: string, owner: string): Promise<IntentRow | null> {
    const row = this.intents.get(id);
    return row !== undefined && row.owner === owner ? row : null;
  }

  async markPrepared(id: string, owner: string): Promise<IntentRow | null> {
    const row = await this.findIntent(id, owner);
    if (row === null || (row.status !== 'PROPOSED' && row.status !== 'PREPARED')) return null;
    const updated = { ...row, status: 'PREPARED' as const };
    this.intents.set(id, updated);
    return updated;
  }

  async reportSubmission(id: string, owner: string, txHash: string) {
    const row = await this.findIntent(id, owner);
    if (row === null) return { kind: 'NOT_FOUND' as const };
    if (row.txHash !== null && row.txHash !== txHash) return { kind: 'TX_CONFLICT' as const };
    if (row.status !== 'PREPARED' && row.status !== 'SUBMITTED') return { kind: 'STATE_CONFLICT' as const };
    const updated: IntentRow = { ...row, status: 'SUBMITTED', txHash };
    this.intents.set(id, updated);
    return { kind: 'UPDATED' as const, row: updated };
  }

  async findEventsByTx() {
    return this.events;
  }

  async findIntentByTx(): Promise<IntentRow | null> {
    return this.intentByTx;
  }

  async getFinalizedBlock(): Promise<bigint | null> {
    return this.finalizedBlock;
  }
}

const apps: FastifyInstance[] = [];

function makeApp(
  options: {
    owner?: string | null;
    coreAddress?: string | undefined;
    chain?: ChainReadPort | null;
    session?: ApiDeps['session'];
  } = {},
) {
  const repo = new MemoryIntentRepository();
  if (options.owner !== undefined) repo.owner = options.owner;
  const chain = options.chain === undefined ? new FakeChain() : options.chain;
  const intents = new IntentService({
    repo,
    chainId: 56,
    coreAddress: 'coreAddress' in options ? options.coreAddress : CORE,
    chain,
  });
  const deps: ApiDeps = {
    chainId: 56,
    reader: new EmptyReader(),
    chain: null,
    binding: null,
    intents,
    session: options.session ?? (async () => ({ appUserId: APP_USER })),
    now: () => NOW,
  };
  const app = buildApiServer(deps);
  apps.push(app);
  return { app, repo, intents, chain: chain as FakeChain };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const createIntent = (app: FastifyInstance, payload: JsonRecord = { type: 'SUGGEST_VOTE', parameters: { proposalId: '7', choice: 'NO' } }, key = 'idem-key-0001') =>
  app.inject({ method: 'POST', url: '/api/v1/intents', payload, headers: { 'idempotency-key': key } });

describe('POST /api/v1/intents', () => {
  it('requires a session', async () => {
    const { app } = makeApp({ session: async () => null });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: { type: 'OBSERVE' },
      headers: { 'idempotency-key': 'idem-key-0001' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses to act for an unbound account', async () => {
    const { app } = makeApp({ owner: null });
    const response = await createIntent(app);
    expect(response.statusCode).toBe(403);
    expect(errorOf(body(response)).code).toBe('OWNER_NOT_BOUND');
  });

  it('rejects an unknown action type', async () => {
    const { app } = makeApp();
    const response = await createIntent(app, { type: 'TRANSFER_ALL' });
    expect(response.statusCode).toBe(400);
    expect(errorOf(body(response)).code).toBe('INVALID_BODY');
  });

  it('requires an idempotency key', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: { type: 'OBSERVE' },
    });
    expect(response.statusCode).toBe(400);
    expect(errorOf(body(response)).code).toBe('INVALID_BODY');
  });

  it('creates a PROPOSED intent without sending anything', async () => {
    const { app } = makeApp();
    const response = await createIntent(app);
    expect(response.statusCode).toBe(201);
    expect(body(response)).toMatchObject({
      intentId: INTENT_ID,
      status: 'PROPOSED',
      actionType: 'SUGGEST_VOTE',
    });
  });

  it('returns the existing intent for a replayed idempotency key', async () => {
    const { app, repo } = makeApp();
    await createIntent(app);
    repo.duplicate = 'EXISTING';
    const replay = await createIntent(app);
    expect(replay.statusCode).toBe(200);
    expect(body(replay).intentId).toBe(INTENT_ID);
  });

  it('rejects an idempotency key reused for a different intent', async () => {
    const { app, repo } = makeApp();
    repo.duplicate = 'CONFLICT';
    const response = await createIntent(app);
    expect(response.statusCode).toBe(409);
    expect(errorOf(body(response)).code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('POST /api/v1/intents/:id/prepare', () => {
  const url = `/api/v1/intents/${INTENT_ID}/prepare`;

  it('encodes castVote for a SUGGEST_VOTE intent', async () => {
    const { app } = makeApp();
    await createIntent(app);
    const response = await app.inject({ method: 'POST', url, payload: {} });
    expect(response.statusCode).toBe(200);
    const payload = body(response);
    expect(payload).toMatchObject({ intentId: INTENT_ID, status: 'PREPARED', chainId: 56, to: CORE, value: '0' });
    const decoded = decodeFunctionData({ abi: CORE_ACTION_ABI, data: String(payload.data) as `0x${string}` });
    expect(decoded.functionName).toBe('castVote');
    expect(decoded.args).toEqual([7n, 2]); // NO = 2
  });

  it('refuses to prepare an intent that has no on-chain call', async () => {
    const { app } = makeApp();
    await createIntent(app, { type: 'DISCUSS', parameters: {} });
    const response = await app.inject({ method: 'POST', url, payload: {} });
    expect(response.statusCode).toBe(409);
    expect(errorOf(body(response)).code).toBe('NOT_PREPARABLE');
  });

  it('returns NOT_CONFIGURED when CORE_ADDRESS is missing', async () => {
    const { app } = makeApp({ coreAddress: undefined });
    await createIntent(app);
    const response = await app.inject({ method: 'POST', url, payload: {} });
    expect(response.statusCode).toBe(503);
    expect(errorOf(body(response)).code).toBe('NOT_CONFIGURED');
  });

  it('hides an intent that belongs to another owner', async () => {
    const { app, repo } = makeApp();
    await createIntent(app);
    repo.owner = `0x${'cd'.repeat(20)}`;
    const response = await app.inject({ method: 'POST', url, payload: {} });
    expect(response.statusCode).toBe(404);
  });

  it('rejects a non-UUID intent id', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'POST', url: '/api/v1/intents/abc/prepare', payload: {} });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /api/v1/intents/:id/report-submission', () => {
  const url = `/api/v1/intents/${INTENT_ID}/report-submission`;

  it('records the hash as PENDING and never as confirmed', async () => {
    const { app } = makeApp();
    await createIntent(app);
    await app.inject({ method: 'POST', url: `/api/v1/intents/${INTENT_ID}/prepare`, payload: {} });

    const response = await app.inject({ method: 'POST', url, payload: { txHash: TX_HASH } });
    expect(response.statusCode).toBe(200);
    const payload = body(response);
    expect(payload.status).toBe('PENDING');
    expect(String(payload.note)).toContain('not confirmed');
  });

  it('rejects reporting before prepare', async () => {
    const { app } = makeApp();
    await createIntent(app);
    const response = await app.inject({ method: 'POST', url, payload: { txHash: TX_HASH } });
    expect(response.statusCode).toBe(409);
    expect(errorOf(body(response)).code).toBe('INTENT_STATE_CONFLICT');
  });

  it('rejects a malformed tx hash', async () => {
    const { app } = makeApp();
    await createIntent(app);
    const response = await app.inject({ method: 'POST', url, payload: { txHash: '0x1234' } });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/v1/tx/:hash', () => {
  it('is public and reports UNKNOWN for an unseen hash', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: `/api/v1/tx/${TX_HASH}` });
    expect(response.statusCode).toBe(200);
    expect(body(response)).toMatchObject({ status: 'UNKNOWN', source: 'NONE' });
  });

  it('reports PENDING for a user-reported hash with no receipt', async () => {
    const { app, repo } = makeApp();
    const row: IntentRow = {
      id: INTENT_ID,
      owner: OWNER,
      actionType: 'SUGGEST_VOTE',
      targetId: null,
      parameters: {},
      status: 'SUBMITTED',
      txHash: TX_HASH,
      createdAt: NOW,
      updatedAt: NOW,
    };
    repo.intentByTx = row;
    const response = await app.inject({ method: 'GET', url: `/api/v1/tx/${TX_HASH}` });
    expect(body(response)).toMatchObject({ status: 'PENDING', source: 'INTENT' });
  });

  it('reports INCLUDED for a reverted-free receipt without indexed events', async () => {
    const { app, chain } = makeApp();
    chain.receipt = { status: 'SUCCESS', blockNumber: 1234n };
    const response = await app.inject({ method: 'GET', url: `/api/v1/tx/${TX_HASH}` });
    expect(body(response)).toMatchObject({ status: 'INCLUDED', source: 'RPC_RECEIPT' });
  });

  it('reports FAILED when the receipt reverted', async () => {
    const { app, chain } = makeApp();
    chain.receipt = { status: 'REVERTED', blockNumber: 1234n };
    const response = await app.inject({ method: 'GET', url: `/api/v1/tx/${TX_HASH}` });
    expect(body(response)).toMatchObject({ status: 'FAILED', source: 'RPC_RECEIPT' });
  });

  it('reports INCLUDED for indexed-but-unconfirmed events and CONFIRMED once finalized', async () => {
    const { app, repo } = makeApp();
    repo.events = [{ eventName: 'VoteCast', blockNumber: 50n, status: 'INCLUDED', confirmedAtBlock: null }];
    const included = await app.inject({ method: 'GET', url: `/api/v1/tx/${TX_HASH}` });
    expect(body(included)).toMatchObject({ status: 'INCLUDED', source: 'CHAIN_EVENTS' });

    repo.events = [{ eventName: 'VoteCast', blockNumber: 50n, status: 'INCLUDED', confirmedAtBlock: 62n }];
    repo.finalizedBlock = 62n;
    const confirmed = await app.inject({ method: 'GET', url: `/api/v1/tx/${TX_HASH}` });
    expect(body(confirmed)).toMatchObject({ status: 'CONFIRMED' });
  });

  it('never confirms an event above the finalized block', async () => {
    const { app, repo } = makeApp();
    repo.events = [{ eventName: 'VoteCast', blockNumber: 80n, status: 'INCLUDED', confirmedAtBlock: 80n }];
    repo.finalizedBlock = 62n;
    const response = await app.inject({ method: 'GET', url: `/api/v1/tx/${TX_HASH}` });
    expect(body(response)).toMatchObject({ status: 'INCLUDED' });
  });

  it('reports PENDING when the only events were orphaned by a reorg', async () => {
    const { app, repo } = makeApp();
    repo.events = [{ eventName: 'VoteCast', blockNumber: 50n, status: 'ORPHANED', confirmedAtBlock: null }];
    const response = await app.inject({ method: 'GET', url: `/api/v1/tx/${TX_HASH}` });
    expect(body(response)).toMatchObject({ status: 'PENDING' });
  });

  it('rejects a malformed hash', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/tx/0x1234' });
    expect(response.statusCode).toBe(400);
  });
});
