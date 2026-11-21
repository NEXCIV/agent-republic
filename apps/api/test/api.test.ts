import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ChainReadError, type ChainReadPort, type CitizenChainState } from '@agent-republic/chain';
import { buildApiServer, type ApiDeps } from '../src/index.js';
import type {
  ApiProjectionReader,
  ContributorRow,
  IdentityProjection,
  ProposalRow,
  ProjectRow,
  SyncStatus,
  TxLink,
  VoteTally,
} from '../src/index.js';

/**
 * E2-03 route tests. The projection and chain ports are stubbed so error
 * paths (bad input, RPC down, DB down) are deterministic and no network or
 * database is required in CI.
 */

const ADDRESS = `0x${'ab'.repeat(20)}`;
const OWNER = `0x${'cd'.repeat(20)}`;
const HASH = `0x${'11'.repeat(32)}`;
const NOW = new Date('2026-11-19T08:00:00.000Z');

type JsonRecord = Record<string, unknown>;

const body = (response: { payload: string }): JsonRecord => JSON.parse(response.payload) as JsonRecord;
const asRecord = (value: unknown): JsonRecord => value as JsonRecord;
const dataOf = (payload: JsonRecord): JsonRecord => asRecord(payload.data);
const errorOf = (payload: JsonRecord): JsonRecord => asRecord(payload.error);

const proposal: ProposalRow = {
  chainProposalId: '7',
  owner: OWNER,
  contentHash: HASH,
  deadline: new Date('2026-11-21T08:00:00.000Z'),
  status: 'OPEN',
  createdAt: NOW,
  updatedAt: NOW,
};

const project: ProjectRow = {
  chainProjectId: '1',
  name: 'Golden Toilet Tower',
  goalBuild: '2000',
  fundedBuild: '0',
  state: 'FUNDING',
  createdAt: NOW,
  updatedAt: NOW,
};

class FakeReader implements ApiProjectionReader {
  failEverything = false;
  sync: SyncStatus = { state: 'SYNCED', finalizedBlock: 1234n, syncedAt: NOW };
  proposals: ProposalRow[] = [proposal];
  project: ProjectRow | null = project;
  votes: VoteTally = { yes: 3, no: 1, abstain: 0, unclassified: 0 };
  txLinks: TxLink[] = [{ txHash: HASH, eventName: 'ProposalSubmitted', blockNumber: '1200' }];
  contributors: ContributorRow[] = [{ owner: OWNER, amount: '150' }];
  identity: IdentityProjection = { registered: true, registeredTxHash: HASH, registeredBlock: '1100' };

  private guard(): void {
    if (this.failEverything) throw new Error('connection refused');
  }

  async ping(): Promise<void> {
    this.guard();
  }

  async getSyncStatus(): Promise<SyncStatus> {
    this.guard();
    return this.sync;
  }

  async listProposals(status?: ProposalRow['status']): Promise<ProposalRow[]> {
    this.guard();
    return status === undefined ? this.proposals : this.proposals.filter((row) => row.status === status);
  }

  async findProposal(id: string): Promise<ProposalRow | null> {
    this.guard();
    return this.proposals.find((row) => row.chainProposalId === id) ?? null;
  }

  async getProposalVotes(): Promise<VoteTally> {
    this.guard();
    return this.votes;
  }

  async listProposalTxLinks(): Promise<TxLink[]> {
    this.guard();
    return this.txLinks;
  }

  async findProject(id: string): Promise<ProjectRow | null> {
    this.guard();
    return this.project?.chainProjectId === id ? this.project : null;
  }

  async listProjects(): Promise<ProjectRow[]> {
    this.guard();
    return this.project === null ? [] : [this.project];
  }

  async listActivity() {
    this.guard();
    return [
      {
        txHash: HASH,
        logIndex: 0,
        blockNumber: '1200',
        eventName: 'ContributionMade',
        owner: OWNER,
        confirmedAtBlock: '1234',
      },
    ];
  }

  async getProjectContributors(): Promise<ContributorRow[]> {
    this.guard();
    return this.contributors;
  }

  async listProjectTxLinks(): Promise<TxLink[]> {
    this.guard();
    return this.txLinks;
  }

  async getIdentityProjection(): Promise<IdentityProjection> {
    this.guard();
    return this.identity;
  }
}

