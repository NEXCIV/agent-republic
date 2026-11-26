import type { CityPoint } from './cafe-geometry';
import { COUNCIL_DEMO_AGENDA, COUNCIL_NOTICE_BOARD, COUNCIL_NOTICE_READING_SPOT, COUNCIL_SURVEY_RECEIPT } from './council-notice';
import { CITY_MAP, planCityWalk } from './city-navigation';
import { routeDistance, type CityRegion, type CityWalk } from './city-movement';

export type CityPerson = { id: string; name: string; position: CityPoint };
export type CitySite = { place: string; name: string; people: CityPerson[]; facilities: Array<{ id: string; name: string }> };
type CityActionKind = 'talk' | 'rest' | 'work' | 'read' | 'survey' | 'report';
export type CityActionOption = { id: string; label: string; kind: CityActionKind; target: string };
type Checkpoint = { name: string; x: number; z: number };
type Action = CityActionOption & (
  | { kind: 'talk'; person: CityPerson; question: string; reply: string }
  | { kind: 'rest'; restored: number }
  | { kind: 'work'; energyCost: number; checkpoints: Checkpoint[] }
  | { kind: 'read'; board: string; text: string; destination: { x: number; z: number }; facing: [number, number] }
  | { kind: 'survey' | 'report' }
);
type Venue = CitySite & { entrance: CityPoint; reach: number; actions: Action[] };
type CityActivityEvent = {
  type: 'started' | 'reply' | 'checkpoint' | 'observation' | 'completed';
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

export type LightingSurveyStage = 'available' | 'surveying' | 'ready' | 'submitted';
export const COUNCIL_LIGHTING_ACTIONS = ['governance.read', 'governance.survey', 'governance.submit'] as const;
const [READ_AGENDA, SURVEY_LIGHTS, SUBMIT_REPORT] = COUNCIL_LIGHTING_ACTIONS;
const councilFacing: [number, number] = [COUNCIL_NOTICE_BOARD[0], COUNCIL_NOTICE_BOARD[2]];
const surveyStops: Array<Checkpoint & { facing: [number, number]; finding: string }> = [
  {
    name: '北岸步道入口', x: 5, z: -165.3, facing: [5, -169.24],
    finding: '北岸步道入口旁已有一座高位灯，灯杆位于岸边一侧。',
  },
  {
    name: '东侧临水步道', x: 13, z: -165.3, facing: [13, -169.24],
    finding: '两座高位灯相隔 16 米，中段没有独立灯具。',
  },
];
const SURVEY_STOP_MS = 4500;

export function councilLightingSurvey(activities: CityActivity[], at: number): { stage: LightingSurveyStage; report?: string } | undefined {
  if (activities.some((activity) => activity.actionId === SUBMIT_REPORT && activity.endsAt <= at)) {
    return { stage: 'submitted' };
  }
  const survey = activities.find((activity) => activity.actionId === SURVEY_LIGHTS);
  if (survey) {
    if (survey.endsAt > at) return { stage: 'surveying' };
    const findings = survey.events.filter(({ type }) => type === 'observation').map(({ text }) => text);
    if (findings.length === surveyStops.length) {
      return {
        stage: 'ready',
        report: `DEMO · ${COUNCIL_SURVEY_RECEIPT}。${findings.join('')}建议在东侧临水步道中段试设一盏低位步道灯，靠岸侧布置并留出行人通道。`,
      };
    }
  }
  if (activities.some((activity) => activity.actionId === READ_AGENDA && activity.endsAt <= at)) return { stage: 'available' };
}

const works = CITY_MAP.places.find(({ id }) => id === 'works')!;
const governance = CITY_MAP.places.find(({ id }) => id === 'governance')!;
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
}, {
  place: governance.id, name: governance.name, entrance: governance.position, reach: 10,
  people: [],
  facilities: [{ id: 'governance.notice', name: '议事公告栏' }],
  actions: [{
    id: READ_AGENDA, kind: 'read', label: '查看议事公告', target: 'governance.notice',
    board: '议事公告栏', destination: COUNCIL_NOTICE_READING_SPOT,
    facing: councilFacing,
    text: `DEMO 议程：讨论${COUNCIL_DEMO_AGENDA.join('和')}。`,
  }, {
    id: SURVEY_LIGHTS, kind: 'survey', label: '调研湖畔步道路灯', target: 'governance.notice',
  }, {
    id: SUBMIT_REPORT, kind: 'report', label: '提交路灯调研报告', target: 'governance.notice',
  }],
}];

