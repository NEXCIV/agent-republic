import type { CityPoint } from './cafe-geometry';
import type { CityActionOption, CityActivityView, CitySite, LightingPilot, LightingSurveyStage } from './city-activities';
import type { EveningWalk } from './evening-stroll';
import type { TheatreView } from './theatre-trial';

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
type CityWalkStop = {
  startsAt: number;
  endsAt: number;
  position: CityPoint;
  facing: [number, number];
};
export type CityWalk = CityRoute & {
  requestId: string;
  startedAt: number;
  arrivesAt: number;
  facing?: [number, number];
  stops?: CityWalkStop[];
};
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
  lightingSurvey?: LightingSurveyStage;
  lightingRecords?: CityActivityView[];
  lightingPilot?: LightingPilot;
  eveningWalk: EveningWalk;
  theatre?: TheatreView;
  availableActions: CityActionOption[];
  recentActivities: CityActivityView[];
};

export function routeDistance(a: CityPoint, b: CityPoint) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

export function cityWalkTiming(walk: CityWalk, time: number) {
  let walkingMs = walk.arrivesAt - walk.startedAt;
  let walkedMs = time - walk.startedAt;
  let stop: CityWalkStop | undefined;
  for (const planned of walk.stops ?? []) {
    const holdMs = planned.endsAt - planned.startsAt;
    walkingMs -= holdMs;
    walkedMs -= Math.max(0, Math.min(holdMs, time - planned.startsAt));
    if (time >= planned.startsAt && time < planned.endsAt) stop = planned;
  }
  const progress = walkingMs > 0 ? Math.min(1, Math.max(0, walkedMs / walkingMs)) : Number(time >= walk.arrivesAt);
  return { walkingMs, progress, stop };
}

export function positionOnWalk(walk: CityWalk, time: number): CityPoint {
  if (time >= walk.arrivesAt) return walk.points.at(-1)!;
  if (time <= walk.startedAt) return walk.points[0]!;
  const { progress, stop } = cityWalkTiming(walk, time);
  if (stop) return stop.position;
  let remaining = walk.metres * progress;
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
