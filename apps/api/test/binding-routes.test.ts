import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { computeBindingCommitment } from '@agent-republic/chain';
import {
  BindingService,
  buildApiServer,
  type ApiDeps,
  type ApiProjectionReader,
  type BindingRepository,
  type CommitOutcome,
  type ContributorRow,
  type IdentityProjection,
  type ProposalRow,
  type ProjectRow,
  type SyncStatus,
  type TxLink,
  type VoteTally,
} from '../src/index.js';

/**
 * E2-04 route + service tests. The real BindingService runs against an
 * in-memory repository, so outcome → HTTP mapping is exercised end to end
 * without a database. SQL/transaction semantics are covered separately by
 * binding-pg.test.ts.
 */

const OWNER = `0x${'ab'.repeat(20)}`;
const APP_USER = '11111111-1111-4111-8111-111111111111';
const CHALLENGE_ID = '22222222-2222-4222-8222-222222222222';
const CONFIG_HASH = `0x${'22'.repeat(32)}`;
const TX_HASH = `0x${'33'.repeat(32)}`;
const NONCE = `0x${'44'.repeat(32)}`;
const REGISTRY = `0x${'55'.repeat(20)}`;
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

class MemoryBindingRepository implements BindingRepository {
  outcome: CommitOutcome = { status: 'BOUND', registryTxHash: TX_HASH };
  lastChallenge: Record<string, unknown> | null = null;

  async createChallenge(input: {
    appUserId: string;
    owner: string;
    agentConfigHash: string;
    nonceHash: string;
    commitment: string;
    expiresAt: Date;
  }): Promise<{ id: string }> {
    this.lastChallenge = { ...input };
    return { id: CHALLENGE_ID };
  }

  async commitBinding(): Promise<CommitOutcome> {
    return this.outcome;
  }
}

const apps: FastifyInstance[] = [];

function makeApp(overrides: Partial<ApiDeps> = {}) {
  const repo = new MemoryBindingRepository();
  const binding = new BindingService({
    repo,
    chainId: 56,
    registryAddress: REGISTRY,
    now: () => NOW,
    generateNonce: () => NONCE,
  });
  const app = buildApiServer({
    chainId: 56,
    reader: new EmptyReader(),
    chain: null,
    binding,
    session: async () => ({ appUserId: APP_USER }),
    now: () => NOW,
    ...overrides,
  });
  apps.push(app);
  return { app, repo, binding };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const challengePayload = { owner: OWNER, agentConfigHash: CONFIG_HASH };

describe('POST /api/v1/auth/binding-challenge', () => {
  it('requires a Web2 session before validating the body', async () => {
    const { app } = makeApp({ session: async () => null });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/binding-challenge',
      payload: { owner: 'garbage' },
    });
    expect(response.statusCode).toBe(401);
    expect(errorOf(body(response)).code).toBe('UNAUTHENTICATED');
  });

  it('returns NOT_CONFIGURED when no binding service is wired', async () => {
    const { app } = makeApp({ binding: null });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/binding-challenge',
      payload: challengePayload,
    });
    expect(response.statusCode).toBe(503);
    expect(errorOf(body(response)).code).toBe('NOT_CONFIGURED');
  });

  it('rejects a malformed owner address', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/binding-challenge',
      payload: { ...challengePayload, owner: '0x1234' },
    });
    expect(response.statusCode).toBe(400);
    expect(errorOf(body(response)).code).toBe('INVALID_ADDRESS');
  });

  it('rejects a malformed agentConfigHash', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/binding-challenge',
      payload: { ...challengePayload, agentConfigHash: '0x12' },
    });
    expect(response.statusCode).toBe(400);
    expect(errorOf(body(response)).code).toBe('INVALID_BODY');
  });

  it('issues a commitment, nonce and unsigned calldata draft', async () => {
    const { app, repo } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/binding-challenge',
      payload: { ...challengePayload, owner: OWNER.toUpperCase() },
    });
    expect(response.statusCode).toBe(201);
    const payload = body(response);

    expect(payload.challengeId).toBe(CHALLENGE_ID);
    expect(String(payload.commitment)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(payload.expiresAt).toBe(new Date(NOW.getTime() + 15 * 60 * 1000).toISOString());

    const calldata = asRecord(payload.calldata);
    expect(calldata).toMatchObject({ chainId: 56, to: REGISTRY, value: '0' });
    expect(String(calldata.data)).toMatch(/^0x[0-9a-f]{8}[0-9a-f]{64}$/);

    // The commitment must be reproducible from the returned nonce.
    const expected = computeBindingCommitment({
      appUserId: APP_USER,
      owner: OWNER,
      nonce: String(payload.nonce),
      agentConfigHash: CONFIG_HASH,
      expiresAt: BigInt(Math.floor(new Date(String(payload.expiresAt)).getTime() / 1000)),
    });
    expect(payload.commitment).toBe(expected);

    // Only the nonce hash is persisted.
    const stored = repo.lastChallenge;
    expect(stored?.nonceHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(stored?.nonceHash).not.toBe(NONCE);
    expect(stored?.commitment).toBe(expected);
  });
});

describe('POST /api/v1/auth/binding-verify', () => {
  const verifyPayload = { owner: OWNER, txHash: TX_HASH, challengeId: CHALLENGE_ID };

  it('requires a session', async () => {
    const { app } = makeApp({ session: async () => null });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/binding-verify',
      payload: verifyPayload,
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a non-UUID challenge id', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/binding-verify',
      payload: { ...verifyPayload, challengeId: 'not-a-uuid' },
    });
    expect(response.statusCode).toBe(400);
    expect(errorOf(body(response)).code).toBe('INVALID_BODY');
  });

  it('rejects a malformed tx hash', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/binding-verify',
      payload: { ...verifyPayload, txHash: '0x12' },
    });
    expect(response.statusCode).toBe(400);
    expect(errorOf(body(response)).code).toBe('INVALID_BODY');
  });

  it('returns BOUND only after the repository confirms a finalized event', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/binding-verify',
      payload: verifyPayload,
    });
    expect(response.statusCode).toBe(200);
    expect(body(response)).toMatchObject({
      bindingState: 'BOUND',
      owner: OWNER,
      appUserId: APP_USER,
      registryTxHash: TX_HASH,
    });
  });

  it('returns 202 PENDING_CONFIRMATION while the event is not finalized', async () => {
    const { app, repo } = makeApp();
    repo.outcome = { status: 'EVENT_PENDING' };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/binding-verify',
      payload: verifyPayload,
    });
    expect(response.statusCode).toBe(202);
    expect(body(response)).toMatchObject({ bindingState: 'PENDING_CONFIRMATION', txHash: TX_HASH });
  });

  it.each([
    ['CHALLENGE_USED', 409],
    ['CHALLENGE_EXPIRED', 409],
    ['OWNER_MISMATCH', 409],
    ['OWNER_ALREADY_BOUND', 409],
    ['APP_USER_ALREADY_BOUND', 409],
    ['TX_MISMATCH', 400],
    ['EVENT_NOT_FOUND', 404],
    ['CHALLENGE_NOT_FOUND', 404],
  ] as const)('maps repository outcome %s to HTTP %i', async (status, expectedStatus) => {
    const { app, repo } = makeApp();
    repo.outcome = { status } as CommitOutcome;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/binding-verify',
      payload: verifyPayload,
    });
    expect(response.statusCode).toBe(expectedStatus);
    expect(errorOf(body(response)).code).toBe(status === 'CHALLENGE_NOT_FOUND' ? 'NOT_FOUND' : status);
  });
});
