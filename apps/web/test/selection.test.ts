import { describe, expect, it } from 'vitest';
import type { AgentMarker } from '../src/features/world-3d/agents/toAgentMarkers';
import { resolveSelection } from '../src/features/world-3d/picking/selection';
import { buildBuildingLinks } from '../src/features/world-3d/webgl';

/**
 * E6-05 — 3D picking and the HTML panel must resolve the same IDs.
 */

const buildings = buildBuildingLinks();
const agents: AgentMarker[] = [
  {
    id: 'agent-1',
    position: [0, 0, 1],
    facingRadians: 0,
    action: 'WALK',
    locationId: 'PLAZA',
    color: 'hsl(168, 30%, 58%)',
  },
];

describe('resolveSelection', () => {
  it('resolves a building to its manifest link and route', () => {
    const resolved = resolveSelection({ type: 'BUILDING', id: 'PROJECT' }, buildings, agents);
    expect(resolved.agent).toBeNull();
    expect(resolved.building?.id).toBe('PROJECT');
    expect(resolved.building?.route).toBe('/projects');
  });

  it('resolves an agent to its marker', () => {
    const resolved = resolveSelection({ type: 'AGENT', id: 'agent-1' }, buildings, agents);
    expect(resolved.building).toBeNull();
    expect(resolved.agent?.action).toBe('WALK');
  });

  it('returns nulls for unknown or mismatched IDs', () => {
    expect(resolveSelection({ type: 'AGENT', id: 'PROJECT' }, buildings, agents)).toEqual({
      building: null,
      agent: null,
    });
    expect(resolveSelection({ type: 'BUILDING', id: 'CORE' }, buildings, [])).toMatchObject({
      building: expect.objectContaining({ id: 'CORE' }),
    });
    expect(resolveSelection({ type: 'AGENT', id: 'missing' }, buildings, agents)).toEqual({
      building: null,
      agent: null,
    });
  });
});
