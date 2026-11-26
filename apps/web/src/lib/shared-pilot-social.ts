import { randomUUID } from 'node:crypto';
import { SHARED_PILOT_LINES, type SharedPilotResidentId, type SharedPilotSocialRequest } from '@agent-republic/domain';
import { CAFE_BENCH_FRONT, CAFE_COUNTER, type CityPoint } from './cafe-geometry';

type Resident = SharedPilotResidentId;
type Line = typeof SHARED_PILOT_LINES[number];
type Phase = 'invited' | 'accepted' | 'talking' | 'completed' | 'declined' | 'expired';
export type SocialEventKind = 'INVITED' | 'ACCEPTED' | 'DECLINED' | 'MEETING_STARTED' | 'SAID' | 'COMPLETED' | 'EXPIRED';
export type SocialEvent = { id: string; meetingId: string; kind: SocialEventKind; residentId?: Resident; happenedAt: number; text: string; provenance: 'AI_SIMULATED' };
export type SocialLine = { residentId: Resident; line: Line; text: string; happenedAt: number };
export type SharedMeeting = {
  id: string; inviter: Resident; invitee: Resident; venue: 'cafe'; status: Phase;
  createdAt: number; deadlineAt: number; acceptedAt?: number; startedAt?: number; endedAt?: number;
  nextTurnAt: number; lines: SocialLine[];
};
export type SocialResident = { residentId: Resident; position: CityPoint; moving: boolean };
type Memory = { meetingId: string; other: Resident; happenedAt: number; text: string };
export type SocialReceipt = { requestId: string; meetingId: string; action: SharedPilotSocialRequest['action']; acceptedAt: number; mode: 'DEMO'; provenance: 'AI_SIMULATED' };
type RequestRecord = { fingerprint: string; receipt: SocialReceipt };
export type SocialState = {
  revision: number; meeting: SharedMeeting | null; events: SocialEvent[];
  memories: Record<Resident, Memory[]>; encounters: Record<Resident, number>;
  requests: Record<Resident, Record<string, RequestRecord>>;
};

export const SOCIAL_DWELL_MS = 4000;
export const SOCIAL_INVITE_MS = 30000;
export const SOCIAL_TRAVEL_MS = 120000;
export const SOCIAL_TALK_MS = 60000;
const MAX_SOCIAL_REQUESTS = 300;
const LINE_TEXT: Record<Line, string> = {
  greet: '你好！今天想和你聊聊城里的生活。',
  reply: '很高兴认识你。走过这些街道，感觉城市越来越熟悉了。',
  suggest: '下次我们一起去公共建设中心看看，好吗？',
  farewell: '好，我们下次再约。今天的见面我会记得。',
};

export function emptySocialState(): SocialState {
  return { revision: 0, meeting: null, events: [], memories: { '01': [], '02': [] }, encounters: { '01': 0, '02': 0 }, requests: { '01': {}, '02': {} } };
}

export function meetingPoint(id: Resident): CityPoint {
  // Both anchors lie on the existing surveyed counter-to-bench-front segment.
  const ratio = id === '01' ? .24 : .70;
  return CAFE_COUNTER.map((value, index) => value + (CAFE_BENCH_FRONT[index]! - value) * ratio) as CityPoint;
}

export function atMeetingPoint(resident: SocialResident) {
  const target = meetingPoint(resident.residentId);
  return !resident.moving && Math.hypot(...resident.position.map((value, index) => value - target[index]!)) < .08;
}

export function meetingActive(meeting: SharedMeeting | null): boolean {
  return meeting !== null && ['invited', 'accepted', 'talking'].includes(meeting.status);
}

export function nextSpeaker(meeting: SharedMeeting) {
  return meeting.lines.length % 2 === 0 ? meeting.inviter : meeting.invitee;
}

function emit(state: SocialState, at: number, kind: SocialEventKind, text: string, residentId?: Resident) {
  state.events.push({ id: `social-${++state.revision}`, meetingId: state.meeting!.id, kind, residentId, happenedAt: at, text, provenance: 'AI_SIMULATED' });
  state.events = state.events.slice(-60);
}

export class SocialActionError extends Error {
  constructor(readonly code: 'BUSY' | 'INVALID_REQUEST' | 'CONFLICT' | 'NOT_FOUND' | 'LIMIT_REACHED', message: string) { super(message); }
}

