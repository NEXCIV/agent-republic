import { DISTRICT_01, MAX_VISIBLE_AGENTS } from '@agent-republic/domain';
import type { WorldSimulation } from '@agent-republic/domain';

/**
 * E6-04 — pure validation/adaptation of simulation agents for rendering.
 *
 * Positions come only from WorldFrameV1.simulation. This adapter rejects
 * malformed or out-of-district points and any point inside a building
 * footprint, so the renderer can never draw an agent through a wall or invent
 * a citizen. Colours are deterministic from the agent ID and never the only
 * identifier: the page renders an HTML table with the same IDs.
 */

export type AgentMarker = {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly facingRadians: number;
  readonly action: WorldSimulation['agents'][number]['action'];
  readonly locationId: WorldSimulation['agents'][number]['locationId'];
  readonly color: string;
};

/** Collision margin around building footprints, in metres. */
export const AGENT_RADIUS = 0.3;

const BUILDINGS = DISTRICT_01.landmarks.filter((landmark) => landmark.id !== 'PLAZA');

/** Muted teal/brass/steel hues; saturation stays low to match the civic plan. */
const AGENT_HUES = [168, 32, 190, 12, 96, 260, 150, 58];

export function agentIdHash(agentId: string): number {
  let hash = 0;
  for (let index = 0; index < agentId.length; index += 1) {
    hash = (hash * 31 + agentId.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function agentColor(agentId: string): string {
  const hash = agentIdHash(agentId);
  return `hsl(${AGENT_HUES[hash % AGENT_HUES.length]}, 30%, 64%)`;
}

export function isInsideBuilding(x: number, z: number): boolean {
  return BUILDINGS.some((landmark) => {
    const [width, , depth] = landmark.bounds;
    const [cx, , cz] = landmark.position;
    return (
      Math.abs(x - cx) < width / 2 + AGENT_RADIUS && Math.abs(z - cz) < depth / 2 + AGENT_RADIUS
    );
  });
}

export function toAgentMarkers(agents: WorldSimulation['agents']): AgentMarker[] {
  const seen = new Set<string>();
  const markers: AgentMarker[] = [];

  for (const agent of agents) {
    if (markers.length >= MAX_VISIBLE_AGENTS) break;
    if (agent.agentId.length === 0 || seen.has(agent.agentId)) continue;

    const [x, y, z] = agent.position;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (Math.abs(x) > 20 || Math.abs(z) > 20) continue;
    if (isInsideBuilding(x, z)) continue;

    seen.add(agent.agentId);
    markers.push({
      id: agent.agentId,
      position: [x, y, z],
      facingRadians: Number.isFinite(agent.facingRadians) ? agent.facingRadians : 0,
      action: agent.action,
      locationId: agent.locationId,
      color: agentColor(agent.agentId),
    });
  }

  return markers;
}
