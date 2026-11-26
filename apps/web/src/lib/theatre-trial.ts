import { z } from 'zod';
import type { CityPoint } from './cafe-geometry';
import { type CityWalk, positionOnWalk, routeDistance } from './city-movement';
import { planCityWalk } from './city-navigation';
import { THEATRE_AISLE, THEATRE_STAGE } from './theatre-layout';

const RESIDENTS = ['01', '03'] as const;
export type TheatreResidentId = typeof RESIDENTS[number];
const SLOTS = [
  { id: 'early', name: '傍晚第一场', waitSeconds: 55 },
  { id: 'late', name: '傍晚第二场', waitSeconds: 105 },
] as const;
type Slot = typeof SLOTS[number]['id'];
const TITLE = '社区剧场傍晚试演';
const OPEN_MS = 50000;
const REVISIONS = 3;
const ENERGY_TO_ATTEND = 12;
const SPEED = 4;
const facing: [number, number] = [THEATRE_STAGE[0], THEATRE_STAGE[2]];

const residentId = z.enum(RESIDENTS);
const slotId = z.enum(['early', 'late']);
export const theatreDecisionSchema = z.object({
  revision: z.number().int().min(0).max(10), agentId: residentId,
  decision: z.enum(['propose', 'counter', 'accept', 'decline', 'attend', 'skip']), slot: slotId.optional(),
}).strict().refine(({ decision, slot }) => (decision === 'propose' || decision === 'counter') === (slot !== undefined));
export type TheatreDecision = z.infer<typeof theatreDecisionSchema>;
type Decision = TheatreDecision['decision'];
type Option = Omit<TheatreDecision, 'revision'>;
type Booking = { slot: Slot; name: string; opensAt: number; closesAt: number };
type Offer = { by: TheatreResidentId; slot: Slot };
type Journey = { walk: CityWalk; gateAt: number; entersAt: number; seatedAt: number };
type Attendance = { kind: 'absent' } | { kind: 'attend'; journey: Journey };
type Phase = 'available' | 'negotiating' | 'cancelled' | 'scheduled' | 'open' | 'finished';
type Status = 'undecided' | 'absent' | 'en-route' | 'waiting' | 'entering' | 'seated' | 'leaving' | 'departed';
type TheatreEvent = {
  id: string; at: number; type: Decision | 'open' | 'wait' | 'enter' | 'seat' | 'close' | 'missed'; text: string;
  agentId?: TheatreResidentId;
};
type ResidentView = {
  status: Status; energy: number; busy: boolean; position: CityPoint | null; travelSeconds?: number;
  walk?: CityWalk; seatedAt?: number;
};
export type TheatreView = {
  revision: number; title: string; phase: Phase; slots: typeof SLOTS; offer?: Offer; booking?: Booking;
  residents: Record<TheatreResidentId, ResidentView>;
  availableActions: Option[]; attendees: TheatreResidentId[]; events: TheatreEvent[];
};
type ResidentContext = { position: CityPoint | null; energy: number; busy: boolean };
export type TheatreContext = Record<TheatreResidentId, ResidentContext>;
export type TheatreTrial = {
  commands: Array<{ requestId: string; choice: TheatreDecision }>;
  events: TheatreEvent[];
  attendance: Partial<Record<TheatreResidentId, Attendance>>;
  offer?: Offer;
  booking?: Booking;
  cancelled?: boolean;
};

const slotFor = (id: Slot) => SLOTS.find((slot) => slot.id === id)!;
const other = (id: TheatreResidentId): TheatreResidentId => id === '01' ? '03' : '01';

export function theatreJourney(trial: TheatreTrial | undefined, id: TheatreResidentId) {
  const attendance = trial?.attendance[id];
  return attendance?.kind === 'attend' ? attendance.journey : undefined;
}

