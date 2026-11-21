import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildApiServer,
  WorldService,
  type ApiDeps,
  type ApiProjectionReader,
  type ContributorRow,
  type IdentityProjection,
  type ProposalRow,
  type ProjectRow,
  type SyncStatus,
  type TxLink,
  type VoteTally,
  type WorldRawData,
  type WorldReader,
} from '../src/index.js';

/**
 * E5-06 world endpoint tests. The real WorldService runs against a fake
 * reader, so assembly, ETag handling and not-ready behaviour are exercised
 * without a database.
 */

const H = (seed: number): string => `0x${seed.toString(16).padStart(64, '0')}`;
const OWNER = `0x${'aa'.repeat(20)}`;
const NOW = new Date('2026-11-19T08:00:00.000Z');

type JsonRecord = Record<string, unknown>;
const body = (response: { payload: string }): JsonRecord => JSON.parse(response.payload) as JsonRecord;
const asRecord = (value: unknown): JsonRecord => value as JsonRecord;

class EmptyProjectionReader implements ApiProjectionReader {
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
  async listProjects(): Promise<ProjectRow[]> {
    return [];
  }
  async findProject(): Promise<ProjectRow | null> {
    return null;
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
  async listActivity() {
    return [];
  }
}

class FakeWorldReader implements WorldReader {
  data: WorldRawData = rawWorld();

