import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Goal, Persona } from '@agent-republic/domain';
import {
  AgentConsoleService,
  AgentVersionConflictError,
  buildApiServer,
  type AgentConfigSaveResult,
  type AgentConsoleRepository,
  type AgentConsoleView,
  type ApiDeps,
  type ApiProjectionReader,
  type ContributorRow,
  type IdentityProjection,
  type ProposalRow,
  type ProjectRow,
  type SyncStatus,
  type TxLink,
  type VoteTally,
} from '../src/index.js';

/**
 * E3-07 route tests. The real AgentConsoleService runs against an in-memory
 * repository so owner protection, validation and version conflicts are
 * exercised end to end without a database.
 */

const OWNER = `0x${'ab'.repeat(20)}`;
const APP_USER = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-20T08:00:00.000Z');

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

class MemoryAgentConsoleRepository implements AgentConsoleRepository {
  owner: string | null = OWNER;
  view: AgentConsoleView | null = null;
  version = 1;
  lastSaveOwner: string | null = null;
  lastPaused: boolean | null = null;

  async findOwnerForAppUser(): Promise<string | null> {
    return this.owner;
  }

  async getByOwner(owner: string): Promise<AgentConsoleView | null> {
    if (this.view !== null && this.view.owner === owner) return this.view;
    return null;
  }

  async saveConfig(input: {
    owner: string;
    name: string;
    persona: Persona;
    goal: Goal;
    expectedVersion: number | null;
  }): Promise<AgentConfigSaveResult> {
    this.lastSaveOwner = input.owner;
    if (input.expectedVersion !== null && input.expectedVersion !== this.version) {
      throw new AgentVersionConflictError();
    }
    this.version += 1;
    return { agentId: AGENT_ID, configVersion: this.version, status: 'ACTIVE' };
  }

  async setPaused(_owner: string, paused: boolean): Promise<AgentConfigSaveResult | null> {
    this.lastPaused = paused;
    if (this.view === null) return null;
    return { agentId: AGENT_ID, configVersion: this.version + 1, status: paused ? 'PAUSED' : 'ACTIVE' };
  }
}

const apps: FastifyInstance[] = [];

function makeApp(overrides: Partial<ApiDeps> = {}) {
  const repo = new MemoryAgentConsoleRepository();
  const agents = new AgentConsoleService(repo);
  const app = buildApiServer({
    chainId: 56,
    reader: new EmptyReader(),
    chain: null,
    agents,
    session: async () => ({ appUserId: APP_USER }),
    now: () => NOW,
    ...overrides,
  });
  apps.push(app);
  return { app, repo };
}

function consoleView(owner = OWNER): AgentConsoleView {
  return {
    agentId: AGENT_ID,
    owner,
    name: 'Archivist',
    persona: 'PRAGMATIC',
    goal: 'BUILD_PUBLIC_GOODS',
    status: 'ACTIVE',
    configVersion: 2,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    versions: [
      {
        version: 2,
        name: 'Archivist',
        persona: 'PRAGMATIC',
        goal: 'BUILD_PUBLIC_GOODS',
        paused: false,
        createdAt: NOW.toISOString(),
      },
      {
        version: 1,
        name: 'Archivist',
        persona: 'PRAGMATIC',
        goal: 'BUILD_PUBLIC_GOODS',
        paused: false,
        createdAt: NOW.toISOString(),
      },
    ],
    recentActions: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        actionType: 'VOTE',
        status: 'PENDING',
        targetId: '1',
        txHash: null,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    ],
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('GET /api/v1/my-agent', () => {
  it('requires a Web2 session', async () => {
    const { app } = makeApp({ session: async () => null });
    const response = await app.inject({ method: 'GET', url: '/api/v1/my-agent' });
    expect(response.statusCode).toBe(401);
    expect(errorOf(body(response)).code).toBe('UNAUTHENTICATED');
  });

  it('returns NOT_CONFIGURED when no console service is wired', async () => {
    const { app } = makeApp({ agents: null });
    const response = await app.inject({ method: 'GET', url: '/api/v1/my-agent' });
    expect(response.statusCode).toBe(503);
    expect(errorOf(body(response)).code).toBe('NOT_CONFIGURED');
  });

  it('rejects a session without a confirmed binding', async () => {
    const { app, repo } = makeApp();
    repo.owner = null;
    const response = await app.inject({ method: 'GET', url: '/api/v1/my-agent' });
    expect(response.statusCode).toBe(403);
    expect(errorOf(body(response)).code).toBe('BINDING_REQUIRED');
  });

  it('returns NO_AGENT when the owner has no agent yet', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/my-agent' });
    expect(response.statusCode).toBe(404);
    expect(errorOf(body(response)).code).toBe('NO_AGENT');
  });

  it('returns the owner agent with immutable versions and recent actions', async () => {
    const { app, repo } = makeApp();
    repo.view = consoleView();
    const response = await app.inject({ method: 'GET', url: '/api/v1/my-agent' });
    expect(response.statusCode).toBe(200);
    const payload = body(response);
    expect(payload.source).toBe('OWNER_CONFIGURED_AGENT');
    const data = asRecord(payload.data);
    expect(data).toMatchObject({ agentId: AGENT_ID, owner: OWNER, status: 'ACTIVE', configVersion: 2 });
    expect((data.versions as unknown[]).length).toBe(2);
    expect((data.recentActions as unknown[]).length).toBe(1);
  });
});

