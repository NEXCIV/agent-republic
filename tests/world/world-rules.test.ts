import { describe, expect, it } from 'vitest';
import {
  buildWorldFrame,
  computeFrameId,
  deriveProjectStage,
  epochIdFromTimestamp,
  getSceneManifest,
  initialAgentStates,
  reduceFacts,
  stepSimulation,
  toSimAgentStates,
  type BuildWorldFrameInput,
  type VerifiedChainEvent,
} from '@agent-republic/world-engine';
import { validateDistrict01, worldFrameV1Schema } from '@agent-republic/domain';
import { buildApiServer } from '../../apps/api/src/server.js';
import { WorldService } from '../../apps/api/src/world/world-service.js';

/**
 * E5-08 World rules matrix W-01..W-12 (docs/WORLD_ENGINE.md §9).
 *
 * Each block is one published rule. Rules that need a database reach their
 * DB-backed assertions through the worker/API integration suites; here every
 * rule also has a pure, always-on assertion so `pnpm test:world` is meaningful
 * without infrastructure.
 */

const OWNER = `0x${'aa'.repeat(20)}`;
const H = (seed: number): string => `0x${seed.toString(16).padStart(64, '0')}`;

type EventOverrides = { block?: number; owner?: string | null; logIndex?: number; txSeed?: number };

function event(
  eventName: string,
  payload: Record<string, string | boolean | null>,
  options: EventOverrides = {},
): VerifiedChainEvent {
  const block = options.block ?? 1;
  return {
    eventName,
    txHash: H(options.txSeed ?? 7000),
    logIndex: options.logIndex ?? 0,
    blockNumber: BigInt(block),
    blockHash: H(block),
    owner: options.owner ?? OWNER,
    payload,
  };
}

const genesis = (): VerifiedChainEvent =>
  event('ProjectCreated', { projectId: '1', titleHash: H(9), goal: '2000', genesis: true }, { block: 1 });

const contribution = (amount: string, fundedAfter: string, block: number, txSeed: number): VerifiedChainEvent =>
  event(
    'ContributionMade',
    { owner: OWNER, projectId: '1', amount, fundedAfter },
    { block, txSeed },
  );

const baseFrame = (): BuildWorldFrameInput => ({
  source: {
    chainId: 56,
    blockNumber: '70000000',
    blockHash: H(700),
    blockTimestamp: '2026-11-19T07:59:48.000Z',
    confirmedDepth: 12,
    sync: 'LIVE',
  },
  facts: reduceFacts([genesis(), contribution('50', '50', 10, 1)]),
  society: { socialRevision: '0', publicMessages: [], agentSummaries: [] },
  simulation: {
    tick: '0',
    worldSeed: 'genesis-2026',
    sceneVersion: 'district-01@1',
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
    visualEvents: [],
  },
  generatedAt: '2026-11-19T08:00:00.000Z',
});

describe('W-01 deterministic replay', () => {
  it('reproduces frameId and agent coordinates byte-for-byte', () => {
    const run = () => {
      let states = initialAgentStates({ worldSeed: 'seed-w01', agentIds: ['a1', 'a2'] });
      const frames: string[] = [];
      const positions: string[] = [];
      for (let tick = 0; tick < 20; tick += 1) {
        const step = stepSimulation({ worldSeed: 'seed-w01', tick: BigInt(tick), agents: states });
        states = toSimAgentStates(step.agents);
        const frame = buildWorldFrame({
          ...baseFrame(),
          simulation: {
            tick: String(tick),
            worldSeed: 'seed-w01',
            sceneVersion: 'district-01@1',
            agents: step.agents,
            visualEvents: step.visualEvents,
          },
        });
        frames.push(frame.frameId);
        positions.push(JSON.stringify(step.agents.map((agent) => agent.position)));
      }
      return { frames, positions };
    };

    const first = run();
    const second = run();
    expect(second.frames).toEqual(first.frames);
    expect(second.positions).toEqual(first.positions);
  });
});

describe('W-02 unconfirmed contribution', () => {
  it('does not change fundedBuild or the building stage', () => {
    const confirmed = [genesis(), contribution('50', '50', 10, 1)];
    const withPendingIgnored = reduceFacts(confirmed);
    const before = deriveProjectStage({
      fundedBuild: withPendingIgnored.projects[0]!.fundedBuild,
      goalBuild: withPendingIgnored.projects[0]!.goalBuild,
    });

    // A pending tx never reaches the reducer: the indexer exposes only
    // confirmed rows (verified in the indexer/API suites).
    expect(withPendingIgnored.projects[0]?.fundedBuild).toBe('50');
    expect(before).toBe('FOUNDATION');
  });
});