function theatrePath(origin: CityPoint, id: TheatreResidentId) {
  const route = planCityWalk(origin, { place: 'forum' });
  if (!route) return;
  const gate = route.points.at(-1)!;
  const { wait, approach, foot } = THEATRE_AISLE[id];
  const gateMetres = route.metres + routeDistance(gate, wait);
  const seatMetres = gateMetres + routeDistance(wait, approach) + routeDistance(approach, foot);
  const points: CityPoint[] = [...route.points, wait, approach, foot, approach, wait, gate];
  const metres = 2 * seatMetres - route.metres;
  return { ...route, name: '社区剧场试演', points, metres, gateMetres, seatMetres };
}

function planJourney(path: NonNullable<ReturnType<typeof theatrePath>>, id: TheatreResidentId, booking: Booking, requestId: string, at: number): Journey | undefined {
  const { gateMetres, seatMetres, ...route } = path;
  const walking = Math.ceil(route.metres * 1000 / SPEED);
  const gateWalking = Math.ceil(walking * gateMetres / route.metres);
  const seatWalking = Math.ceil(walking * seatMetres / route.metres);
  const gateAt = at + gateWalking;
  const entersAt = Math.max(gateAt, booking.opensAt);
  const seatedAt = entersAt + seatWalking - gateWalking;
  if (seatedAt >= booking.closesAt) return;
  const { wait, foot } = THEATRE_AISLE[id];
  const stops: NonNullable<CityWalk['stops']> = [];
  if (gateAt < entersAt) stops.push({ startsAt: gateAt, endsAt: entersAt, position: wait, facing });
  stops.push({ startsAt: seatedAt, endsAt: booking.closesAt, position: foot, facing });
  return {
    gateAt, entersAt, seatedAt,
    walk: { ...route, requestId, startedAt: at, arrivesAt: booking.closesAt + walking - seatWalking, facing, stops },
  };
}

export function observeTheatre(trial: TheatreTrial | undefined, context: TheatreContext, at: number): TheatreView {
  const { booking, offer } = trial ?? {};
  const phase: Phase = booking ? at < booking.opensAt ? 'scheduled' : at < booking.closesAt ? 'open' : 'finished'
    : trial?.cancelled ? 'cancelled' : offer ? 'negotiating' : 'available';
  const availableActions: Option[] = [];
  if (phase === 'available' && !context['01'].busy) {
    for (const { id } of SLOTS) availableActions.push({ agentId: '01', decision: 'propose', slot: id });
  }
  if (phase === 'negotiating' && offer) {
    const agentId = other(offer.by);
    availableActions.push({ agentId, decision: 'accept' }, { agentId, decision: 'decline' });
    if (trial!.commands.length < REVISIONS) {
      availableActions.push({ agentId, decision: 'counter', slot: offer.slot === 'early' ? 'late' : 'early' });
    }
  }
  const attendees: TheatreResidentId[] = [];
  const events = [...(trial?.events ?? [])];
  if (booking && at >= booking.opensAt) {
    events.push({ id: 'theatre.open', at: booking.opensAt, type: 'open', text: '剧场入口亮灯，开始入场。' });
  }
  if (booking && at >= booking.closesAt) {
    events.push({ id: 'theatre.close', at: booking.closesAt, type: 'close', text: '试演结束，入口关闭。' });
  }
  const residents = {} as TheatreView['residents'];
  for (const id of RESIDENTS) {
    const current = context[id];
    const choice = trial?.attendance[id];
    const journey = theatreJourney(trial, id);
    const path = !choice && !current.busy && current.position ? theatrePath(current.position, id) : undefined;
    const travelSeconds = path && Math.ceil(path.seatMetres / SPEED);
    if (booking && at < booking.closesAt && !choice) {
      availableActions.push({ agentId: id, decision: 'skip' });
      if (path && current.energy >= ENERGY_TO_ATTEND && planJourney(path, id, booking, '', at)) {
        availableActions.push({ agentId: id, decision: 'attend' });
      }
    }
    let status: Status = choice?.kind === 'absent' || phase === 'finished' ? 'absent' : 'undecided';
    if (journey && booking) {
      if (at < journey.gateAt) status = 'en-route';
      else if (at < journey.entersAt) status = 'waiting';
      else if (at < journey.seatedAt) status = 'entering';
      else if (at < booking.closesAt) status = 'seated';
      else status = at < journey.walk.arrivesAt ? 'leaving' : 'departed';
      const steps = [
        [journey.gateAt, 'wait', '已到剧场入口。'],
        [journey.entersAt, 'enter', '通过入口，走向观众席。'],
        [journey.seatedAt, 'seat', '已在第一排就座。'],
      ] as const;
      for (const [time, type, text] of steps) {
        if (time <= at) events.push({ id: `${id}.${type}`, at: time, agentId: id, type, text });
      }
      if (at >= journey.seatedAt) attendees.push(id);
    } else if (booking && phase === 'finished' && !choice) {
      events.push({ id: `${id}.missed`, at: booking.closesAt, agentId: id, type: 'missed', text: '本次试演未到场。' });
    }
    const moving = journey && at < journey.walk.arrivesAt;
    const position = status === 'seated' ? THEATRE_AISLE[id].seat : moving ? positionOnWalk(journey.walk, at) : current.position;
    residents[id] = {
      ...current, status, position, busy: current.busy || Boolean(moving),
      ...(travelSeconds === undefined ? {} : { travelSeconds }),
      ...(journey ? { walk: journey.walk, seatedAt: journey.seatedAt } : {}),
    };
  }
  return {
    title: TITLE, revision: trial?.commands.length ?? 0, phase, slots: SLOTS, offer, booking, residents,
    availableActions, attendees, events: events.sort((a, b) => a.at - b.at),
  };
}

