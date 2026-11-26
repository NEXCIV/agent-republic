// Isolated, accelerated café DEMO. Only the server applies these rules.
import { agentObservationV1Schema, worldFrameV1Schema, type AgentObservationV1 } from '@agent-republic/domain';
import { buildAgentObservation } from '@agent-republic/agent-engine';
import demoFrame from '../../../../examples/world-frame.demo.json';

type Perception = NonNullable<AgentObservationV1['cafeDemo']>;
export type Preference = Perception['preference'];
export type CafePhase = 'working' | 'inviting' | 'chatting' | 'walking' | 'resting' | 'toPier' | 'casting' | 'fishing' | 'reeling' | 'done';
export type CafeSuggestion = 'chat' | 'rest' | 'fish';
export type CafeRun = {
  phase: CafePhase;
  since: number;
  until: number | null;
  place: Perception['place'];
  energy: number;
  preference: Preference;
  friendBusyUntil: number;
  finishedWork: boolean;
  meeting: Perception['lastMeeting'];
  requestedActivity?: Perception['requestedActivity'];
  fishResult?: 'released' | 'noCatch';
  events: { at: number; text: string }[];
};

export type CafeView = Pick<CafeRun, 'phase' | 'since' | 'until' | 'place' | 'energy' | 'events' | 'requestedActivity' | 'fishResult'>;
export type CafeSnapshot = { run: CafeView; serverTime: number; feedback?: string; accepted?: boolean };

const frame = worldFrameV1Schema.parse(demoFrame);
const baseline = buildAgentObservation(frame, {
  owner: frame.society.agentSummaries[0]!.owner, blockNumber: frame.source.blockNumber,
  blockHash: frame.source.blockHash, hasAgentId: false, registered: false, build: '0', rep: '0',
}, { networkBlockNumber: frame.source.blockNumber });

const PIER_TRAVEL_MS = 64000;
const FISHING_ENERGY = 8;
const activities = {
  work: { place: 'counter', phase: 'working', duration: 16000, energy: -28, start: '在咖啡摊接班帮工。', end: '完成帮工，交还班位。' },
  rest: { place: 'bench', phase: 'resting', duration: 9000, energy: 35, start: '到达长椅，坐下休息。', end: '歇好了，起身让出座位。' },
  fish: { place: 'pier', phase: 'casting', duration: 1500, start: '走到北岸码头的钓位，向湖里抛竿。' },
} as const;

function localObservation(run: CafeRun): AgentObservationV1 {
  const nearbyFriend = run.place === 'counter';
  const available: Perception['available'] = [];
  if (run.place === activities.work.place && !run.finishedWork) available.push('work');
  if (run.place === activities.rest.place) available.push('rest');
  if (nearbyFriend) available.push('invite');
  if (run.finishedWork && run.place === 'counter') available.push('visitPier');
  if (run.place === activities.fish.place && run.energy >= FISHING_ENERGY && !run.fishResult) available.push('fish');
  return agentObservationV1Schema.parse({ ...baseline, cafeDemo: {
    place: run.place, energy: run.energy, nearbyFriend, available, finishedWork: run.finishedWork,
    lastMeeting: run.meeting, preference: run.preference,
    requestedActivity: run.requestedActivity,
  } });
}

function decide(observation: AgentObservationV1) {
  const seen = observation.cafeDemo!;
  if (seen.available.includes('work')) return 'work';
  if (seen.requestedActivity === 'fish' && seen.energy >= FISHING_ENERGY) {
    if (seen.available.includes('fish')) return 'fish';
    if (seen.available.includes('visitPier')) return 'visitPier';
  }
  if (seen.preference === 'social' && seen.energy >= 30 && seen.lastMeeting === 'none' && seen.available.includes('invite')) return 'invite';
  return seen.available.includes('rest') ? 'rest' : 'walkToBench';
}

function enter(run: CafeRun, phase: CafePhase, at: number, duration: number, text: string) {
  run.phase = phase;
  run.since = at;
  run.until = duration ? at + duration : null;
  run.events.push({ at, text });
}