const chainState: CitizenChainState = { hasAgentId: true, build: 120n, rep: 5n, registered: true };

class FakeChain implements ChainReadPort {
  fail = false;

  async readCitizenState(): Promise<CitizenChainState> {
    if (this.fail) throw new ChainReadError('RPC_DOWN', 'node unreachable');
    return chainState;
  }

  async readTransactionReceipt() {
    return null;
  }
}

const apps: FastifyInstance[] = [];

function makeApp(overrides: Partial<ApiDeps> = {}) {
  const reader = new FakeReader();
  const chain = new FakeChain();
  const app = buildApiServer({
    chainId: 56,
    reader,
    chain,
    now: () => NOW,
    staleAfterSeconds: 300,
    ...overrides,
  });
  apps.push(app);
  return { app, reader, chain };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('health', () => {
  it('reports liveness without touching dependencies', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(body(response)).toMatchObject({ status: 'ok', chainId: 56 });
  });

  it('returns 503 DB_UNAVAILABLE when the database is down', async () => {
    const { app, reader } = makeApp();
    reader.failEverything = true;
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(errorOf(body(response)).code).toBe('DB_UNAVAILABLE');
  });

  it('marks the chain as NOT_CONFIGURED instead of faking an RPC', async () => {
    const { app } = makeApp({ chain: null });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(body(response)).toMatchObject({ chain: 'NOT_CONFIGURED' });
  });
});

describe('GET /api/v1/identity/:address', () => {
  it('rejects a malformed address with INVALID_ADDRESS', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/identity/0xABC' });
    expect(response.statusCode).toBe(400);
    const payload = body(response);
    const error = errorOf(payload);
    expect(error.code).toBe('INVALID_ADDRESS');
    expect(error.requestId).toBeTruthy();
    expect(response.headers['x-request-id']).toBe(error.requestId);
  });

  it('fails closed with RPC_DOWN when no RPC is configured', async () => {
    const { app } = makeApp({ chain: null });
    const response = await app.inject({ method: 'GET', url: `/api/v1/identity/${ADDRESS}` });
    expect(response.statusCode).toBe(503);
    expect(errorOf(body(response)).code).toBe('RPC_DOWN');
  });

  it('maps chain read failures to RPC_DOWN without leaking internals', async () => {
    const { app, chain } = makeApp();
    chain.fail = true;
    const response = await app.inject({ method: 'GET', url: `/api/v1/identity/${ADDRESS}` });
    expect(response.statusCode).toBe(503);
    const payload = body(response);
    expect(errorOf(payload).code).toBe('RPC_DOWN');
    expect(response.payload).not.toContain('node unreachable');
  });

  it('returns chain-authoritative identity state with provenance', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: `/api/v1/identity/${ADDRESS.toUpperCase()}` });
    expect(response.statusCode).toBe(200);
    const payload = body(response);
    expect(payload.source).toBe('CHAIN_READ');
    expect(payload.checkedAt).toBe(NOW.toISOString());
    expect(dataOf(payload)).toMatchObject({
      address: ADDRESS,
      hasAgentId: true,
      registered: true,
      build: '120',
      rep: '5',
    });
    expect(asRecord(dataOf(payload).sync)).toMatchObject({ state: 'SYNCED', finalizedBlock: '1234' });
  });

  it('still returns chain state when only the projection database is down', async () => {
    const { app, reader } = makeApp();
    reader.failEverything = true;
    const response = await app.inject({ method: 'GET', url: `/api/v1/identity/${ADDRESS}` });
    expect(response.statusCode).toBe(200);
    const data = dataOf(body(response));
    expect(data.projection).toBeNull();
    expect(data.projectionError).toBe('DB_UNAVAILABLE');
    expect(data.hasAgentId).toBe(true);
  });

  it('reports DELAYED sync when the cursor is stale', async () => {
    const { app, reader } = makeApp();
    reader.sync = { state: 'SYNCED', finalizedBlock: 100n, syncedAt: new Date('2026-11-19T07:00:00.000Z') };
    const response = await app.inject({ method: 'GET', url: `/api/v1/identity/${ADDRESS}` });
    expect(asRecord(dataOf(body(response)).sync).state).toBe('DELAYED');
  });
});

