import { describe, expect, it } from 'vitest';
import type { WorldFrameV1 } from '@agent-republic/domain';
import {
  chainMilestones,
  chainSourceTxHash,
  milestoneKey,
  milestoneTarget,
  selectMilestonePulse,
} from '../src/features/world-3d/effects/milestones';

/**
 * E6-06 — milestone animation dedupe and reorg suppression.
 * Key = (chainId, txHash:logIndex, sceneVersion).
 */

const TX = `0x${'ab'.repeat(32)}`;
const SCENE = 'district-01@1';

type SimEvent = WorldFrameV1['simulation']['visualEvents'][number];

function event(overrides: Partial<SimEvent> = {}): SimEvent {
  return {
    id: 'event-1',
    kind: 'MILESTONE',
    targetId: 'project:1',
    happenedAtTick: '100',
    sourceType: 'CHAIN',
    sourceId: `${TX}:1`,
    ...overrides,
  };
}

function frame(
  events: SimEvent[],
  sync: WorldFrameV1['source']['sync'] = 'LIVE',
): WorldFrameV1 {
  return {
    schemaVersion: '1.1',
    frameId: `0x${'11'.repeat(32)}`,
    generatedAt: '2026-11-19T00:00:00.000Z',
    source: {
      chainId: 56,
      blockNumber: '100',
      blockHash: `0x${'22'.repeat(32)}`,
      blockTimestamp: '2026-11-19T00:00:00.000Z',
      confirmedDepth: 15,
      sync,
      provenance: 'CHAIN_CONFIRMED',
    },
    epochId: 1,
    facts: { citizenCount: 0, projects: [], proposals: [] },
    society: { socialRevision: '0', publicMessages: [], agentSummaries: [] },
    simulation: {
      tick: '10',
      worldSeed: 'seed',
      sceneVersion: SCENE,
      agents: [],
      visualEvents: events,
    },
  };
}

describe('milestone keys and targets', () => {
  it('builds a chainId + tx + sceneVersion key and normalises case', () => {
    expect(milestoneKey(56, `${TX.toUpperCase()}:1`, SCENE)).toBe(`56:${TX}:1:${SCENE}`);
  });

  it('extracts tx hashes only from chain source IDs', () => {
    expect(chainSourceTxHash(`${TX}:7`)).toBe(TX);
    expect(chainSourceTxHash('note-123')).toBeNull();
    expect(chainSourceTxHash('0x1234:1')).toBeNull();
  });

  it('maps contract targets to the right landmark', () => {
    expect(milestoneTarget('project:1')).toBe('PROJECT');
    expect(milestoneTarget('IDENTITY')).toBe('IDENTITY');
    expect(milestoneTarget('proposal:9')).toBe('COUNCIL');
    expect(milestoneTarget('NOTE:abc')).toBeNull();
  });
});

describe('selectMilestonePulse', () => {
  it('accepts only chain milestones', () => {
    const events = [
      event({ id: 'chain', kind: 'MILESTONE', sourceType: 'CHAIN' }),
      event({ id: 'offchain', kind: 'MILESTONE', sourceType: 'OFFCHAIN' }),
      event({ id: 'discussion', kind: 'DISCUSSION', sourceType: 'CHAIN' }),
    ];
    expect(chainMilestones(frame(events)).map((entry) => entry.id)).toEqual(['chain']);
  });

  it('never animates the initial frame', () => {
    const result = selectMilestonePulse({ frame: frame([event()]), seen: new Set(), seeded: false });
    expect(result.event).toBeNull();
    expect(result.keys.size).toBe(1);
  });

  it('animates only unseen events after seeding', () => {
    const current = event();
    const seen = new Set<string>();

    const first = selectMilestonePulse({ frame: frame([current]), seen, seeded: true });
    expect(first.event?.id).toBe('event-1');

    const second = selectMilestonePulse({
      frame: frame([current]),
      seen: first.keys,
      seeded: true,
    });
    expect(second.event).toBeNull();
  });

  it('selects the latest unseen event when several arrive together', () => {
    const result = selectMilestonePulse({
      frame: frame([
        event({ id: 'a', sourceId: `${TX}:1` }),
        event({ id: 'b', sourceId: `${TX}:2` }),
      ]),
      seen: new Set(),
      seeded: true,
    });
    expect(result.event?.id).toBe('b');
  });

  it('suppresses pulses during REORG_RECOVERY', () => {
    const result = selectMilestonePulse({
      frame: frame([event()], 'REORG_RECOVERY'),
      seen: new Set(),
      seeded: true,
    });
    expect(result.event).toBeNull();
  });

  it('prunes withdrawn events from the seen set', () => {
    const withdrawn = milestoneKey(56, `${TX}:9`, SCENE);
    const result = selectMilestonePulse({
      frame: frame([event()]),
      seen: new Set([withdrawn]),
      seeded: true,
    });
    expect(result.keys.has(withdrawn)).toBe(false);
    expect(result.keys.size).toBe(1);
  });
});
