import { z } from 'zod';
import type { CityPoint } from './cafe-geometry';
import { type CityWalk, positionOnWalk, routeDistance } from './city-movement';
import { planCityWalk } from './city-navigation';
import { THEATRE_AISLE, THEATRE_STAGE } from './theatre-layout';
import { THEATRE_CUES, THEATRE_PROGRAMME_ID, THEATRE_PROGRAMME_NAME, theatreCues, type TheatreCue } from './theatre-programme';

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
const responses = ['keep', 'adjust'] as const;
const cueIds = THEATRE_CUES.map(({ id }) => id) as [TheatreCue['id'], ...TheatreCue['id'][]];
export const theatreDecisionFields = z.object({
  revision: z.number().int().min(0).max(10),
  decision: z.enum(['propose', 'counter', 'accept', 'decline', 'attend', 'skip', 'feedback']), slot: slotId.optional(),
  cue: z.enum(cueIds).optional(), response: z.enum(responses).optional(),
}).strict();
export function validTheatreDecision({ decision, slot, cue, response }: z.infer<typeof theatreDecisionFields>) {
  if (decision === 'feedback') return slot === undefined && cue !== undefined && response !== undefined;
  return cue === undefined && response === undefined && ((decision === 'propose' || decision === 'counter') === (slot !== undefined));
}
export const theatreDecisionSchema = theatreDecisionFields.extend({ agentId: residentId }).refine(validTheatreDecision);
export type TheatreDecision = z.infer<typeof theatreDecisionSchema>;
type Decision = TheatreDecision['decision'];
type Option = Omit<TheatreDecision, 'revision'>;
type Booking = { slot: Slot; name: string; opensAt: number; closesAt: number; programme?: typeof THEATRE_PROGRAMME_ID };
type Offer = { by: TheatreResidentId; slot: Slot };
type Journey = { walk: CityWalk; gateAt: number; entersAt: number; seatedAt: number };
type Attendance = { kind: 'absent' } | { kind: 'attend'; journey: Journey };
type Phase = 'available' | 'negotiating' | 'cancelled' | 'scheduled' | 'open' | 'finished';
type Status = 'undecided' | 'absent' | 'en-route' | 'waiting' | 'entering' | 'seated' | 'leaving' | 'departed';
type TheatreEvent = {
  id: string; at: number; type: Decision | 'open' | 'wait' | 'enter' | 'seat' | 'close' | 'missed' | 'cue'; text: string;
  agentId?: TheatreResidentId;
  cue?: TheatreCue['id'];
  response?: typeof responses[number];
};
type ResidentView = {
  status: Status; energy: number; busy: boolean; position: CityPoint | null; travelSeconds?: number;
  walk?: CityWalk; seatedAt?: number;
  watched: Array<TheatreCue & { seconds: number }>;
};
export type TheatreView = {
  revision: number; title: string; phase: Phase; slots: typeof SLOTS; offer?: Offer; booking?: Booking;
  residents: Record<TheatreResidentId, ResidentView>;
  availableActions: Option[]; attendees: TheatreResidentId[]; events: TheatreEvent[];
  programme?: { title: string; cues: TheatreCue[]; activeCue?: TheatreCue };
};
type ResidentContext = { position: CityPoint | null; energy: number; busy: boolean };
export type TheatreContext = Record<TheatreResidentId, ResidentContext>;
type TheatreRules = { proposers?: readonly TheatreResidentId[]; estimateBeforeBooking?: boolean };
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