function nextDecision(run: CafeRun, at: number) {
  const action = decide(localObservation(run));
  if (action === 'invite') return enter(run, 'inviting', at, 3000, '看见阿禾还在摊边，招手问她能不能聊两句。');
  if (action === 'walkToBench') return enter(run, 'walking', at, 4000, '决定去街边的空长椅歇会儿。');
  if (action === 'visitPier') return enter(run, 'toPier', at, PIER_TRAVEL_MS, '交班后带上鱼竿，沿街前往北岸码头。');
  const activity = activities[action];
  if (activity.place !== run.place) throw new Error('Activity requires arrival at its site');
  enter(run, activity.phase, at, activity.duration, activity.start);
}

export function beginCafe(at: number, preference: Preference, friendBusy: boolean): CafeRun {
  const run: CafeRun = {
    phase: 'working', since: at, until: null, place: 'counter', energy: 68, preference,
    friendBusyUntil: friendBusy ? at + 30000 : at, finishedWork: false, meeting: 'none', events: [],
  };
  nextDecision(run, at);
  return run;
}

export function advanceCafe(run: CafeRun, now: number): void {
  while (run.until !== null && run.until <= now) {
    const at = run.until;
    switch (run.phase) {
      case 'working':
        run.finishedWork = true;
        run.energy += activities.work.energy;
        run.events.push({ at, text: activities.work.end });
        nextDecision(run, at);
        break;
      case 'inviting':
        if (at < run.friendBusyUntil) {
          run.meeting = 'declined';
          run.events.push({ at, text: '阿禾还在收摊，婉拒了邀请：“等我忙完再聊吧。”' });
          nextDecision(run, at);
        } else {
          enter(run, 'chatting', at, 6000, '阿禾点头：“今天客人挺多，辛苦了。”两人在摊前聊了起来。');
        }
        break;
      case 'chatting':
        run.meeting = 'chatted';
        run.events.push({ at, text: '记住了这次收工后的交谈，向阿禾道别。' });
        nextDecision(run, at);
        break;
      case 'walking':
        run.place = 'bench';
        nextDecision(run, at);
        break;
      case 'resting':
        run.energy = Math.min(100, run.energy + activities.rest.energy);
        enter(run, 'done', at, 0, activities.rest.end);
        break;
      case 'toPier':
        run.place = 'pier';
        nextDecision(run, at);
        break;
      case 'casting':
        enter(run, 'fishing', at, 10000, '浮漂已经落水，等一等。');
        break;
      case 'fishing':
        enter(run, 'reeling', at, 1800, '准备收线，把鱼钩提上来。');
        break;
      case 'reeling': {
        // Derive the outcome from the persisted start time so retrying cannot reroll the catch.
        const roll = Math.imul(run.events[0]!.at, 0x9e3779b1) >>> 29;
        run.fishResult = roll < 5 ? 'released' : 'noCatch';
        run.energy -= FISHING_ENERGY;
        enter(run, 'done', at, 0, run.fishResult === 'released' ? '钓到一条小鱼，解钩后放回了湖里。' : '收回了鱼钩。这一竿没有钓到鱼。');
        break;
      }
      case 'done': return;
    }
  }
}

export function suggestCafe(run: CafeRun, suggestion: string) {
  if (suggestion !== 'chat' && suggestion !== 'rest' && suggestion !== 'fish') return { accepted: false, reason: '街区尚未开放这项活动。' };
  if (run.phase !== 'working') return { accepted: false, reason: '已经收工，这张纸条错过了本次决定。' };
  if (suggestion === 'fish') {
    run.requestedActivity = 'fish';
    return { accepted: true, reason: '收到了。等咖啡摊交班，就去北岸码头钓一竿。' };
  }
  delete run.requestedActivity;
  run.preference = suggestion === 'chat' ? 'social' : 'quiet';
  return { accepted: true, reason: suggestion === 'chat' ? '已收到建议，收工后会看看阿禾在不在。' : '已收到建议，收工后会优先找座位。' };
}
