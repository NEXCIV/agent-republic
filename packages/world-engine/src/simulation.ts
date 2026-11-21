import {
  DISTRICT_01_WAYPOINTS,
  DISTRICT_01_EDGES,
  MAX_VISIBLE_AGENTS,
  type AgentAction,
  type AgentLocation,
  type WaypointId,
} from '@agent-republic/domain';

/**
 * E5-05 deterministic 60-second simulation step (docs/WORLD_ENGINE.md §4–§5).
 *
 * Movement rules:
 * - agents live on the fixed waypoint graph; one adjacent hop per tick
 * - the hop is chosen by a hash of `worldSeed|tick|agentId`, never Math.random
 * - P9..P12 sit at building entrances; waypoints are outside all footprints
 * - the step never touches chain state, never calls an LLM, never uses a clock
 *
 * The output contains positions/actions only; economic values stay in `facts`.
 */

export const MAX_AGENTS_PER_STEP = MAX_VISIBLE_AGENTS;

/** Probability of attempting a hop on a given tick (deterministic roll). */
const HOP_PROBABILITY = 0.7;

const ENTRANCE_LOCATIONS: Readonly<Partial<Record<WaypointId, AgentLocation>>> = {
  P9: 'COUNCIL',
  P10: 'IDENTITY',
  P11: 'PROJECT',
  P12: 'CORE',
};

export type SimAgentState = {
  readonly agentId: string;
  readonly waypointId: WaypointId;
  readonly action: AgentAction;
  readonly locationId: AgentLocation;
  readonly facingRadians: number;
};

export type SimulatedAgentPosition = {
  readonly agentId: string;
  readonly position: [number, number, number];
  readonly facingRadians: number;
  readonly action: AgentAction;
  readonly locationId: AgentLocation;
  readonly isSimulated: true;
};

export type SimVisualEventDraft = {
  readonly id: string;
  readonly kind: 'MOVE' | 'DISCUSSION' | 'MILESTONE' | 'WORLD_ALERT';
  readonly targetId: string;
  readonly happenedAtTick: string;
  readonly sourceType: 'CHAIN' | 'OFFCHAIN';
  readonly sourceId: string;
};

export type SimStepInput = {
  readonly worldSeed: string;
  readonly tick: bigint;
  readonly agents: readonly SimAgentState[];
  readonly waypoints?: Readonly<Record<WaypointId, readonly [number, number, number]>>;
  readonly edges?: ReadonlyArray<readonly [WaypointId, WaypointId]>;
  readonly maxAgents?: number;
};

export type SimStepResult = {
  readonly tick: string;
  readonly agents: readonly SimulatedAgentPosition[];
  readonly visualEvents: readonly SimVisualEventDraft[];
  readonly movedAgents: number;
};

export class SimulationError extends Error {
  constructor(message: string) {
    super(`[world-sim] ${message}`);
    this.name = 'SimulationError';
  }
}