describe('GET /api/v1/proposals', () => {
  it('rejects an unknown status filter', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/proposals?status=FUNDED' });
    expect(response.statusCode).toBe(400);
    expect(errorOf(body(response)).code).toBe('INVALID_FILTER');
  });

  it('lists proposals with chain ids as strings', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/proposals?status=OPEN' });
    expect(response.statusCode).toBe(200);
    const payload = body(response);
    expect(payload.source).toBe('CHAIN_CONFIRMED_EVENTS');
    const rows = payload.data as JsonRecord[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.chainProposalId).toBe('7');
    expect(asRecord(payload.sync)).toMatchObject({ finalizedBlock: '1234', state: 'SYNCED' });
  });

  it('returns 503 when the projection is unavailable', async () => {
    const { app, reader } = makeApp();
    reader.failEverything = true;
    const response = await app.inject({ method: 'GET', url: '/api/v1/proposals' });
    expect(response.statusCode).toBe(503);
    expect(errorOf(body(response)).code).toBe('DB_UNAVAILABLE');
  });
});

describe('GET /api/v1/proposals/:id', () => {
  it('rejects non-decimal ids', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/proposals/7abc' });
    expect(response.statusCode).toBe(400);
    expect(errorOf(body(response)).code).toBe('INVALID_ID');
  });

  it('returns 404 for an unknown proposal', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/proposals/99' });
    expect(response.statusCode).toBe(404);
    expect(errorOf(body(response)).code).toBe('NOT_FOUND');
  });

  it('returns votes and tx links from confirmed events', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/proposals/7' });
    expect(response.statusCode).toBe(200);
    const data = dataOf(body(response));
    expect(data.votes).toEqual({ yes: 3, no: 1, abstain: 0, unclassified: 0 });
    expect(data.txLinks).toEqual([
      { txHash: HASH, eventName: 'ProposalSubmitted', blockNumber: '1200' },
    ]);
    expect(data.deadline).toBe('2026-11-21T08:00:00.000Z');
  });
});

describe('GET /api/v1/projects/:id', () => {
  it('returns 404 for an unknown project', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/projects/2' });
    expect(response.statusCode).toBe(404);
    expect(errorOf(body(response)).code).toBe('NOT_FOUND');
  });

  it('returns funding, contributors and tx links for the genesis project', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/projects/1' });
    expect(response.statusCode).toBe(200);
    const payload = body(response);
    expect(dataOf(payload)).toMatchObject({
      chainProjectId: '1',
      goalBuild: '2000',
      fundedBuild: '0',
      state: 'FUNDING',
    });
    expect(dataOf(payload).contributors).toEqual([{ owner: OWNER, amount: '150' }]);
    expect(payload.source).toBe('CHAIN_CONFIRMED_EVENTS');
  });
});

describe('GET /api/v1/projects', () => {
  it('lists projects with provenance and string amounts', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    expect(response.statusCode).toBe(200);
    const payload = body(response);
    const rows = payload.data as JsonRecord[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chainProjectId: '1', goalBuild: '2000', state: 'FUNDING' });
    expect(payload.source).toBe('CHAIN_CONFIRMED_EVENTS');
  });
});

describe('GET /api/v1/activity', () => {
  it('rejects an out-of-range limit', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/activity?limit=500' });
    expect(response.statusCode).toBe(400);
    expect(errorOf(body(response)).code).toBe('INVALID_FILTER');
  });

  it('lists confirmed events with tx hashes', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/activity?limit=10' });
    expect(response.statusCode).toBe(200);
    const rows = body(response).data as JsonRecord[];
    expect(rows[0]).toMatchObject({ txHash: HASH, eventName: 'ContributionMade', confirmedAtBlock: '1234' });
  });
});

describe('error envelope', () => {
  it('includes requestId and echoes a valid caller-supplied id', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/proposals/abc',
      headers: { 'x-request-id': 'req-123456789' },
    });
    expect(response.statusCode).toBe(400);
    expect(errorOf(body(response)).requestId).toBe('req-123456789');
    expect(response.headers['x-request-id']).toBe('req-123456789');
  });

  it('ignores malformed caller-supplied request ids', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/proposals/abc',
      headers: { 'x-request-id': '<script>alert(1)</script>' },
    });
    expect(response.statusCode).toBe(400);
    expect(String(errorOf(body(response)).requestId)).not.toContain('<script>');
  });
});