/** Advance only deterministic deadlines/arrivals; actual dialogue requires an agent action. */
export function advanceSocial(state: SocialState, at: number, residents: SocialResident[]): boolean {
  const meeting = state.meeting;
  if (!meeting || !meetingActive(meeting)) return false;
  if (meeting.status === 'talking' && meeting.lines.length === SHARED_PILOT_LINES.length && at >= meeting.nextTurnAt) {
    meeting.status = 'completed'; meeting.endedAt = meeting.nextTurnAt;
    const completeAt = meeting.endedAt;
    emit(state, completeAt, 'COMPLETED', '两位居民结束会面，各自留下了一条私人记忆。');
    for (const id of [meeting.inviter, meeting.invitee]) {
      const other = id === meeting.inviter ? meeting.invitee : meeting.inviter;
      state.encounters[id]++;
      state.memories[id].push({ meetingId: meeting.id, other, happenedAt: completeAt, text: `在咖啡街与 ${other} 号完成四轮交流，并约定下次去公共建设中心。` });
      state.memories[id] = state.memories[id].slice(-16);
    }
    return true;
  }
  if (at >= meeting.deadlineAt) {
    meeting.status = 'expired'; meeting.endedAt = meeting.deadlineAt;
    emit(state, meeting.endedAt, 'EXPIRED', '会面超时结束，没有增加关系记录。');
    return true;
  }
  if (meeting.status === 'accepted' && residents.length === 2 && residents.every(atMeetingPoint)) {
    meeting.status = 'talking'; meeting.startedAt = at; meeting.nextTurnAt = at + 1500; meeting.deadlineAt = at + SOCIAL_TALK_MS;
    emit(state, at, 'MEETING_STARTED', '两位居民已到达咖啡街的各自站位，开始交流。');
    return true;
  }
  return false;
}

export function performSocial(state: SocialState, actor: Resident, request: SharedPilotSocialRequest, at: number, residents: SocialResident[]): SocialReceipt {
  const fingerprint = JSON.stringify(request);
  const existing = state.requests[actor][request.requestId];
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new SocialActionError('CONFLICT', '该请求编号已用于不同动作。');
    return existing.receipt;
  }
  if (Object.keys(state.requests[actor]).length >= MAX_SOCIAL_REQUESTS) throw new SocialActionError('LIMIT_REACHED', '居民已达到本轮社交记录上限。');
  let meeting = state.meeting;
  if (request.action === 'invite') {
    if (request.target === actor) throw new SocialActionError('INVALID_REQUEST', '不能邀请自己。');
    if (meetingActive(meeting) || residents.find((item) => item.residentId === actor)?.moving) throw new SocialActionError('BUSY', '居民正忙，暂时不能发出邀请。');
    meeting = { id: randomUUID(), inviter: actor, invitee: request.target, venue: 'cafe', status: 'invited', createdAt: at,
      deadlineAt: at + SOCIAL_INVITE_MS, nextTurnAt: at, lines: [] };
    state.meeting = meeting;
    emit(state, at, 'INVITED', `${actor} 号邀请 ${request.target} 号到咖啡街见面。`, actor);
  } else {
    if (!meeting || meeting.id !== request.meetingId) throw new SocialActionError('NOT_FOUND', '找不到当前会面。');
    if (request.action === 'respond') {
      if (meeting.status !== 'invited' || actor !== meeting.invitee) throw new SocialActionError('INVALID_REQUEST', '只有受邀居民能回应待处理邀请。');
      meeting.status = request.decision === 'accept' ? 'accepted' : 'declined';
      if (meeting.status === 'accepted') { meeting.acceptedAt = at; meeting.deadlineAt = at + SOCIAL_TRAVEL_MS; }
      else meeting.endedAt = at;
      emit(state, at, request.decision === 'accept' ? 'ACCEPTED' : 'DECLINED', `${actor} 号${request.decision === 'accept' ? '接受了见面邀请。' : '婉拒了见面邀请。'}`, actor);
    } else {
      if (meeting.status !== 'talking' || meeting.lines.length >= SHARED_PILOT_LINES.length || actor !== nextSpeaker(meeting)
        || request.line !== SHARED_PILOT_LINES[meeting.lines.length] || at < meeting.nextTurnAt || !residents.every(atMeetingPoint)) {
        throw new SocialActionError('INVALID_REQUEST', '当前不是该居民可以发言的轮次。');
      }
      const text = LINE_TEXT[request.line];
      meeting.lines.push({ residentId: actor, line: request.line, text, happenedAt: at });
      meeting.nextTurnAt = at + SOCIAL_DWELL_MS;
      emit(state, at, 'SAID', text, actor);
    }
  }
  const receipt: SocialReceipt = { requestId: request.requestId, meetingId: meeting.id, action: request.action, acceptedAt: at, mode: 'DEMO', provenance: 'AI_SIMULATED' };
  state.requests[actor][request.requestId] = { fingerprint, receipt };
  return receipt;
}

export function publicSocial(state: SocialState, residents: SocialResident[]) {
  const meeting = state.meeting;
  return { revision: state.revision, meeting, events: state.events,
    arrived: meeting && (meeting.status === 'accepted' || meeting.status === 'talking') ? residents.filter(atMeetingPoint).map(({ residentId }) => residentId) : [],
    completedMeetings: Math.min(state.encounters['01'], state.encounters['02']),
  };
}
export type SharedSocialView = ReturnType<typeof publicSocial>;