export function nearbyCitySite(position: CityPoint | null, lightingSurvey?: LightingSurveyStage) {
  if (!position) return null;
  const venue = venues.find((entry) => routeDistance(position, entry.entrance) <= entry.reach);
  if (!venue) return null;
  const { place, name, people, facilities, actions } = venue;
  const atNotice = Math.hypot(position[0] - COUNCIL_NOTICE_READING_SPOT.x, position[2] - COUNCIL_NOTICE_READING_SPOT.z) <= 1.8;
  return {
    site: { place, name, people, facilities },
    actions: actions.filter(({ kind }) => {
      if (kind === 'survey') return atNotice && lightingSurvey === 'available';
      if (kind === 'report') return atNotice && lightingSurvey === 'ready';
      return true;
    }),
  };
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

function activityRoute(position: CityPoint, stops: Array<{ x: number; z: number }>) {
  const points = [position];
  const regions = new Set<CityRegion>();
  const arrivals: Array<{ position: CityPoint; metres: number }> = [];
  let metres = 0;
  for (const { x, z } of stops) {
    const leg = planCityWalk(points.at(-1)!, { x, z });
    if (!leg) return null;
    points.push(...leg.points.slice(1));
    for (const region of leg.regions) regions.add(region);
    metres += leg.metres;
    arrivals.push({ position: points.at(-1)!, metres });
  }
  return metres > 0 ? { points, regions: [...regions], metres, arrivals } : null;
}

export function beginCityActivity(action: Action, place: string, position: CityPoint, energy: number, requestId: string, at: number, report?: string): CityActivity | null {
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
  if (action.kind === 'read') {
    const route = planCityWalk(position, action.destination);
    if (!route) return null;
    const arrivesAt = at + Math.ceil(route.metres * 1000 / 1.6);
    const endsAt = arrivesAt + 4500;
    events[0] = { type: 'started', at, text: `前往${action.board}。` };
    events.push(
      { type: 'checkpoint', at: arrivesAt, position: route.points.at(-1)!, text: `已到达${action.board}。` },
      { type: 'completed', at: endsAt, text: action.text },
    );
    const walk: CityWalk = {
      // The surveyed shore path starts in the northern forecourt, where the kiosk is already loaded.
      ...route, regions: ['north'], name: action.board, requestId, startedAt: at, arrivesAt, facing: action.facing,
    };
    return { ...base, endsAt, energyAfter: energy, walk };
  }

  if (action.kind === 'report') {
    if (!report) return null;
    events.push({ type: 'completed', at, text: report });
    return { ...base, endsAt: at, energyAfter: energy };
  }
  const lighting = action.kind === 'survey';
  const home = lighting ? COUNCIL_NOTICE_READING_SPOT : { x: position[0], z: position[2] };
  const checkpoints = action.kind === 'work' ? action.checkpoints : surveyStops;
  const route = activityRoute(position, [...checkpoints, home]);
  if (!route) return null;
  const { points, regions, metres, arrivals } = route;
  const walkingMs = Math.ceil(metres * 1000 / (lighting ? 4 : 1.6));
  const holdMs = lighting ? SURVEY_STOP_MS : 0;
  const endsAt = at + walkingMs + holdMs * checkpoints.length;
  const stops: NonNullable<CityWalk['stops']> = [];
  checkpoints.forEach((checkpoint, index) => {
    const arrival = arrivals[index]!;
    const startsAt = at + Math.ceil(walkingMs * arrival.metres / metres) + index * holdMs;
    events.push({ type: 'checkpoint', at: startsAt, position: arrival.position, text: `已到达${checkpoint.name}。` });
    if (lighting) {
      const { finding, facing } = surveyStops[index]!;
      const endsAt = startsAt + holdMs;
      stops.push({ startsAt, endsAt, position: arrival.position, facing });
      events.push({ type: 'observation', at: endsAt, position: arrival.position, text: finding });
    }
  });
  events.push({
    type: 'completed', at: endsAt,
    text: lighting ? '已带着两处观察记录返回议事公告栏。' : `已走完 ${checkpoints.length} 个巡查点并返回出发点。`,
  });
  const walk: CityWalk = {
    requestId, name: action.label, destination: home, points, regions, metres, startedAt: at, arrivesAt: endsAt,
    ...(lighting ? { stops, facing: councilFacing } : {}),
  };
  return { ...base, endsAt, energyAfter: action.kind === 'work' ? energy - action.energyCost : energy, walk };
}
