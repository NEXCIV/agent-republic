import { describe, expect, it } from 'vitest';
import { DISTRICT_01_EDGES, DISTRICT_01_WAYPOINTS, type WaypointId } from '@agent-republic/domain';
import {
  initialAgentStates,
  MAX_AGENTS_PER_STEP,
  SimulationError,
  stepSimulation,
  toSimAgentStates,
  type SimAgentState,
  type SimStepResult,
} from '../src/index.js';

/**
 * E5-05 determinism tests: the same seed/tick must always produce the same
 * positions and visual events, agents move one waypoint hop per tick, and no
 * agent ever leaves the legal graph.
 */

const AGENT_IDS = ['agent-03', 'agent-01', 'agent-02'];
const SEED = 'genesis-2026';

const edges = new Set(
  DISTRICT_01_EDGES.flatMap(([left, right]) => [
    left < right ? `${left}|${right}` : `${right}|${left}`,
  ]),
);

const isAdjacentOrSame = (from: WaypointId, to: WaypointId): boolean =>
  from === to || edges.has(from < to ? `${from}|${to}` : `${to}|${from}`);

const waypointAt = (position: readonly [number, number, number]): WaypointId => {
  const match = (Object.keys(DISTRICT_01_WAYPOINTS) as WaypointId[]).find((id) => {
    const point = DISTRICT_01_WAYPOINTS[id];
    return point[0] === position[0] && point[1] === position[1] && point[2] === position[2];
  });
  if (match === undefined) throw new Error(`no waypoint at ${position.join(',')}`);
  return match;
};

function runTicks(seed: string, ticks: number): SimStepResult[] {
  let states: SimAgentState[] = initialAgentStates({ worldSeed: seed, agentIds: AGENT_IDS });
  const results: SimStepResult[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const step = stepSimulation({ worldSeed: seed, tick: BigInt(tick), agents: states });
    results.push(step);
    states = toSimAgentStates(step.agents);
  }
  return results;
}

describe('initialAgentStates', () => {
  it('is deterministic and sorted by agent id', () => {
    const first = initialAgentStates({ worldSeed: SEED, agentIds: AGENT_IDS });
    const second = initialAgentStates({ worldSeed: SEED, agentIds: [...AGENT_IDS].reverse() });
    expect(first).toEqual(second);
    expect(first.map((agent) => agent.agentId)).toEqual(['agent-01', 'agent-02', 'agent-03']);
  });

  it('places every agent on a real waypoint', () => {
    for (const agent of initialAgentStates({ worldSeed: SEED, agentIds: AGENT_IDS })) {
      expect(DISTRICT_01_WAYPOINTS[agent.waypointId]).toBeDefined();
      expect(agent.action).toBe('IDLE');
    }
  });

  it('caps the roster at 30 agents and de-duplicates ids', () => {
    const ids = Array.from({ length: 40 }, (_, index) => `agent-${String(index).padStart(3, '0')}`);
    const states = initialAgentStates({ worldSeed: SEED, agentIds: [...ids, 'agent-000'] });
    expect(states).toHaveLength(MAX_AGENTS_PER_STEP);
    expect(new Set(states.map((agent) => agent.agentId)).size).toBe(MAX_AGENTS_PER_STEP);
  });

  it('changes placement when the seed changes', () => {
    expect(initialAgentStates({ worldSeed: 'other-seed', agentIds: AGENT_IDS })).not.toEqual(
      initialAgentStates({ worldSeed: SEED, agentIds: AGENT_IDS }),
    );
  });
});

