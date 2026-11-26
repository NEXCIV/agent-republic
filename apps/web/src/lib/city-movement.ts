import type { CityPoint } from './cafe-geometry';
import type { CityActionOption, CityActivityView, CitySite } from './city-activities';

export const CITY_PLACES = {
  cafe: '咖啡摊', plaza: '中央广场', market: 'Corner Market', governance: '议会大厅',
  registry: '公民注册中心', works: '公共建设中心', forum: '社区剧场',
  pier: '北岸码头', center: 'Agent 中心', residence: '花园住宅',
} as const;

export type CityRegion = 'north' | 'east' | 'west' | 'shore' | 'research' | 'residential';
export type CityDestination = { place: string } | { x: number; z: number };
export type CityRoute = {
  destination: CityDestination;
  name: string;
  points: CityPoint[];
  regions: CityRegion[];
  metres: number;
};
export type CityWalk = CityRoute & { requestId: string; startedAt: number; arrivesAt: number; facing?: [number, number] };
export type CityMovement = CityWalk & { status: 'walking' | 'arrived' };
export type CityObservation = {
  agentId: '01';
  serverTime: number;
  position: CityPoint | null;
  movement: CityMovement | null;
  canMove: boolean;
  reason?: string;
  energy: number;
  nearby: CitySite | null;
  availableActions: CityActionOption[];
  recentActivities: CityActivityView[];
};

export function routeDistance(a: CityPoint, b: CityPoint) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

export function positionOnWalk(walk: CityWalk, time: number): CityPoint {
  if (time >= walk.arrivesAt) return walk.points.at(-1)!;
  if (time <= walk.startedAt) return walk.points[0]!;
  let remaining = walk.metres * (time - walk.startedAt) / (walk.arrivesAt - walk.startedAt);
  for (let i = 1; i < walk.points.length; i++) {
    const from = walk.points[i - 1]!;
    const to = walk.points[i]!;
    const span = routeDistance(from, to);
    if (remaining <= span && span > 0) {
      const ratio = remaining / span;
      return [from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio, from[2] + (to[2] - from[2]) * ratio];
    }
    remaining -= span;
  }
  return walk.points.at(-1)!;
}