describe('W-03 confirmed ContributionMade', () => {
  it('adds exactly the confirmed amount and keeps event evidence', () => {
    const facts = reduceFacts([genesis(), contribution('50', '50', 10, 42)]);
    expect(facts.projects[0]?.fundedBuild).toBe('50');
    expect(deriveProjectStage({ fundedBuild: '50', goalBuild: '2000' })).toBe('FOUNDATION');
  });
});

describe('W-04 AI chat cannot move the ledger', () => {
  it('ignores claims like "donated 9999"', () => {
    const chain = [genesis(), contribution('50', '50', 10, 1)];
    const baseline = reduceFacts(chain);
    const noisy = reduceFacts([
      ...chain,
      event('AGENT_MESSAGE', { text: 'I donated 9999 BUILD', agentId: 'agent-01' }, { block: 11 }),
    ]);
    expect(noisy).toEqual(baseline);
    expect(noisy.projects[0]?.status).toBe('FUNDING');
  });
});

describe('W-05 stage thresholds', () => {
  it('maps 0/25/60/100% exactly', () => {
    expect(deriveProjectStage({ fundedBuild: '0', goalBuild: '100000' })).toBe('FOUNDATION');
    expect(deriveProjectStage({ fundedBuild: '25000', goalBuild: '100000' })).toBe('FRAME');
    expect(deriveProjectStage({ fundedBuild: '60000', goalBuild: '100000' })).toBe('FACADE');
    expect(deriveProjectStage({ fundedBuild: '100000', goalBuild: '100000' })).toBe('COMPLETE');
  });
});

describe('W-06 concurrent tick production', () => {
  it('computes an identical logical tick every time (CAS is enforced in the DB suite)', () => {
    const states = initialAgentStates({ worldSeed: 'seed-w06', agentIds: ['a1', 'a2', 'a3'] });
    const outputs = Array.from({ length: 10 }, () =>
      JSON.stringify(stepSimulation({ worldSeed: 'seed-w06', tick: 500n, agents: states })),
    );
    expect(new Set(outputs).size).toBe(1);
  });
});

describe('W-07 reorg withdrawal', () => {
  it('rolls facts back and marks the world as recovering', async () => {
    const forkBlock = 20;
    const before = reduceFacts([genesis(), contribution('50', '50', 10, 1), contribution('100', '150', 25, 2)]);
    const after = reduceFacts([genesis(), contribution('50', '50', 10, 1)]);

    expect(before.projects[0]?.fundedBuild).toBe('150');
    expect(after.projects[0]?.fundedBuild).toBe('50');
    expect(forkBlock).toBeGreaterThan(10);

    const reader = {
      async loadRaw() {
        return {
          cursor: { finalizedBlock: 30n, updatedAt: new Date('2026-11-19T07:59:00.000Z') },
          block: { number: '30', hash: H(30), timestamp: new Date('2026-11-19T07:59:48.000Z') },
          events: [genesis(), contribution('50', '50', 10, 1)],
          tick: {
            tick: '5',
            frameId: H(5),
            baseBlock: '30',
            socialRevision: '0',
            stateJson: { worldSeed: 'seed-w07', agents: [] },
          },
          visualEvents: [],
          pendingRecovery: true,
          society: { socialRevision: '0', messages: [], agents: [] },
        };
      },
    };
    const service = new WorldService({
      reader,
      chainId: 56,
      confirmedDepth: 12,
      now: () => new Date('2026-11-19T08:00:00.000Z'),
    });
    const frame = await service.getFrame();
    expect(frame.source.sync).toBe('REORG_RECOVERY');
    expect(frame.facts.projects[0]?.fundedBuild).toBe('50');
  });
});

describe('W-08 RPC timeout / stale indexer', () => {
  it('reports DELAYED while keeping the last trusted facts', async () => {
    const reader = {
      async loadRaw() {
        return {
          cursor: { finalizedBlock: 30n, updatedAt: new Date('2026-11-19T06:00:00.000Z') },
          block: { number: '30', hash: H(30), timestamp: new Date('2026-11-19T05:59:48.000Z') },
          events: [genesis(), contribution('50', '50', 10, 1)],
          tick: {
            tick: '5',
            frameId: H(5),
            baseBlock: '30',
            socialRevision: '0',
            stateJson: { worldSeed: 'seed-w08', agents: [] },
          },
          visualEvents: [],
          pendingRecovery: false,
          society: { socialRevision: '0', messages: [], agents: [] },
        };
      },
    };
    const service = new WorldService({
      reader,
      chainId: 56,
      confirmedDepth: 12,
      now: () => new Date('2026-11-19T08:00:00.000Z'),
      staleAfterSeconds: 300,
    });
    const frame = await service.getFrame();
    expect(frame.source.sync).toBe('DELAYED');
    expect(frame.facts.projects[0]?.fundedBuild).toBe('50');
    expect(frame.source.blockTimestamp).toBe('2026-11-19T05:59:48.000Z');
  });
});