describe('stepSimulation', () => {
  it('is byte-identical for the same seed and tick', () => {
    const states = initialAgentStates({ worldSeed: SEED, agentIds: AGENT_IDS });
    expect(stepSimulation({ worldSeed: SEED, tick: 42n, agents: states })).toEqual(
      stepSimulation({ worldSeed: SEED, tick: 42n, agents: states }),
    );
  });

  it('is independent of the input array order', () => {
    const states = initialAgentStates({ worldSeed: SEED, agentIds: AGENT_IDS });
    const shuffled = [...states].reverse();
    expect(stepSimulation({ worldSeed: SEED, tick: 7n, agents: shuffled })).toEqual(
      stepSimulation({ worldSeed: SEED, tick: 7n, agents: states }),
    );
  });

  it('moves at most one adjacent hop per tick', () => {
    let states = initialAgentStates({ worldSeed: SEED, agentIds: AGENT_IDS });
    for (let tick = 0; tick < 200; tick += 1) {
      const step = stepSimulation({ worldSeed: SEED, tick: BigInt(tick), agents: states });
      const next = toSimAgentStates(step.agents);
      states.forEach((before, index) => {
        const after = next[index];
        expect(after).toBeDefined();
        expect(isAdjacentOrSame(before.waypointId, after!.waypointId)).toBe(true);
      });
      states = next;
    }
  });

  it('emits MOVE only for agents that actually moved, with unique ids', () => {
    let states = initialAgentStates({ worldSeed: SEED, agentIds: AGENT_IDS });
    const seenIds = new Set<string>();
    for (let tick = 0; tick < 20; tick += 1) {
      const step = stepSimulation({ worldSeed: SEED, tick: BigInt(tick), agents: states });
      const next = toSimAgentStates(step.agents);
      const movers = states.filter((agent, index) => agent.waypointId !== next[index]!.waypointId);

      expect(step.visualEvents).toHaveLength(movers.length);
      expect(step.movedAgents).toBe(movers.length);
      for (const event of step.visualEvents) {
        expect(event.kind).toBe('MOVE');
        expect(event.sourceType).toBe('OFFCHAIN');
        expect(event.happenedAtTick).toBe(String(tick));
        expect(seenIds.has(event.id)).toBe(false);
        seenIds.add(event.id);
      }
      states = next;
    }
  });

  it('keeps agents inside the district', () => {
    for (const step of runTicks(SEED, 60)) {
      for (const agent of step.agents) {
        expect(Math.abs(agent.position[0])).toBeLessThanOrEqual(20);
        expect(Math.abs(agent.position[2])).toBeLessThanOrEqual(20);
        expect(agent.isSimulated).toBe(true);
      }
    }
  });

  it('produces the same 60-tick sequence on every replay', () => {
    expect(runTicks(SEED, 60)).toEqual(runTicks(SEED, 60));
  });

  it('differs across seeds for at least one tick', () => {
    expect(runTicks(SEED, 30)).not.toEqual(runTicks('another-seed', 30));
  });

  it('rejects empty seeds, negative ticks and invalid waypoints', () => {
    const states = initialAgentStates({ worldSeed: SEED, agentIds: AGENT_IDS });
    expect(() => stepSimulation({ worldSeed: '  ', tick: 1n, agents: states })).toThrow(SimulationError);
    expect(() => stepSimulation({ worldSeed: SEED, tick: -1n, agents: states })).toThrow(SimulationError);

    const invalid = [{ ...states[0]!, waypointId: 'P99' as WaypointId }];
    expect(() => stepSimulation({ worldSeed: SEED, tick: 1n, agents: invalid })).toThrow(SimulationError);
  });

  it('refuses more agents than the display cap', () => {
    const tooMany: SimAgentState[] = Array.from({ length: 31 }, (_, index) => ({
      agentId: `agent-${index}`,
      waypointId: 'P0',
      action: 'IDLE',
      locationId: 'PLAZA',
      facingRadians: 0,
    }));
    expect(() => stepSimulation({ worldSeed: SEED, tick: 1n, agents: tooMany })).toThrow(SimulationError);
  });

  it('round-trips simulated positions back into waypoint state', () => {
    const states = initialAgentStates({ worldSeed: SEED, agentIds: AGENT_IDS });
    const step = stepSimulation({ worldSeed: SEED, tick: 3n, agents: states });
    const roundTripped = toSimAgentStates(step.agents);
    for (const agent of roundTripped) {
      expect(waypointAt(DISTRICT_01_WAYPOINTS[agent.waypointId])).toBe(agent.waypointId);
    }
  });
});
