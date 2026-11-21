import { describe, expect, it } from 'vitest';
import { worldFrameV1Schema } from '@agent-republic/domain';
import {
  buildWorldFrame,
  computeFrameId,
  epochIdFromTimestamp,
  getSceneManifest,
  sceneManifestHash,
  WorldFrameBuildError,
  type BuildWorldFrameInput,
} from '../src/index.js';

/**
 * E5-06 frame assembly tests: the API may only serve frames that fully parse,
 * and the frameId must depend on content, not on generation time.
 */

const H = (seed: number): string => `0x${seed.toString(16).padStart(64, '0')}`;

const input = (): BuildWorldFrameInput => ({
  source: {
    chainId: 56,
    blockNumber: '70000000',
    blockHash: H(700),
    blockTimestamp: '2026-11-19T07:59:48.000Z',
    confirmedDepth: 12,
    sync: 'LIVE',
  },
  facts: {
    citizenCount: 2,
    projects: [
      {
        id: '1',
        titleKey: 'GOLDEN_TOILET_TOWER',
        goalBuild: '2000',
        fundedBuild: '0',
        status: 'FUNDING',
        completedAtBlock: null,
      },
    ],
    proposals: [],
  },
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

describe('epochIdFromTimestamp', () => {
  it('uses the UTC day of the confirmed block time', () => {
    expect(epochIdFromTimestamp('2026-11-19T00:00:00.000Z')).toBe(20776);
    expect(epochIdFromTimestamp('2026-11-19T23:59:59.999Z')).toBe(20776);
    expect(epochIdFromTimestamp('2026-11-20T00:00:00.000Z')).toBe(20777);
  });

  it('rejects an unparseable timestamp', () => {
    expect(() => epochIdFromTimestamp('not-a-date')).toThrow(WorldFrameBuildError);
  });
});

describe('buildWorldFrame', () => {
  it('produces a schema-valid frame with provenance fixed to CHAIN_CONFIRMED', () => {
    const frame = buildWorldFrame(input());
    expect(() => worldFrameV1Schema.parse(frame)).not.toThrow();
    expect(frame.source.provenance).toBe('CHAIN_CONFIRMED');
    expect(frame.epochId).toBe(20776);
    expect(frame.frameId).toBe(computeFrameId(frame));
  });

  it('is content-deterministic: generatedAt does not change the frameId', () => {
    const first = buildWorldFrame(input());
    const later = buildWorldFrame({ ...input(), generatedAt: '2026-11-19T09:00:00.000Z' });
    expect(later.frameId).toBe(first.frameId);
    expect(later.generatedAt).not.toBe(first.generatedAt);
  });

  it('changes the frameId when confirmed facts change', () => {
    const base = buildWorldFrame(input());
    const changed = input();
    const funded = buildWorldFrame({
      ...changed,
      facts: {
        ...changed.facts,
        projects: changed.facts.projects.map((project) => ({ ...project, fundedBuild: '500' })),
      },
    });
    expect(funded.frameId).not.toBe(base.frameId);
  });

  it('accepts a reorg-recovery sync state', () => {
    const frame = buildWorldFrame({ ...input(), source: { ...input().source, sync: 'REORG_RECOVERY' } });
    expect(frame.source.sync).toBe('REORG_RECOVERY');
  });

  it('refuses to build an invalid frame instead of serving it', () => {
    const invalid = input();
    invalid.simulation = {
      ...invalid.simulation,
      agents: Array.from({ length: 31 }, (_, index) => ({
        agentId: `agent-${index}`,
        position: [0, 0, 0] as [number, number, number],
        facingRadians: 0,
        action: 'IDLE' as const,
        locationId: 'PLAZA' as const,
        isSimulated: true as const,
      })),
    };
    expect(() => buildWorldFrame(invalid)).toThrow(WorldFrameBuildError);
  });
});

describe('scene manifest payload', () => {
  it('publishes the validated district with a stable content hash', () => {
    const manifest = getSceneManifest();
    expect(manifest.sceneVersion).toBe('district-01@1');
    expect(manifest.manifestHash).toBe(sceneManifestHash());
    expect(manifest.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(getSceneManifest().manifestHash).toBe(manifest.manifestHash);
  });
});