describe('PUT /api/v1/my-agent/config', () => {
  const validPayload = {
    name: 'Archivist',
    persona: 'PRAGMATIC',
    goal: 'BUILD_PUBLIC_GOODS',
    expectedVersion: 1,
  };

  it('requires a session', async () => {
    const { app } = makeApp({ session: async () => null });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/my-agent/config',
      payload: validPayload,
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an owner field instead of trusting the body', async () => {
    const { app, repo } = makeApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/my-agent/config',
      payload: { ...validPayload, owner: `0x${'cd'.repeat(20)}` },
    });
    expect(response.statusCode).toBe(400);
    expect(errorOf(body(response)).code).toBe('OWNER_NOT_ALLOWED');
    expect(repo.lastSaveOwner).toBeNull();
  });

  it('rejects unknown fields', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/my-agent/config',
      payload: { ...validPayload, privateKey: '0xdead' },
    });
    expect(response.statusCode).toBe(400);
    expect(errorOf(body(response)).code).toBe('INVALID_BODY');
  });

  it('rejects an unsupported persona', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/my-agent/config',
      payload: { ...validPayload, persona: 'EVIL' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an empty name', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/my-agent/config',
      payload: { ...validPayload, name: '   ' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('maps a stale expectedVersion to 409 VERSION_CONFLICT', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/my-agent/config',
      payload: { ...validPayload, expectedVersion: 99 },
    });
    expect(response.statusCode).toBe(409);
    expect(errorOf(body(response)).code).toBe('VERSION_CONFLICT');
  });

  it('saves with the owner derived from the binding, not the request', async () => {
    const { app, repo } = makeApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/my-agent/config',
      payload: validPayload,
    });
    expect(response.statusCode).toBe(200);
    expect(body(response)).toMatchObject({ agentId: AGENT_ID, configVersion: 2, status: 'ACTIVE' });
    expect(repo.lastSaveOwner).toBe(OWNER);
  });
});

describe('POST /api/v1/my-agent/pause', () => {
  it('rejects an owner field', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/my-agent/pause',
      payload: { paused: true, owner: OWNER },
    });
    expect(response.statusCode).toBe(400);
    expect(errorOf(body(response)).code).toBe('OWNER_NOT_ALLOWED');
  });

  it('rejects a non-boolean paused flag', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/my-agent/pause',
      payload: { paused: 'yes' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns NO_AGENT when nothing exists yet', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/my-agent/pause',
      payload: { paused: true },
    });
    expect(response.statusCode).toBe(404);
    expect(errorOf(body(response)).code).toBe('NO_AGENT');
  });

  it('pauses and resumes the owner agent', async () => {
    const { app, repo } = makeApp();
    repo.view = consoleView();

    const paused = await app.inject({
      method: 'POST',
      url: '/api/v1/my-agent/pause',
      payload: { paused: true },
    });
    expect(paused.statusCode).toBe(200);
    expect(body(paused)).toMatchObject({ agentId: AGENT_ID, status: 'PAUSED' });
    expect(repo.lastPaused).toBe(true);

    const resumed = await app.inject({
      method: 'POST',
      url: '/api/v1/my-agent/pause',
      payload: { paused: false },
    });
    expect(resumed.statusCode).toBe(200);
    expect(body(resumed)).toMatchObject({ agentId: AGENT_ID, status: 'ACTIVE' });
    expect(repo.lastPaused).toBe(false);
  });
});
