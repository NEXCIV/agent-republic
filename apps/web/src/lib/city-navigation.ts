import market from '../../public/nexciv-walk/route.json';
import north from '../../public/nexciv-walk/nexus-connector.json';
import governance from '../../public/nexciv-walk/governance-route.json';
import east from '../../public/nexciv-walk/east-routes.json';
import west from '../../public/nexciv-walk/west-route.json';
import shore from '../../public/nexciv-walk/lakeshore-route.json';
import research from '../../public/nexciv-walk/research-route.json';
import residential from '../../public/nexciv-walk/residential-route.json';
import { cafeApproach, CAFE_COUNTER, CAFE_BENCH_FRONT, FISHING_SPOT, type CityPoint } from './cafe-geometry';
import { COUNCIL_NOTICE_APPROACH } from './council-notice';
import { CITY_PLACES, routeDistance, type CityDestination, type CityRegion, type CityRoute } from './city-movement';

type Segment = { from: CityPoint; to: CityPoint; region?: CityRegion };
type Connection = { to: CityPoint; metres: number; region?: CityRegion };
type Projection = { segment: Segment; point: CityPoint; ratio: number; offset: number };
const COORDINATE_TOLERANCE = 0.75;
const key = (point: CityPoint) => point.join(',');

function surveyed(points: number[][]): CityPoint[] {
  if (points.length < 2 || points.some((point) => point.length !== 3 || !point.every(Number.isFinite))) {
    throw new Error('Invalid NEXCIV walking survey');
  }
  return points as CityPoint[];
}

const marketPoints = surveyed(market.points);
const segments: Segment[] = [];
function add(points: CityPoint[], region?: CityRegion) {
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    if (routeDistance(from, to) > 0) segments.push({ from, to, region });
  }
}
add(marketPoints);
add(cafeApproach(marketPoints));
add([CAFE_BENCH_FRONT, CAFE_COUNTER]);
add(surveyed(north.points), 'north');
add(surveyed(governance.points), 'north');
add(COUNCIL_NOTICE_APPROACH, 'north');
add(surveyed(east.avenue.points), 'east');
add(surveyed(east.registry.points), 'east');
add(surveyed(east.works.points), 'east');
add(surveyed(west.points), 'west');
add(surveyed(shore.points), 'shore');
add([surveyed(shore.points).at(-1)!, FISHING_SPOT], 'shore');
add(surveyed(research.points), 'research');
add(surveyed(residential.points), 'residential');

const locations = {
  cafe: CAFE_COUNTER,
  plaza: marketPoints[0]!,
  market: marketPoints.at(-1)!,
  governance: surveyed(governance.points).at(-1)!,
  registry: surveyed(east.registry.points).at(-1)!,
  works: surveyed(east.works.points).at(-1)!,
  forum: surveyed(west.points).at(-1)!,
  pier: surveyed(shore.points).at(-1)!,
  center: surveyed(research.points).at(-1)!,
  residence: surveyed(residential.points).at(-1)!,
} satisfies Record<keyof typeof CITY_PLACES, CityPoint>;

const points = segments.flatMap(({ from, to }) => [from, to]);
export const CITY_MAP = {
  agentId: '01',
  coordinates: '使用地面 X、Z（米），高度由服务器根据步道计算。',
  coordinateToleranceMetres: COORDINATE_TOLERANCE,
  bounds: {
    minX: Math.min(...points.map(([x]) => x)), maxX: Math.max(...points.map(([x]) => x)),
    minZ: Math.min(...points.map(([, , z]) => z)), maxZ: Math.max(...points.map(([, , z]) => z)),
  },
  places: (Object.keys(locations) as (keyof typeof locations)[]).map((id) => ({
    id, name: CITY_PLACES[id], position: locations[id],
  })),
};

export function cityRestingPoint(place?: string, observer = false) {
  if (place === 'bench') return CAFE_BENCH_FRONT;
  if (place === 'pier') return observer ? locations.pier : FISHING_SPOT;
  return CAFE_COUNTER;
}

function project(x: number, z: number): Projection | undefined {
  let closest: Projection | undefined;
  for (const segment of segments) {
    const { from, to } = segment;
    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    const span = dx * dx + dz * dz;
    if (span === 0) continue;
    const ratio = Math.max(0, Math.min(1, ((x - from[0]) * dx + (z - from[2]) * dz) / span));
    const point: CityPoint = ratio === 0 ? from : ratio === 1 ? to
      : [from[0] + dx * ratio, from[1] + (to[1] - from[1]) * ratio, from[2] + dz * ratio];
    const offset = Math.hypot(x - point[0], z - point[2]);
    if (!closest || offset < closest.offset) closest = { segment, point, ratio, offset };
  }
  return closest && closest.offset <= COORDINATE_TOLERANCE ? closest : undefined;
}

function walkGraph(projections: Projection[]) {
  const graph = new Map<string, Connection[]>();
  function connect(from: CityPoint, to: CityPoint, region?: CityRegion) {
    const metres = routeDistance(from, to);
    if (metres < 1e-7) return;
    const id = key(from);
    const links = graph.get(id) ?? [];
    links.push({ to, metres, region });
    graph.set(id, links);
  }
  for (const segment of segments) {
    const via = projections.filter((point) => point.segment === segment).sort((a, b) => a.ratio - b.ratio);
    const line = [segment.from, ...via.map(({ point }) => point), segment.to];
    for (let i = 1; i < line.length; i++) {
      connect(line[i - 1]!, line[i]!, segment.region);
      connect(line[i]!, line[i - 1]!, segment.region);
    }
  }
  return graph;
}

export function planCityWalk(origin: CityPoint, destination: CityDestination): CityRoute | null {
  const named = 'place' in destination;
  if (named && !Object.hasOwn(locations, destination.place)) return null;
  const start = project(origin[0], origin[2]);
  const end = named
    ? project(locations[destination.place as keyof typeof locations][0], locations[destination.place as keyof typeof locations][2])
    : project(destination.x, destination.z);
  if (!start || !end) return null;
  // Preserve the exact stored point when snapping a previously accepted destination back onto the network.
  if (routeDistance(origin, start.point) < 1e-7) start.point = origin;
  const goal = key(end.point);
  const startId = key(start.point);
  const graph = walkGraph([start, end]);
  const open = new Map([[startId, 0]]);
  const visited = new Set<string>();
  const previous = new Map<string, { from: string; link: Connection }>();
  while (open.size) {
    const [at, metres] = [...open].reduce((best, item) => item[1] < best[1] ? item : best);
    if (at === goal) {
      const path = [end.point];
      const regions = new Set<CityRegion>();
      if (end.segment.region) regions.add(end.segment.region);
      for (let entry = previous.get(at); entry; entry = previous.get(entry.from)) {
        if (entry.link.region) regions.add(entry.link.region);
        if (entry.from !== startId) path.push(previous.get(entry.from)!.link.to);
        else path.push(start.point);
      }
      if (start.segment.region) regions.add(start.segment.region);
      return {
        destination, name: named ? CITY_PLACES[destination.place as keyof typeof locations] : `坐标 (${end.point[0].toFixed(2)}, ${end.point[2].toFixed(2)})`,
        points: path.reverse(), regions: [...regions].reverse(), metres,
      };
    }
    open.delete(at);
    visited.add(at);
    for (const link of graph.get(at) ?? []) {
      const next = key(link.to);
      const distance = metres + link.metres;
      if (visited.has(next) || (open.get(next) ?? Infinity) <= distance) continue;
      open.set(next, distance);
      previous.set(next, { from: at, link });
    }
  }
  return null;
}
