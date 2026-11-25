import type { RoutePoint } from './agent';

const PLACES = ['plaza', 'market', 'governance', 'registry', 'works'] as const;
export type Place = (typeof PLACES)[number];
export type AgentStart = Place | 'plazaNorth';
type Junction = AgentStart | 'eastAvenue';
export type ResidentId = '01' | '03';
export type Connection = { points: RoutePoint[]; alternate: RoutePoint[] };
export type EastRoutes = Record<'avenue' | 'registry' | 'works', Connection>;
export type Visits = Record<Place, number>;

const INTERESTS: Record<ResidentId, Visits> = {
  '01': { plaza: 1.5, market: 3.2, governance: 2.6, registry: 2.6, works: 3.0 },
  '03': { plaza: 1.8, market: 2.4, governance: 3.4, registry: 3.15, works: 2.4 },
};

export const DESTINATION_FACING: Record<Place, [number, number]> = {
  plaza: [0, 12.15],
  market: [13.7, 54.91],
  governance: [0, -95],
  registry: [80, -18],
  works: [95, 78],
};

type Edge = { to: Junction; connection: Connection; lengths: Record<keyof Connection, number> };
type Path = { points: RoutePoint[]; metres: number };

export function placeAt(junction: AgentStart): Place {
  return junction === 'plazaNorth' ? 'plaza' : junction;
}

function lengthOf(points: RoutePoint[]) {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    const [x, y, z] = points[index]!;
    const [px, py, pz] = points[index - 1]!;
    length += Math.hypot(x - px, y - py, z - pz);
  }
  return length;
}

export function createNavigation() {
  let graph = new Map<Junction, Edge[]>();

  function connect(from: Junction, to: Junction, connection: Connection) {
    if (graph.get(from)?.some((edge) => edge.to === to)) return;
    const { points, alternate } = connection;
    const lengths = { points: lengthOf(points), alternate: lengthOf(alternate) };
    if (Object.values(lengths).some((length) => !Number.isFinite(length) || length <= 0)) {
      throw new Error(`Invalid connection from ${from} to ${to}`);
    }
    const incoming = { points: [...points].reverse(), alternate: [...alternate].reverse() };
    for (const [junction, leg] of [[from, connection], [to, incoming]] as const) {
      const saved = graph.get(junction)?.[0]?.connection;
      for (const lane of ['points', 'alternate'] as const) {
        const start = leg[lane][0]!;
        if (saved && start.some((value, axis) => value !== saved[lane][0]![axis])) {
          throw new Error(`Disconnected ${lane} at ${junction}`);
        }
      }
    }
    graph.set(from, [...(graph.get(from) ?? []), { to, connection, lengths }]);
    graph.set(to, [...(graph.get(to) ?? []), {
      to: from,
      lengths,
      connection: incoming,
    }]);
  }

  function connectEast(routes: EastRoutes) {
    const previous = graph;
    graph = new Map(previous);
    try {
      connect('plaza', 'eastAvenue', routes.avenue);
      connect('eastAvenue', 'registry', routes.registry);
      connect('eastAvenue', 'works', routes.works);
    } catch (error) {
      graph = previous;
      throw error;
    }
  }

  function path(id: ResidentId, from: Junction, destination: Place): Path | undefined {
    const lane = id === '01' ? 'points' : 'alternate';
    const open = new Map<Junction, Path>([[from, { points: [], metres: 0 }]]);
    const visited = new Set<Junction>();
    while (open.size) {
      const [at, travelled] = [...open].reduce((shortest, entry) => entry[1].metres < shortest[1].metres ? entry : shortest);
      if (at === destination) return travelled;
      open.delete(at);
      visited.add(at);
      for (const edge of graph.get(at) ?? []) {
        if (visited.has(edge.to)) continue;
        const metres = travelled.metres + edge.lengths[lane];
        const existing = open.get(edge.to);
        if (existing && existing.metres <= metres) continue;
        const segment = edge.connection[lane];
        const points = travelled.points.length ? travelled.points.concat(segment.slice(1)) : segment;
        open.set(edge.to, { points, metres });
      }
    }
  }

  function choose(id: ResidentId, from: AgentStart, visits: Visits) {
    let chosen: { destination: Place; path: Path; score: number } | undefined;
    for (const destination of PLACES) {
      if (destination === placeAt(from)) continue;
      const route = path(id, from, destination);
      if (!route) continue;
      const score = INTERESTS[id][destination] / (1 + visits[destination]) - route.metres / 250;
      if (!chosen || score > chosen.score) chosen = { destination, path: route, score };
    }
    return chosen;
  }

  return { connect, connectEast, choose };
}