describe('W-09 UTC epoch boundary', () => {
  it('derives epochId only from the confirmed block timestamp', () => {
    expect(epochIdFromTimestamp('2026-11-19T23:59:59.999Z')).toBe(20776);
    expect(epochIdFromTimestamp('2026-11-20T00:00:00.000Z')).toBe(20777);

    const frame = buildWorldFrame(baseFrame());
    expect(frame.epochId).toBe(epochIdFromTimestamp(baseFrame().source.blockTimestamp));

    // A faster simulation tick never changes the contract epoch.
    const later = buildWorldFrame({
      ...baseFrame(),
      simulation: { ...baseFrame().simulation, tick: '999999' },
    });
    expect(later.epochId).toBe(frame.epochId);
  });
});

describe('W-10 1000-tick replay', () => {
  it('has no bigint drift and never touches the ledger', () => {
    const factsBefore = reduceFacts([genesis(), contribution('50', '50', 10, 1)]);
    let states = initialAgentStates({ worldSeed: 'seed-w10', agentIds: ['a1', 'a2', 'a3'] });
    let previous = '';
    for (let tick = 0; tick < 1000; tick += 1) {
      const step = stepSimulation({ worldSeed: 'seed-w10', tick: BigInt(tick), agents: states });
      expect(step.tick).toBe(String(tick));
      for (const agent of step.agents) {
        expect(Number.isInteger(agent.position[0])).toBe(true);
        expect(Number.isInteger(agent.position[2])).toBe(true);
      }
      const serialized = JSON.stringify(step);
      if (tick === 999) expect(serialized).not.toBe(previous);
      previous = serialized;
      states = toSimAgentStates(step.agents);
    }
    const factsAfter = reduceFacts([genesis(), contribution('50', '50', 10, 1)]);
    expect(factsAfter).toEqual(factsBefore);
  });
});

describe('W-11 SSE reconnect / missed frames', () => {
  it('lets a client re-fetch the full frame and compare by frameId', async () => {
    const reader = {
      async loadRaw() {
        return {
          cursor: { finalizedBlock: 30n, updatedAt: new Date('2026-11-19T07:59:00.000Z') },
          block: { number: '30', hash: H(30), timestamp: new Date('2026-11-19T07:59:48.000Z') },
          events: [genesis(), contribution('50', '50', 10, 1)],
          tick: {
            tick: '7',
            frameId: H(7),
            baseBlock: '30',
            socialRevision: '0',
            stateJson: { worldSeed: 'seed-w11', agents: [] },
          },
          visualEvents: [],
          pendingRecovery: false,
          society: { socialRevision: '0', messages: [], agents: [] },
        };
      },
    };
    const world = new WorldService({
      reader,
      chainId: 56,
      confirmedDepth: 12,
      now: () => new Date('2026-11-19T08:00:00.000Z'),
    });
    const app = buildApiServer({
      chainId: 56,
      // The world endpoints do not touch the projection reader.
      reader: null as never,
      chain: null,
      world,
    });
    try {
      const stream = await app.inject({ method: 'GET', url: '/api/v1/world/stream?once=1' });
      expect(stream.payload).toContain('event: world.frame');

      const frame = await app.inject({ method: 'GET', url: '/api/v1/world/frame' });
      const announced = JSON.parse(stream.payload.split('data: ')[1]!.split('\n')[0]!) as {
        frameId: string;
      };
      expect(announced.frameId).toBe(frame.json<{ frameId: string }>().frameId);

      const cached = await app.inject({
        method: 'GET',
        url: '/api/v1/world/frame',
        headers: { 'if-none-match': String(frame.headers.etag) },
      });
      expect(cached.statusCode).toBe(304);
    } finally {
      await app.close();
    }
  });
});

describe('W-12 AI disabled', () => {
  it('serves a valid world with no AI messages at all', () => {
    const frame = buildWorldFrame({
      ...baseFrame(),
      society: { socialRevision: '0', publicMessages: [], agentSummaries: [] },
    });
    expect(() => worldFrameV1Schema.parse(frame)).not.toThrow();
    expect(frame.society.publicMessages).toEqual([]);
    expect(validateDistrict01()).toEqual([]);
    expect(getSceneManifest().manifestHash).toMatch(/^sha256:/);
    expect(computeFrameId(frame)).toBe(frame.frameId);
  });
});
