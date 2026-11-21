import { describe, expect, it } from 'vitest';
import { MAX_VISIBLE_AGENTS } from '@agent-republic/domain';
import type { WorldSimulation } from '@agent-republic/domain';
import { agentColor, toAgentMarkers } from '../src/features/world-3d/agents/toAgentMarkers';
import {
  AGENT_SPEED_METRES_PER_SECOND,
  distanceBetween,
  shouldSnapAgent,
  stepAgentPosition,
} from '../src/features/world-3d/agents/motion';

/**
 * E6-04 — simulation markers and local interpolation.
 *
 * The renderer must accept only valid WorldFrame positions, never invent an
 * agent, never place one inside a building, and never move faster than 1.4 m/s.
 */

type SimAgent = WorldSimulation['agents'][number];

function agent(
  agentId: string,
  position: readonly [number, number, number],
  overrides: Partial<SimAgent> = {},
): SimAgent {
  return {
    agentId,
    position,
    facingRadians: 0,
    action: 'IDLE',
    locationId: 'PLAZA',
    isSimulated: true,
    ...overrides,
  };
}

describe('toAgentMarkers', () => {
  it('accepts at most 30 agents and keeps their IDs', () => {
    const agents = Array.from({ length: 30 }, (_, index) =>
      agent(`agent-${index}`, [Math.cos(index) * 2, 0, Math.sin(index) * 2]),
    );

    const markers = toAgentMarkers(agents);
    expect(markers).toHaveLength(MAX_VISIBLE_AGENTS);
    expect(markers.map((marker) => marker.id)).toEqual(agents.map((entry) => entry.agentId));
  });

  it('drops duplicate IDs and anything beyond the display cap', () => {
    const agents = [
      agent('dup', [0, 0, 0]),
      agent('dup', [1, 0, 1]),
      ...Array.from({ length: 40 }, (_, index) => agent(`extra-${index}`, [2, 0, 2])),
    ];

    const markers = toAgentMarkers(agents);
    expect(markers).toHaveLength(MAX_VISIBLE_AGENTS);
    expect(markers.filter((marker) => marker.id === 'dup')).toHaveLength(1);
  });

  it('allows the plaza but rejects points inside buildings', () => {
    const markers = toAgentMarkers([
      agent('plaza', [0, 0, 0]),
      agent('council', [-9, 0, -6]),
      agent('identity', [9, 0, -6]),
      agent('project', [-8, 0, 9]),
      agent('core', [9, 0, 9]),
    ]);

    expect(markers.map((marker) => marker.id)).toEqual(['plaza']);
  });

  it('rejects out-of-district, non-finite and empty IDs', () => {
    const markers = toAgentMarkers([
      agent('', [0, 0, 0]),
      agent('far-x', [21, 0, 0]),
      agent('far-z', [0, 0, -21]),
      agent('nan', [Number.NaN, 0, 0]),
      agent('ok', [-2, 0, 2]),
    ]);

    expect(markers.map((marker) => marker.id)).toEqual(['ok']);
  });

  it('assigns a stable colour derived from the agent ID', () => {
    const first = agentColor('agent-7');
    const second = agentColor('agent-7');
    expect(first).toBe(second);
    expect(first).toMatch(/^hsl\(/);
  });
});

describe('agent motion', () => {
  it('caps movement at 1.4 m/s', () => {
    const current = [0, 0, 0] as const;
    const target = [4, 0, 0] as const;
    const next = stepAgentPosition(current, target, 0.1);

    expect(distanceBetween(current, next)).toBeCloseTo(AGENT_SPEED_METRES_PER_SECOND * 0.1, 5);
  });

  it('caps a long frame delta to avoid tab-resume teleports', () => {
    const next = stepAgentPosition([0, 0, 0], [10, 0, 0], 10);
    expect(distanceBetween([0, 0, 0], next)).toBeCloseTo(
      AGENT_SPEED_METRES_PER_SECOND * 0.25,
      5,
    );
  });

  it('returns the target once the remaining distance fits in one step', () => {
    const target = [4, 0, 0] as const;
    expect(stepAgentPosition([3.8, 0, 0], target, 0.2)).toBe(target);
    expect(stepAgentPosition([4, 0, 0], target, 0.2)).toBe(target);
  });

  it('snaps only when the client is far behind the latest frame', () => {
    expect(shouldSnapAgent([0, 0, 0], [4, 0, 0])).toBe(false);
    expect(shouldSnapAgent([0, 0, 0], [10, 0, 0])).toBe(true);
  });
});
