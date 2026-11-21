import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { worldFrameV1Schema, type WorldFrameV1 } from '@agent-republic/domain';
import {
  canonicalize,
  computeFrameId,
  FrameCanonicalizationError,
  withFrameId,
} from '../src/index.js';

/**
 * E5-01 frame identity tests (W-01): replaying the same confirmed facts and
 * tick must yield a byte-identical frameId, independent of key order,
 * generation time or a stale embedded id.
 */

const fixturePath = fileURLToPath(new URL('../../../examples/world-frame.demo.json', import.meta.url));
const demoFrame = JSON.parse(readFileSync(fixturePath, 'utf8')) as WorldFrameV1 & { frameId?: string };

const withoutId = (frame: WorldFrameV1): Omit<WorldFrameV1, 'frameId'> => {
  const rest: Record<string, unknown> = { ...frame };
  delete rest.frameId;
  return rest as Omit<WorldFrameV1, 'frameId'>;
};

describe('canonicalize', () => {
  it('sorts object keys recursively and keeps array order', () => {
    expect(canonicalize({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe('{"a":[2,{"c":3,"d":4}],"b":1}');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalize({ value: Number.NaN })).toThrow(FrameCanonicalizationError);
    expect(() => canonicalize([Number.POSITIVE_INFINITY])).toThrow(FrameCanonicalizationError);
  });

  it('rejects unsupported values instead of stringifying them', () => {
    expect(() => canonicalize({ fn: () => undefined })).toThrow(FrameCanonicalizationError);
  });
});

describe('computeFrameId', () => {
  it('is independent of object key order', () => {
    const frame = withoutId(demoFrame);
    const reordered = Object.fromEntries(Object.entries(frame).reverse()) as Omit<WorldFrameV1, 'frameId'>;
    expect(computeFrameId(reordered)).toBe(computeFrameId(frame));
  });

  it('ignores generatedAt and any embedded frameId', () => {
    const frame = withoutId(demoFrame);
    const baseline = computeFrameId(frame);
    expect(computeFrameId({ ...frame, generatedAt: '2030-01-01T00:00:00.000Z' })).toBe(baseline);
    expect(computeFrameId({ ...frame, frameId: `0x${'00'.repeat(32)}` })).toBe(baseline);
  });

  it('changes when a confirmed fact changes', () => {
    const frame = withoutId(demoFrame);
    const changed = {
      ...frame,
      facts: {
        ...frame.facts,
        projects: frame.facts.projects.map((project) => ({ ...project, fundedBuild: '1' })),
      },
    };
    expect(computeFrameId(changed)).not.toBe(computeFrameId(frame));
    expect(computeFrameId(frame)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('changes when a simulated position changes (identity covers the scene)', () => {
    const frame = withoutId(demoFrame);
    const moved = {
      ...frame,
      simulation: {
        ...frame.simulation,
        agents: frame.simulation.agents.map((agent, index) =>
          index === 0 ? { ...agent, position: [1, 0, 1] as [number, number, number] } : agent,
        ),
      },
    };
    expect(computeFrameId(moved)).not.toBe(computeFrameId(frame));
  });

  it('matches the stored id of the DEMO fixture', () => {
    expect(demoFrame.frameId).toBeDefined();
    expect(computeFrameId(demoFrame)).toBe(demoFrame.frameId);
  });
});

describe('withFrameId', () => {
  it('produces a schema-valid frame whose id matches its content', () => {
    const frame = withoutId(demoFrame);
    const withId = withFrameId(frame);
    expect(worldFrameV1Schema.parse(withId).frameId).toBe(computeFrameId(frame));
  });
});