  async loadRaw(): Promise<WorldRawData> {
    return this.data;
  }
}

function rawWorld(): WorldRawData {
  return {
    cursor: { finalizedBlock: 70_000_000n, updatedAt: new Date('2026-11-19T07:59:00.000Z') },
    block: {
      number: '70000000',
      hash: H(700),
      timestamp: new Date('2026-11-19T07:59:48.000Z'),
    },
    events: [
      {
        eventName: 'CitizenRegistered',
        txHash: H(1),
        logIndex: 0,
        blockNumber: 69_999_990n,
        blockHash: H(600),
        owner: OWNER,
        payload: { owner: OWNER, commitment: H(11) },
      },
      {
        eventName: 'ProjectCreated',
        txHash: H(2),
        logIndex: 0,
        blockNumber: 69_999_991n,
        blockHash: H(601),
        owner: null,
        payload: { projectId: '1', titleHash: H(12), goal: '2000', genesis: true },
      },
      {
        eventName: 'ContributionMade',
        txHash: H(3),
        logIndex: 0,
        blockNumber: 69_999_992n,
        blockHash: H(602),
        owner: OWNER,
        payload: { owner: OWNER, projectId: '1', amount: '100', fundedAfter: '100' },
      },
    ],
    tick: {
      tick: '123',
      frameId: H(9),
      baseBlock: '70000000',
      socialRevision: '1',
      stateJson: {
        tick: '123',
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
      },
    },
    pendingRecovery: false,
    visualEvents: [
      {
        id: '123:agent-01:MOVE',
        kind: 'MOVE',
        targetId: 'agent-01',
        happenedAtTick: '123',
        sourceType: 'OFFCHAIN',
        sourceId: 'agent-01',
      },
    ],
    society: {
      socialRevision: '1',
      messages: [
        {
          id: 'm1',
          agentId: 'agent-01',
          owner: OWNER,
          text: 'The tower needs more BUILD.',
          createdAt: new Date('2026-11-19T07:50:00.000Z'),
        },
      ],
      agents: [
        {
          agentId: 'agent-01',
          owner: OWNER,
          displayName: 'Ada',
          persona: 'COOPERATIVE',
          active: true,
        },
      ],
    },
  };
}

const apps: FastifyInstance[] = [];

function makeApp(configure: (reader: FakeWorldReader) => void = () => undefined): {
  app: FastifyInstance;
  reader: FakeWorldReader;
} {
  const reader = new FakeWorldReader();
  configure(reader);
  const world = new WorldService({
    reader,
    chainId: 56,
    confirmedDepth: 12,
    now: () => NOW,
    staleAfterSeconds: 300,
  });
  const deps: ApiDeps = {
    chainId: 56,
    reader: new EmptyProjectionReader(),
    chain: null,
    world,
    session: async () => null,
  };
  const app = buildApiServer(deps);
  apps.push(app);
  return { app, reader };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('GET /api/v1/world/frame', () => {
  it('returns a valid frame with an ETag and confirmed facts', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/world/frame' });
    expect(response.statusCode).toBe(200);

    const frame = body(response);
    expect(frame.schemaVersion).toBe('1.1');
    expect(String(frame.frameId)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(response.headers.etag).toBe(`"${String(frame.frameId)}"`);

    const facts = asRecord(frame.facts);
    expect(facts.citizenCount).toBe(1);
    const projects = facts.projects as JsonRecord[];
    expect(projects[0]).toMatchObject({ id: '1', fundedBuild: '100', status: 'FUNDING' });

    const simulation = asRecord(frame.simulation);
    expect(simulation.tick).toBe('123');
    const messages = asRecord(frame.society).publicMessages as JsonRecord[];
    expect(messages[0]).toMatchObject({ provenance: 'AI_SIMULATED', moderation: 'APPROVED' });
    expect(asRecord(frame.source).provenance).toBe('CHAIN_CONFIRMED');
  });

  it('answers 304 when the client already has the same frameId', async () => {
    const { app } = makeApp();
    const first = await app.inject({ method: 'GET', url: '/api/v1/world/frame' });
    const etag = String(first.headers.etag);

    const cached = await app.inject({
      method: 'GET',
      url: '/api/v1/world/frame',
      headers: { 'if-none-match': etag },
    });
    expect(cached.statusCode).toBe(304);
    expect(cached.payload).toBe('');
  });

  it('reports DELAYED sync for a stale cursor', async () => {
    const { app } = makeApp((reader) => {
      reader.data = {
        ...reader.data,
        cursor: { finalizedBlock: 70_000_000n, updatedAt: new Date('2026-11-19T07:00:00.000Z') },
      };
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/world/frame' });
    expect(asRecord(body(response).source).sync).toBe('DELAYED');
  });

  it('reports REORG_RECOVERY while withdrawn visuals are still pending cleanup', async () => {
    const { app } = makeApp((reader) => {
      reader.data = { ...reader.data, pendingRecovery: true };
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/world/frame' });
    expect(asRecord(body(response).source).sync).toBe('REORG_RECOVERY');
  });

  it('fails closed when no block is finalized yet', async () => {
    const { app } = makeApp((reader) => {
      reader.data = { ...reader.data, cursor: null, block: null };
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/world/frame' });
    expect(response.statusCode).toBe(503);
    expect(asRecord(body(response).error).code).toBe('WORLD_NOT_READY');
  });

  it('fails closed when no world tick has been produced', async () => {
    const { app } = makeApp((reader) => {
      reader.data = { ...reader.data, tick: null, visualEvents: [] };
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/world/frame' });
    expect(response.statusCode).toBe(503);
    expect(asRecord(body(response).error).code).toBe('WORLD_NOT_READY');
  });

  it('fails closed when the stored simulation state is malformed', async () => {
    const { app } = makeApp((reader) => {
      reader.data = {
        ...reader.data,
        tick: { ...reader.data.tick!, stateJson: { agents: 'not-an-array' } },
      };
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/world/frame' });
    expect(response.statusCode).toBe(503);
    expect(asRecord(body(response).error).code).toBe('WORLD_NOT_READY');
  });
});

describe('GET /api/v1/world', () => {
  it('returns a summary derived from the frame', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/world' });
    expect(response.statusCode).toBe(200);
    expect(body(response).data).toMatchObject({
      chainId: 56,
      citizenCount: 1,
      projectCount: 1,
      proposalCount: 0,
      tick: '123',
      sync: 'LIVE',
    });
  });
});

describe('GET /api/v1/world/scene-manifest', () => {
  it('serves the validated manifest with a content hash and ETag', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/world/scene-manifest' });
    expect(response.statusCode).toBe(200);

    const manifest = body(response);
    expect(manifest.sceneVersion).toBe('district-01@1');
    expect(String(manifest.manifestHash)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(response.headers.etag).toBe(`"${String(manifest.manifestHash)}"`);

    const cached = await app.inject({
      method: 'GET',
      url: '/api/v1/world/scene-manifest',
      headers: { 'if-none-match': String(response.headers.etag) },
    });
    expect(cached.statusCode).toBe(304);
  });
});

describe('GET /api/v1/world/stream', () => {
  it('sends one frame notification then closes when ?once=1', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/world/stream?once=1' });
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['content-type'])).toContain('text/event-stream');
    expect(response.payload).toContain('event: world.frame');
    expect(response.payload).toContain('"tick":"123"');
    expect(response.payload).toContain('retry: 5000');
  });

  it('refuses to open a stream when the world is not ready', async () => {
    const { app } = makeApp((reader) => {
      reader.data = { ...reader.data, cursor: null, block: null };
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/world/stream?once=1' });
    expect(response.statusCode).toBe(503);
  });
});
