import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CityPoint } from './cafe-geometry';
import { cityActivityView, type CityActivity, type CityActivityView, type LightingPilot } from './city-activities';
import { positionOnWalk, type CityDestination, type CityMovement, type CityRoute, type CityWalk } from './city-movement';
import { planCityWalk } from './city-navigation';

export const EVENING_STROLL_ACTION = 'resident.evening-walk';
const START: CityPoint = [37, 0.19, -165.3];
const GOAL = '傍晚找个地方散步，也可以回家休息。';
const ROUTES = [
  { id: 'waterfront', name: '东侧临水步道', destination: { x: 13, z: -165.3 }, facing: [13, -169.24] },
  { id: 'main-path', name: '北岸主步道路灯旁', destination: { x: 21, z: -165.3 }, facing: [21, -169.24] },
  { id: 'home', name: '花园住宅入口', destination: { place: 'residence' }, facing: [95, -59] },
] satisfies Array<{ id: string; name: string; destination: CityDestination; facing: [number, number] }>;

export const eveningChoiceSchema = z.object({
  observationId: z.string().regex(/^[a-f0-9]{64}$/),
  optionId: z.enum(['waterfront', 'main-path', 'home']),
  reasonId: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
}).strict();
export type EveningChoice = z.infer<typeof eveningChoiceSchema>;
type Lighting = { state: 'not-installed' | 'lit'; detail: string; source?: { activityId: string; litAt: number; position: CityPoint } };
type Observation = { observationId: string; position: CityPoint; energy: number; lighting: Lighting };
type Option = { id: string; name: string; metres: number; energyCost: number; reasons: { id: string; text: string }[] };
export type EveningRecord = CityActivity & {
  agentId: '03';
  walk: CityWalk;
  energyAfter: number;
  energyAtArrival: number;
  selection: EveningChoice;
  observation: Observation;
  reason: string;
};
export type EveningResult = {
  status: 'running' | 'completed';
  selection: EveningChoice;
  observation: Observation;
  reason: string;
  activity: CityActivityView;
  movement: CityMovement;
};
export type EveningWalk = Observation & {
  agentId: '03';
  goal: string;
  timeOfDay: 'dusk';
  options: Option[];
  recent: EveningResult[];
};

function lightingAt(pilot: LightingPilot | undefined): Lighting {
  return pilot?.stage === 'lit'
    ? { state: 'lit', detail: '东侧临水步道中段的一盏低位试点灯已亮。', source: { ...pilot.lamp, activityId: pilot.worker.activity.requestId } }
    : { state: 'not-installed', detail: '东侧两盏高位灯相隔约 16 米，中段的低位试点灯尚未亮起。' };
}

export function eveningResult(record: EveningRecord, at: number): EveningResult {
  const { observation, reason, selection, walk } = record;
  return {
    status: at < record.endsAt ? 'running' : 'completed', selection, observation, reason,
    activity: cityActivityView(record, at),
    movement: { ...walk, status: at < walk.arrivesAt ? 'walking' : 'arrived' },
  };
}

function optionsAt(position: CityPoint, energy: number, lighting: Lighting) {
  return ROUTES.flatMap(({ id, name, destination }): Option[] => {
    const route = planCityWalk(position, destination);
    if (!route) return [];
    const energyCost = Math.ceil(route.metres / 12);
    if (id !== 'home' && energyCost > energy) return [];
    const reasons: Option['reasons'] = id === 'waterfront'
      ? [{ id: 'waterfront-view', text: '想沿水边走走，看看湖面。' }]
      : id === 'main-path' ? [{ id: 'existing-lamp', text: '想沿主步道走到现有高位灯旁。' }]
      : [{ id: 'rest', text: '想回花园住宅休息，恢复精力。' }];
    if (id === 'waterfront' && lighting.state === 'lit') {
      reasons.push({ id: 'pilot-light', text: '东侧中段的低位灯已亮，想去那一段散步。' });
    }
    if (id === 'main-path' && lighting.state === 'not-installed') {
      reasons.push({ id: 'pilot-pending', text: '临水中段的试点灯尚未亮起，今天想先走有高位灯的主步道。' });
    }
    return [{ id, name, metres: Math.round(route.metres), energyCost, reasons }];
  });
}

export function observeEveningWalk(resident: string, records: EveningRecord[], pilot: LightingPilot | undefined, at: number, busy = false): EveningWalk {
  const latest = records[0];
  const energy = !latest ? 64 : at < latest.walk.arrivesAt ? latest.observation.energy
    : at < latest.endsAt ? latest.energyAtArrival : latest.energyAfter;
  const position = latest ? positionOnWalk(latest.walk, at) : START;
  const lighting = lightingAt(pilot);
  const observationId = createHash('sha256').update(JSON.stringify([resident, lighting.state, lighting.source?.activityId, latest?.requestId])).digest('hex');
  const alreadyChose = records.some((record) => record.observation.lighting.state === lighting.state);
  const options = busy || alreadyChose || (latest && latest.endsAt > at)
    ? [] : optionsAt(position, energy, lighting);
  return { agentId: '03', goal: GOAL, timeOfDay: 'dusk', observationId, position, energy, lighting, options,
    recent: records.map((record) => eveningResult(record, at)) };
}

export function beginEveningWalk(view: EveningWalk, selection: EveningChoice, requestId: string, at: number): EveningRecord | null {
  const selected = view.options.find(({ id }) => id === selection.optionId);
  const reason = selected?.reasons.find(({ id }) => id === selection.reasonId)?.text;
  if (!selected || !reason) return null;
  const destination = ROUTES.find(({ id }) => id === selected.id)!;
  const path: CityRoute | null = planCityWalk(view.position, destination.destination);
  if (!path) return null;
  const { observationId, position, energy, lighting } = view;
  const home = selected.id === 'home';
  const arrivesAt = at + Math.ceil(path.metres * 1000 / 1.6);
  const endsAt = arrivesAt + (home ? 8000 : 3500);
  const spot = path.points.at(-1)!;
  const energyAtArrival = Math.max(0, energy - selected.energyCost);
  const energyAfter = Math.min(100, energyAtArrival + (home ? 18 : 0));
  return {
    actionId: EVENING_STROLL_ACTION, requestId, agentId: '03', kind: 'stroll',
    label: home ? '回花园住宅休息' : `散步至${selected.name}`, place: home ? 'residence' : 'pier',
    startedAt: at, endsAt, energyAfter, energyAtArrival, selection, observation: { observationId, position, energy, lighting }, reason,
    walk: { ...path, name: selected.name, requestId, startedAt: at, arrivesAt, facing: destination.facing },
    events: [
      { type: 'started', at, speaker: '03 号', text: reason },
      { type: 'checkpoint', at: arrivesAt, position: spot, text: `已到达${selected.name}。` },
      { type: 'completed', at: endsAt, position: spot,
        text: home ? `DEMO · 休息结束，精力 ${energyAtArrival} → ${energyAfter}。` : `DEMO · 散步结束，已在${selected.name}短暂停留。` },
    ],
  };
}
