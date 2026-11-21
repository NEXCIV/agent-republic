import type { LandmarkId } from '@agent-republic/domain';
import type { AgentMarker } from '../agents/toAgentMarkers';
import type { WorldBuildingLink } from '../webgl';

/**
 * E6-05 — selection state shared by 3D picking and the semantic HTML panel.
 * The renderer and the panel resolve the same IDs, so a click and the
 * keyboard-accessible directory can never disagree about the target.
 */

export type WorldSelection =
  | { readonly type: 'BUILDING'; readonly id: LandmarkId }
  | { readonly type: 'AGENT'; readonly id: string };

export type ResolvedSelection = {
  readonly building: WorldBuildingLink | null;
  readonly agent: AgentMarker | null;
};

export function resolveSelection(
  selection: WorldSelection,
  buildings: readonly WorldBuildingLink[],
  agents: readonly AgentMarker[],
): ResolvedSelection {
  if (selection.type === 'BUILDING') {
    return {
      building: buildings.find((building) => building.id === selection.id) ?? null,
      agent: null,
    };
  }
  return {
    building: null,
    agent: agents.find((agent) => agent.id === selection.id) ?? null,
  };
}