/** FNV-1a 32-bit — stable across runtimes, no platform crypto dependency. */
function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: tiny deterministic PRNG seeded by a 32-bit value. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildAdjacency(
  edges: ReadonlyArray<readonly [WaypointId, WaypointId]>,
): Map<WaypointId, WaypointId[]> {
  const adjacency = new Map<WaypointId, WaypointId[]>();
  const ensure = (id: WaypointId): WaypointId[] => {
    const existing = adjacency.get(id);
    if (existing !== undefined) return existing;
    const created: WaypointId[] = [];
    adjacency.set(id, created);
    return created;
  };
  for (const [left, right] of edges) {
    ensure(left).push(right);
    ensure(right).push(left);
  }
  for (const neighbours of adjacency.values()) {
    neighbours.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  return adjacency;
}

const DEFAULT_ADJACENCY = buildAdjacency(DISTRICT_01_EDGES);

function locationFor(waypointId: WaypointId): AgentLocation {
  return ENTRANCE_LOCATIONS[waypointId] ?? 'PLAZA';
}

export function positionOf(
  waypointId: WaypointId,
  waypoints: Readonly<Record<WaypointId, readonly [number, number, number]>>,
): [number, number, number] {
  const point = waypoints[waypointId];
  if (point === undefined) {
    throw new SimulationError(`unknown waypoint "${waypointId}"`);
  }
  return [point[0], point[1], point[2]];
}

/**
 * Deterministic initial placement: waypoint and facing derived from
 * `worldSeed|init|agentId`, never from user or model input.
 */
export function initialAgentStates(input: {
  readonly worldSeed: string;
  readonly agentIds: readonly string[];
  readonly maxAgents?: number;
}): SimAgentState[] {
  const limit = Math.min(input.maxAgents ?? MAX_AGENTS_PER_STEP, MAX_AGENTS_PER_STEP);
  const ids = [...new Set(input.agentIds)].sort().slice(0, limit);
  const waypointIds = Object.keys(DISTRICT_01_WAYPOINTS).sort() as WaypointId[];

  return ids.map((agentId) => {
    const random = createRandom(hash32(`${input.worldSeed}|init|${agentId}`));
    const waypointId = waypointIds[Math.floor(random() * waypointIds.length)]!;
    return {
      agentId,
      waypointId,
      action: 'IDLE',
      locationId: locationFor(waypointId),
      facingRadians: 0,
    };
  });
}

/**
 * Advances the simulation exactly one tick.
 * Same input → byte-identical output (agent order is sorted by id).
 */
export function stepSimulation(input: SimStepInput): SimStepResult {
  if (input.worldSeed.trim() === '') {
    throw new SimulationError('worldSeed must not be empty');
  }
  if (input.tick < 0n) {
    throw new SimulationError('tick must be non-negative');
  }

  const waypoints = input.waypoints ?? DISTRICT_01_WAYPOINTS;
  const adjacency = input.edges === undefined ? DEFAULT_ADJACENCY : buildAdjacency(input.edges);
  const limit = Math.min(input.maxAgents ?? MAX_AGENTS_PER_STEP, MAX_AGENTS_PER_STEP);

  const agents = [...input.agents].sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));
  if (agents.length > limit) {
    throw new SimulationError(`agent count ${agents.length} exceeds the limit ${limit}`);
  }

  const tick = input.tick.toString();
  const simulated: SimulatedAgentPosition[] = [];
  const visualEvents: SimVisualEventDraft[] = [];
  let movedAgents = 0;

  for (const agent of agents) {
    const from = positionOf(agent.waypointId, waypoints);
    const neighbours = adjacency.get(agent.waypointId) ?? [];
    const random = createRandom(hash32(`${input.worldSeed}|${tick}|${agent.agentId}`));

    let nextWaypoint = agent.waypointId;
    let action: AgentAction = 'IDLE';
    let facingRadians = agent.facingRadians;

    if (neighbours.length > 0 && random() < HOP_PROBABILITY) {
      nextWaypoint = neighbours[Math.floor(random() * neighbours.length)]!;
      action = 'WALK';
      movedAgents += 1;

      const to = positionOf(nextWaypoint, waypoints);
      const dx = to[0] - from[0];
      const dz = to[2] - from[2];
      facingRadians = Math.atan2(dx, dz);
    }

    const position = positionOf(nextWaypoint, waypoints);
    simulated.push({
      agentId: agent.agentId,
      position,
      facingRadians,
      action,
      locationId: locationFor(nextWaypoint),
      isSimulated: true,
    });

    if (nextWaypoint !== agent.waypointId) {
      visualEvents.push({
        id: `${tick}:${agent.agentId}:MOVE`,
        kind: 'MOVE',
        targetId: agent.agentId,
        happenedAtTick: tick,
        sourceType: 'OFFCHAIN',
        sourceId: agent.agentId,
      });
    }
  }

  return { tick, agents: simulated, visualEvents, movedAgents };
}

/** Converts simulated agents back into the next tick's input state. */
export function toSimAgentStates(
  agents: readonly SimulatedAgentPosition[],
  waypoints: Readonly<Record<WaypointId, readonly [number, number, number]>> = DISTRICT_01_WAYPOINTS,
): SimAgentState[] {
  return agents.map((agent) => {
    const match = (Object.keys(waypoints) as WaypointId[]).find((id) => {
      const point = waypoints[id];
      return (
        point !== undefined &&
        point[0] === agent.position[0] &&
        point[1] === agent.position[1] &&
        point[2] === agent.position[2]
      );
    });
    if (match === undefined) {
      throw new SimulationError(`agent ${agent.agentId} is not standing on a waypoint`);
    }
    return {
      agentId: agent.agentId,
      waypointId: match,
      action: agent.action,
      locationId: agent.locationId,
      facingRadians: agent.facingRadians,
    };
  });
}
