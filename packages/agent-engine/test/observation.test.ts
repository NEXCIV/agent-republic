import { describe, expect, it } from 'vitest';
import type { WorldFrameV1 } from '@agent-republic/domain';
import {
  AgentObservationError,
  buildAgentObservation,
} from '../src/observation.js';
import type { OwnerChainState } from '../src/observation.js';

/**
 * E3-02 — observation adapter: same block for self and facts, stale fails
 * closed, and only confirmed/approved data enters the agent input.
 */

const OWNER = `0x${'ab'.repeat(20)}`;
const TX = `0x${'cd'.repeat(32)}`;
const BLOCK_HASH = `0x${'22'.repeat(32)}`;

function makeFrame(overrides: Partial<WorldFrameV1> = {}): WorldFrameV1 {
  return {
    schemaVersion: '1.1',
    frameId: `0x${'11'.repeat(32)}`,
    generatedAt: '2026-11-19T00:00:00.000Z',
    source: {
      chainId: 56,
      blockNumber: '1000',
      blockHash: BLOCK_HASH,
      blockTimestamp: '2026-11-19T00:00:00.000Z',
      confirmedDepth: 15,
      sync: 'LIVE',
      provenance: 'CHAIN_CONFIRMED',
    },
    epochId: 7,
    facts: {
      citizenCount: 5,
      projects: [
        {
          id: '1',
          titleKey: 'golden-toilet-tower',
          goalBuild: '2000',
          fundedBuild: '1200',
          status: 'FUNDING',
          completedAtBlock: null,
        },
      ],
      proposals: [],
    },
    society: {
      socialRevision: '4',
      publicMessages: [
        {
          id: 'message-1',
          agentId: 'agent-1',
          owner: OWNER,
          text: 'The remaining budget is on chain.',
          createdAt: '2026-11-18T23:00:00.000Z',
          moderation: 'APPROVED',
          provenance: 'AI_SIMULATED',
        },
      ],
      agentSummaries: [],
    },
    simulation: {
      tick: '5',
      worldSeed: 'seed',
      sceneVersion: 'district-01@1',
      agents: [],
      visualEvents: [
        {
          id: 'event-1',
          kind: 'MILESTONE',
          targetId: 'project:1',
          happenedAtTick: '4',
          sourceType: 'CHAIN',
          sourceId: `${TX}:1`,
        },
        {
          id: 'event-2',
          kind: 'DISCUSSION',
          targetId: 'NOTE:abc',
          happenedAtTick: '5',
          sourceType: 'CHAIN',
          sourceId: `${TX}:2`,
        },
        {
          id: 'event-3',
          kind: 'MILESTONE',
          targetId: 'project:1',
          happenedAtTick: '5',
          sourceType: 'OFFCHAIN',
          sourceId: 'agent-note-1',
        },
        {
          id: 'event-4',
          kind: 'MILESTONE',
          targetId: 'IDENTITY',
          happenedAtTick: '5',
          sourceType: 'CHAIN',
          sourceId: 'IDENTITY',
        },
        {
          id: 'event-5',
          kind: 'MILESTONE',
          targetId: 'project:1',
          happenedAtTick: '5',
          sourceType: 'CHAIN',
          sourceId: `${TX}:1`,
        },
      ],
    },
    ...overrides,
  };
}

const self: OwnerChainState = {
  owner: OWNER,
  blockNumber: '1000',
  blockHash: BLOCK_HASH,
  hasAgentId: true,
  registered: true,
  build: '100',
  rep: '6',
};

function expectError(run: () => unknown): AgentObservationError {
  try {
    run();
  } catch (error) {
    if (error instanceof AgentObservationError) return error;
    throw error;
  }
  throw new Error('expected AgentObservationError');
}

describe('buildAgentObservation', () => {
  it('uses the frame block and filters chain evidence', () => {
    const observation = buildAgentObservation(makeFrame(), self, {
      networkBlockNumber: '1010',
    });

    expect(observation.worldFrameId).toBe(`0x${'11'.repeat(32)}`);
    expect(observation.sourceBlock).toBe('1000');
    expect(observation.epochId).toBe(7);
    expect(observation.self.owner).toBe(OWNER);
    expect(observation.self.build).toBe('100');
    expect(observation.facts.projects).toHaveLength(1);
    expect(observation.approvedPublicMessages).toHaveLength(1);
    expect(observation.chainRecentEventIds).toEqual([`${TX}:1`, `${TX}:2`]);
  });

  it('drops non-approved messages defensively', () => {
    const frame = makeFrame();
    const withPending = {
      ...frame,
      society: {
        ...frame.society,
        publicMessages: [
          ...frame.society.publicMessages,
          {
            ...frame.society.publicMessages[0],
            id: 'message-2',
            moderation: 'PENDING',
          },
        ],
      },
    } as unknown as WorldFrameV1;

    const observation = buildAgentObservation(withPending, self, {
      networkBlockNumber: '1000',
    });
    expect(observation.approvedPublicMessages.map((message) => message.id)).toEqual([
      'message-1',
    ]);
  });

  it('rejects owner state read at another block or hash', () => {
    expect(
      expectError(() =>
        buildAgentObservation(makeFrame(), { ...self, blockNumber: '999' }, {
          networkBlockNumber: '1000',
        }),
      ).code,
    ).toBe('BLOCK_MISMATCH');

    expect(
      expectError(() =>
        buildAgentObservation(makeFrame(), { ...self, blockHash: `0x${'33'.repeat(32)}` }, {
          networkBlockNumber: '1000',
        }),
      ).code,
    ).toBe('BLOCK_MISMATCH');
  });

  it('rejects non-LIVE frames', () => {
    const frame = makeFrame();
    const delayed = {
      ...frame,
      source: { ...frame.source, sync: 'DELAYED' },
    } as WorldFrameV1;
    expect(
      expectError(() =>
        buildAgentObservation(delayed, self, { networkBlockNumber: '1000' }),
      ).code,
    ).toBe('SYNC_NOT_LIVE');
  });

  it('fails closed when the frame is stale or ahead of the head', () => {
    expect(
      expectError(() =>
        buildAgentObservation(makeFrame(), self, { networkBlockNumber: '1051' }),
      ).code,
    ).toBe('STALE_FRAME');

    expect(
      expectError(() =>
        buildAgentObservation(makeFrame(), self, { networkBlockNumber: '999' }),
      ).code,
    ).toBe('STALE_FRAME');

    expect(() =>
      buildAgentObservation(makeFrame(), self, {
        networkBlockNumber: '1051',
        maxStalenessBlocks: 60,
      }),
    ).not.toThrow();
  });

  it('rejects contradictory or malformed owner state', () => {
    for (const bad of [
      { owner: '0x1234' },
      { build: '-1' },
      { rep: '1.5' },
      { hasAgentId: false, registered: true },
      { blockNumber: '12.5' },
    ]) {
      expect(
        expectError(() =>
          buildAgentObservation(makeFrame(), { ...self, ...bad }, {
            networkBlockNumber: '1000',
          }),
        ).code,
      ).toBe('INVALID_SELF');
    }
  });

  it('rejects invalid options', () => {
    expect(
      expectError(() =>
        buildAgentObservation(makeFrame(), self, { networkBlockNumber: 'abc' }),
      ).code,
    ).toBe('INVALID_OPTIONS');
    expect(
      expectError(() =>
        buildAgentObservation(makeFrame(), self, {
          networkBlockNumber: '1000',
          maxStalenessBlocks: -1,
        }),
      ).code,
    ).toBe('INVALID_OPTIONS');
  });
});