export function observeTheatre(trial: TheatreTrial | undefined, context: TheatreContext, at: number,
  { proposers = ['01'], estimateBeforeBooking = true }: TheatreRules = {}): TheatreView {
  const { booking, offer } = trial ?? {};
  const cues = booking?.programme === THEATRE_PROGRAMME_ID ? theatreCues(booking.opensAt) : [];
  const activeCue = cues.find(({ startsAt, endsAt }) => at >= startsAt && at < endsAt);
  const phase: Phase = booking ? at < booking.opensAt ? 'scheduled' : at < booking.closesAt ? 'open' : 'finished'
    : trial?.cancelled ? 'cancelled' : offer ? 'negotiating' : 'available';
  const availableActions: Option[] = [];
  if (phase === 'available') {
    for (const agentId of proposers) if (!context[agentId].busy) {
      for (const { id } of SLOTS) availableActions.push({ agentId, decision: 'propose', slot: id });
    }
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
  for (const cue of cues) {
    if (at >= cue.startsAt) events.push({ id: `cue.${cue.id}`, at: cue.startsAt, type: 'cue', cue: cue.id, text: `舞台进入「${cue.name}」。` });
  }
  if (booking && at >= booking.closesAt) {
    events.push({ id: 'theatre.close', at: booking.closesAt, type: 'close', text: '试演结束，入口关闭。' });
  }
  const residents = {} as TheatreView['residents'];
  for (const id of RESIDENTS) {
    const current = context[id];
    const choice = trial?.attendance[id];
    const journey = theatreJourney(trial, id);
    const estimate = booking ? at < booking.closesAt : estimateBeforeBooking;
    const path = estimate && !choice && !current.busy && current.position ? theatrePath(current.position, id) : undefined;
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
    const watched = journey ? cues.flatMap((cue) => {
      const duration = Math.min(cue.endsAt, at) - Math.max(cue.startsAt, journey.seatedAt);
      return duration >= 3500 ? [{ ...cue, seconds: Math.floor(duration / 1000) }] : [];
    }) : [];
    if (status === 'departed' && !trial?.commands.some(({ choice }) => choice.agentId === id && choice.decision === 'feedback')) {
      for (const { id: cue } of watched) {
        for (const response of responses) availableActions.push({ agentId: id, decision: 'feedback', cue, response });
      }
    }
    residents[id] = {
      ...current, status, position, busy: current.busy || Boolean(moving), watched,
      ...(travelSeconds === undefined ? {} : { travelSeconds }),
      ...(journey ? { walk: journey.walk, seatedAt: journey.seatedAt } : {}),
    };
  }
  return {
    title: TITLE, revision: trial?.commands.length ?? 0, phase, slots: SLOTS, offer, booking, residents,
    availableActions, attendees, events: events.sort((a, b) => a.at - b.at),
    ...(cues.length ? { programme: { title: THEATRE_PROGRAMME_NAME, cues, activeCue } } : {}),
  };
}

export function applyTheatreDecision(trial: TheatreTrial | undefined, context: TheatreContext, choice: TheatreDecision, requestId: string, at: number,
  rules?: TheatreRules) {
  const state: TheatreTrial = trial ?? { attendance: {}, commands: [], events: [] };
  const view = observeTheatre(trial, context, at, rules);
  const recorded = state.commands.find((command) => command.requestId === requestId);
  if (recorded) {
    const saved = recorded.choice;
    return saved.agentId === choice.agentId && saved.decision === choice.decision && saved.slot === choice.slot && saved.revision === choice.revision
      && saved.cue === choice.cue && saved.response === choice.response
      ? { state, view, repeated: true } : { error: '请求编号已用于另一项剧场决定。', code: 409 };
  }
  if (view.revision !== choice.revision) return { error: '剧场日程或回应已更新，请重新观察。', code: 409 };
  const { agentId, decision, slot, cue, response } = choice;
  if (!view.availableActions.some((option) => option.agentId === agentId && option.decision === decision && option.slot === slot
    && option.cue === cue && option.response === response)) {
    return { error: '这位居民当前无法执行这项剧场动作。', code: 422 };
  }
  let text: string;
  if (decision === 'propose' || decision === 'counter') {
    state.offer = { by: agentId, slot: slot! };
    text = `${decision === 'counter' ? '改约到' : '提议'}${slotFor(slot!).name}。`;
  } else if (decision === 'accept') {
    const selected = slotFor(state.offer!.slot);
    const opensAt = at + selected.waitSeconds * 1000;
    state.booking = { slot: selected.id, name: selected.name, opensAt, closesAt: opensAt + OPEN_MS, programme: THEATRE_PROGRAMME_ID };
    text = `接受${selected.name}，场次已公布。`;
  } else if (decision === 'decline') {
    state.cancelled = true;
    text = '谢绝本轮提议，试演未排期。';
  } else if (decision === 'skip') {
    state.attendance[agentId] = { kind: 'absent' };
    text = '决定本场缺席。';
  } else if (decision === 'feedback') {
    const segment = THEATRE_CUES.find(({ id }) => id === cue)!;
    const watched = view.residents[agentId].watched.find(({ id }) => id === cue)!;
    text = `看了「${segment.name}」${watched.seconds} 秒。${response === 'keep' ? '希望保留这一段。' : segment.suggestion}`;
  } else {
    const path = theatrePath(context[agentId].position!, agentId);
    const journey = path && planJourney(path, agentId, state.booking!, requestId, at);
    if (!journey) return { error: '已无法在入口关闭前到达座位。', code: 422 };
    state.attendance[agentId] = { kind: 'attend', journey };
    text = '确认参加，沿步道前往社区剧场。';
  }
  state.commands.push({ requestId, choice });
  state.events.push({ id: requestId, at, agentId, type: decision, text, ...(cue && response ? { cue, response } : {}) });
  return { state, view: observeTheatre(state, context, at, rules), repeated: false };
}
