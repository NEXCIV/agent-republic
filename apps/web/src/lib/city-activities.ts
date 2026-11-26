import type { CityPoint } from './cafe-geometry';
import { CITY_MAP, planCityWalk } from './city-navigation';
import { routeDistance, type CityRegion, type CityWalk } from './city-movement';

export type CityPerson = { id: string; name: string; position: CityPoint };
export type CitySite = { place: string; name: string; people: CityPerson[]; facilities: Array<{ id: string; name: string }> };
type CityActionKind = 'talk' | 'rest' | 'work';
export type CityActionOption = { id: string; label: string; kind: CityActionKind; target: string };
type Checkpoint = { name: string; x: number; z: number };
type Action = CityActionOption & (
  | { kind: 'talk'; person: CityPerson; question: string; reply: string }
  | { kind: 'rest'; restored: number }
  | { kind: 'work'; energyCost: number; checkpoints: Checkpoint[] }
);
type Venue = CitySite & { entrance: CityPoint; reach: number; actions: Action[] };
type CityActivityEvent = {
  type: 'started' | 'reply' | 'checkpoint' | 'completed';
  at: number;
  text: string;
  speaker?: string;
  position?: CityPoint;
};
export type CityActivity = {
  requestId: string;
  actionId: string;
  kind: CityActionKind;
  label: string;
  place: string;
  person?: CityPerson;
  startedAt: number;
  endsAt: number;
  energyAfter: number;
  events: CityActivityEvent[];
  walk?: CityWalk;
};
export type CityActivityView = Omit<CityActivity, 'walk' | 'energyAfter'> & {
  status: 'running' | 'completed';
  energyAfter?: number;
};

const works = CITY_MAP.places.find(({ id }) => id === 'works')!;
const manager: CityPerson = { id: 'works.manager', name: '现场管理员', position: [96.5, 0.203, 72.4] };
const venues: Venue[] = [{
  place: works.id, name: works.name, entrance: works.position, reach: 3,
  people: [manager],
  facilities: [{ id: 'works.forecourt', name: '入口等候区' }, { id: 'works.survey', name: '施工巡查路线' }],
  actions: [
    {
      id: 'works.chat', kind: 'talk', label: '询问现场管理员', target: manager.id, person: manager,
      question: '今天现场有什么需要帮忙的？',
      reply: '可以沿入口外的步道巡查两个点位，走完回到门口，系统会记下到访时间。',
    },
    { id: 'works.rest', kind: 'rest', label: '在入口等候区休息', target: 'works.forecourt', restored: 18 },
    {
      id: 'works.patrol', kind: 'work', label: '巡查施工点', target: 'works.survey', energyCost: 12,
      checkpoints: [
        { name: '入口外侧步道', x: 95, z: 67.346 },
        { name: '施工区人行通道', x: 95, z: 60.55 },
      ],
    },
  ],
}];

export function nearbyCitySite(position: CityPoint | null) {
  const venue = position && venues.find((entry) => routeDistance(position, entry.entrance) <= entry.reach);
  if (!venue) return null;
  const { place, name, people, facilities, actions } = venue;
  return { site: { place, name, people, facilities }, actions };
}

export function availableCityActions(actions: Action[], energy: number): CityActionOption[] {
  return actions.filter((action) => action.kind !== 'work' || energy >= action.energyCost)
    .map(({ id, label, kind, target }) => ({ id, label, kind, target }));
}

export function cityActivityView(activity: CityActivity, at: number): CityActivityView {
  const { requestId, actionId, kind, label, place, person, startedAt, endsAt, events, energyAfter } = activity;
  const completed = at >= endsAt;
  return {
    requestId, actionId, kind, label, place, person, startedAt, endsAt,
    status: completed ? 'completed' : 'running',
    events: events.filter((event) => event.at <= at),
    ...(completed ? { energyAfter } : {}),
  };
}

export function beginCityActivity(action: Action, place: string, position: CityPoint, energy: number, requestId: string, at: number): CityActivity | null {
  const events: CityActivityEvent[] = [{ type: 'started', at, text: action.label }];
  const base = { requestId, actionId: action.id, kind: action.kind, label: action.label, place, startedAt: at, events };
  if (action.kind === 'talk') {
    const endsAt = at + 6000;
    events[0] = { type: 'started', at, speaker: '01 号', text: action.question };
    events.push({ type: 'reply', at: endsAt, speaker: action.person.name, text: action.reply });
    return { ...base, person: action.person, endsAt, energyAfter: energy };
  }
  if (action.kind === 'rest') {
    const endsAt = at + 8000;
    const energyAfter = Math.min(100, energy + action.restored);
    events.push({ type: 'completed', at: endsAt, text: `休息结束，精力 ${energy} → ${energyAfter}。` });
    return { ...base, endsAt, energyAfter };
  }

  const points = [position];
  const regions = new Set<CityRegion>();
  const arrivals: Array<{ name: string; position: CityPoint; metres: number }> = [];
  const home = { x: position[0], z: position[2] };
  let metres = 0;
  for (const stop of [...action.checkpoints, { ...home, name: '' }]) {
    const leg = planCityWalk(points.at(-1)!, { x: stop.x, z: stop.z });
    if (!leg) return null;
    points.push(...leg.points.slice(1));
    for (const region of leg.regions) regions.add(region);
    metres += leg.metres;
    if (stop.name) arrivals.push({ name: stop.name, position: points.at(-1)!, metres });
  }
  if (metres <= 0) return null;
  const duration = Math.ceil(metres * 1000 / 1.6);
  const endsAt = at + duration;
  for (const arrival of arrivals) {
    events.push({
      type: 'checkpoint', at: at + Math.ceil(duration * arrival.metres / metres),
      position: arrival.position, text: `已到达${arrival.name}。`,
    });
  }
  events.push({ type: 'completed', at: endsAt, text: `已走完 ${arrivals.length} 个巡查点并返回出发点。` });
  const walk: CityWalk = { requestId, name: action.label, destination: home, points, regions: [...regions], metres, startedAt: at, arrivesAt: endsAt };
  return { ...base, endsAt, energyAfter: energy - action.energyCost, walk };
}