export function applyTheatreDecision(trial: TheatreTrial | undefined, context: TheatreContext, choice: TheatreDecision, requestId: string, at: number) {
  const state: TheatreTrial = trial ?? { attendance: {}, commands: [], events: [] };
  const view = observeTheatre(trial, context, at);
  const recorded = state.commands.find((command) => command.requestId === requestId);
  if (recorded) {
    const saved = recorded.choice;
    return saved.agentId === choice.agentId && saved.decision === choice.decision && saved.slot === choice.slot && saved.revision === choice.revision
      ? { state, view, repeated: true } : { error: '请求编号已用于另一项剧场决定。', code: 409 };
  }
  if (view.revision !== choice.revision) return { error: '剧场日程或回应已更新，请重新观察。', code: 409 };
  const { agentId, decision, slot } = choice;
  if (!view.availableActions.some((option) => option.agentId === agentId && option.decision === decision && option.slot === slot)) {
    return { error: '这位居民当前无法执行这项剧场动作。', code: 422 };
  }
  let text: string;
  if (decision === 'propose' || decision === 'counter') {
    state.offer = { by: agentId, slot: slot! };
    text = `${decision === 'counter' ? '改约到' : '提议'}${slotFor(slot!).name}。`;
  } else if (decision === 'accept') {
    const selected = slotFor(state.offer!.slot);
    const opensAt = at + selected.waitSeconds * 1000;
    state.booking = { slot: selected.id, name: selected.name, opensAt, closesAt: opensAt + OPEN_MS };
    text = `接受${selected.name}，场次已公布。`;
  } else if (decision === 'decline') {
    state.cancelled = true;
    text = '谢绝本轮提议，试演未排期。';
  } else if (decision === 'skip') {
    state.attendance[agentId] = { kind: 'absent' };
    text = '决定本场缺席。';
  } else {
    const path = theatrePath(context[agentId].position!, agentId);
    const journey = path && planJourney(path, agentId, state.booking!, requestId, at);
    if (!journey) return { error: '已无法在入口关闭前到达座位。', code: 422 };
    state.attendance[agentId] = { kind: 'attend', journey };
    text = '确认参加，沿步道前往社区剧场。';
  }
  state.commands.push({ requestId, choice });
  state.events.push({ id: requestId, at, agentId, type: decision, text });
  return { state, view: observeTheatre(state, context, at), repeated: false };
}
