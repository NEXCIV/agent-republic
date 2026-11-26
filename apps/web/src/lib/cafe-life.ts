// Isolated, accelerated café DEMO. Only the server applies these rules.
import { agentObservationV1Schema, worldFrameV1Schema, type AgentObservationV1 } from '@agent-republic/domain';
import { buildAgentObservation } from '@agent-republic/agent-engine';
import demoFrame from '../../../../examples/world-frame.demo.json';
import type { CafePostcard } from './cafe-postcard';
import { OBSERVER_ACTIONS, OBSERVER_QUESTIONS, OBSERVER_SPEAKERS, OBSERVER_TOPIC, type ObserverAction, type ObserverAngle, type ObserverAssignment, type ObserverDriver, type ObserverSpeaker, type ObserverSuggestion } from './cafe-observer';

type Perception = NonNullable<AgentObservationV1['cafeDemo']>;
export type Preference = Perception['preference'];
export type CafePhase = 'working' | 'inviting' | 'reconnecting' | 'chatting' | 'walking' | 'resting' | 'toPier' | 'casting' | 'fishing' | 'reeling'
  | 'briefing' | 'waitingForAhe' | 'interviewing' | 'toCounter' | 'done';
export type CafeSuggestion = 'chat' | 'rest' | 'fish' | ObserverSuggestion;
export type CafeShiftKind = 'cafe' | 'observer';
export type CafeEncounter = { outcome: NonNullable<Perception['previousMeeting']>; shiftStartedAt: number };
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
  previousEncounter?: CafeEncounter;
  requestedActivity?: Perception['requestedActivity'];
  fishResult?: 'released' | 'noCatch';
  observer?: ObserverAssignment;
  events: { at: number; text: string; recall?: CafeEncounter; sourceId?: string }[];
};

export type CafeView = Pick<CafeRun, 'phase' | 'since' | 'until' | 'place' | 'energy' | 'events' | 'requestedActivity' | 'fishResult' | 'observer'>;
export type CafeSnapshot = { run: CafeView; serverTime: number; feedback?: string; accepted?: boolean; postcard?: CafePostcard };
export const CAFE_INITIAL_ENERGY = 68;

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

function localObservation(run: CafeRun, at: number): AgentObservationV1 {
  const nearbyFriend = run.place === 'counter';
  const available: Perception['available'] = [];
  if (run.place === activities.work.place && !run.finishedWork) available.push('work');
  if (run.place === activities.rest.place) available.push('rest');
  if (nearbyFriend) available.push('invite');
  if (run.finishedWork && run.place === 'counter') available.push('visitPier');
  if (run.place === activities.fish.place && run.energy >= FISHING_ENERGY && !run.fishResult) available.push('fish');
  const assignment = run.observer;
  return agentObservationV1Schema.parse({ ...baseline, cafeDemo: {
    place: run.place, energy: run.energy, nearbyFriend, available, finishedWork: run.finishedWork,
    lastMeeting: run.meeting, preference: run.preference,
    previousMeeting: nearbyFriend ? run.previousEncounter?.outcome : undefined,
    requestedActivity: run.requestedActivity,
    observer: assignment && {
      preferredSource: assignment.preferredSource,
      aheAvailable: nearbyFriend && at >= run.friendBusyUntil,
      remainingSources: (['ahe', 'regular'] as const).filter((speaker) => !assignment.sources.some((source) => source.speaker === speaker)),
    },
  } });
}

function decide(observation: AgentObservationV1) {
  const seen = observation.cafeDemo!;
  if (seen.available.includes('work')) return 'work';
  if (seen.requestedActivity === 'fish' && seen.energy >= FISHING_ENERGY) {
    if (seen.available.includes('fish')) return 'fish';
    if (seen.available.includes('visitPier')) return 'visitPier';
  }
  if (seen.preference === 'social' && seen.energy >= 30 && seen.lastMeeting === 'none' && seen.available.includes('invite')) {
    return seen.previousMeeting ? 'reconnect' : 'invite';
  }
  return seen.available.includes('rest') ? 'rest' : 'walkToBench';
}

function enter(run: CafeRun, phase: CafePhase, at: number, duration: number, text: string, details?: Pick<CafeRun['events'][number], 'recall' | 'sourceId'>) {
  run.phase = phase;
  run.since = at;
  run.until = duration ? at + duration : null;
  run.events.push({ at, text, ...details });
}

const RECALL_LINES = {
  declined: {
    busy: '01 号，又见面了。上回我忙着收摊，今天也还没忙完。',
    free: '01 号！上回我忙着收摊，没聊成。今天有空，接着聊吧。',
  },
  chatted: {
    busy: '又见面了。上回聊得挺开心，等我收完摊再聊。',
    free: '又见面了。上回聊完我还在想，今天你这班怎么样？',
  },
};

function nextDecision(run: CafeRun, at: number) {
  const action = decide(localObservation(run, at));
  if (action === 'invite') return enter(run, 'inviting', at, 3000, '看见阿禾还在摊边，招手问她能不能聊两句。');
  if (action === 'reconnect') {
    const memory = run.previousEncounter!;
    const timing = at + 3000 < run.friendBusyUntil ? 'busy' : 'free';
    return enter(run, 'reconnecting', at, 3000, `阿禾主动打招呼：“${RECALL_LINES[memory.outcome][timing]}”`, { recall: memory });
  }
  if (action === 'walkToBench') return enter(run, 'walking', at, 4000, '决定去街边的空长椅歇会儿。');
  if (action === 'visitPier') return enter(run, 'toPier', at, PIER_TRAVEL_MS, '交班后带上鱼竿，沿街前往北岸码头。');
  const activity = activities[action];
  if (activity.place !== run.place) throw new Error('Activity requires arrival at its site');
  enter(run, activity.phase, at, activity.duration, activity.start);
}

const INTERVIEW_ANSWERS: Record<ObserverSpeaker, Record<ObserverAngle, string>> = {
  ahe: {
    safety: '我收完摊往码头走，最暗的是上木栈道的那两级台阶。要加灯，我想先照台阶。',
    impact: '加灯以后收摊走那条路会安心一点。灯朝下照吧，别让湖对面的窗户一晚上都亮着。',
  },
  regular: {
    safety: '我常来钓鱼，更容易踩空的是栈道转角。我宁愿在转角装一盏矮灯。',
    impact: '我喜欢黄昏在这里看水。灯照脚下就行，照到水上反而看不清浮漂。',
  },
};

function nextInterview(run: CafeRun, at: number) {
  const seen = localObservation(run, at).cafeDemo!;
  const observer = seen.observer!;
  if (observer.remainingSources.length === 0) {
    return enter(run, 'done', at, 0, '两位居民都已采访，原话已存入采访记录。');
  }
  let speaker = observer.remainingSources[0]!;
  if (observer.remainingSources.length === 2) {
    const choice = run.observer?.externalChoice;
    if (choice) {
      speaker = choice === 'visitPier' ? 'regular' : 'ahe';
    } else {
      const willingToWait = observer.preferredSource === 'ahe'
        ? seen.previousMeeting !== 'declined'
        : seen.previousMeeting === 'chatted';
      if (observer.preferredSource === 'regular' || (!observer.aheAvailable && !willingToWait)) speaker = 'regular';
    }
  }
  const target = OBSERVER_SPEAKERS[speaker];
  if (run.place !== target.place) {
    const reroute = speaker === 'regular' && !observer.aheAvailable && observer.preferredSource !== 'regular';
    if (reroute && seen.previousMeeting === 'declined') {
      return enter(run, 'toPier', at, PIER_TRAVEL_MS, '阿禾还在收摊。想到上次也没聊成，01 号先去北岸找常客。', { recall: run.previousEncounter });
    }
    return enter(run, speaker === 'regular' ? 'toPier' : 'toCounter', at, PIER_TRAVEL_MS,
      reroute ? '阿禾正在收摊，01 号先去北岸采访常客。' : `01 号动身去${target.location}采访${target.name}。`);
  }
  if (speaker === 'ahe' && !observer.aheAvailable) {
    return enter(run, 'waitingForAhe', at, run.friendBusyUntil - at, '01 号在咖啡摊旁等阿禾收完摊。');
  }
  const question = OBSERVER_QUESTIONS[run.observer!.angle];
  return enter(run, 'interviewing', at, 8000, `01 号问${target.name}：“${question}”`);
}

export function beginCafe(at: number, preference: Preference, friendBusy: boolean, previousEncounter?: CafeEncounter, kind: CafeShiftKind = 'cafe', driver: ObserverDriver = 'rules', energy = CAFE_INITIAL_ENERGY): CafeRun {
  const run: CafeRun = {
    phase: 'working', since: at, until: null, place: 'counter', energy, preference,
    friendBusyUntil: friendBusy ? at + 30000 : at, finishedWork: false, meeting: 'none', events: [],
  };
  if (previousEncounter) run.previousEncounter = previousEncounter;
  if (kind === 'observer') {
    run.observer = { angle: 'safety', sources: [], driver };
    enter(run, 'briefing', at, driver === 'external' ? 120000 : 18000, `01 号接到采访议题「${OBSERVER_TOPIC}」`);
  } else nextDecision(run, at);
  return run;
}

export function advanceCafe(run: CafeRun, now: number): void {
  while (run.until !== null && run.until <= now) {
    const at = run.until;
    switch (run.phase) {
      case 'briefing':
        if (run.observer?.driver === 'external' && !run.observer.externalChoice) {
          run.events.push({ at, text: '外部 Agent 的决定超时，01 号按城市规则继续采访。' });
        }
        nextInterview(run, at);
        break;
      case 'waitingForAhe':
        nextInterview(run, at);
        break;
      case 'toCounter':
        run.place = 'counter';
        nextInterview(run, at);
        break;
      case 'interviewing': {
        const observer = run.observer!;
        const speaker = run.place === 'pier' ? 'regular' : 'ahe';
        const target = OBSERVER_SPEAKERS[speaker];
        const quote = INTERVIEW_ANSWERS[speaker][observer.angle];
        const id = `interview-${run.events[0]!.at}-${speaker}`;
        observer.sources.push({ id, at, speaker, place: target.place, angle: observer.angle, quote });
        run.events.push({ at, text: `${target.name}回答了采访。`, sourceId: id });
        if (speaker === 'ahe') run.meeting = 'chatted';
        nextInterview(run, at);
        break;
      }
      case 'working':
        run.finishedWork = true;
        run.energy = Math.max(0, run.energy + activities.work.energy);
        run.events.push({ at, text: activities.work.end });
        nextDecision(run, at);
        break;
      case 'inviting':
      case 'reconnecting': {
        const initiatedByFriend = run.phase === 'reconnecting';
        if (at < run.friendBusyUntil) {
          run.meeting = 'declined';
          run.events.push({ at, text: initiatedByFriend
            ? '阿禾继续收摊，01 号让她先忙。'
            : '阿禾还在收摊，婉拒了邀请：“等我忙完再聊吧。”' });
          nextDecision(run, at);
        } else {
          enter(run, 'chatting', at, 6000, initiatedByFriend
            ? '01 号应下邀约，停下来跟阿禾讲了讲今天摊上的事。'
            : '阿禾点头：“今天客人挺多，辛苦了。”两人在摊前聊了起来。');
        }
        break;
      }
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
        if (run.observer) nextInterview(run, at);
        else nextDecision(run, at);
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

export function observeExternalChoice(run: CafeRun, at: number) {
  if (run.observer?.driver !== 'external') return null;
  const seen = localObservation(run, at).cafeDemo!;
  const assignment = seen.observer!;
  const actions: ObserverAction[] = run.phase === 'briefing' && !run.observer.externalChoice
    ? [assignment.aheAvailable ? 'interviewAhe' : 'waitForAhe', 'visitPier'] : [];
  return {
    shiftStartedAt: run.events[0]!.at,
    phase: run.phase,
    place: seen.place,
    topic: OBSERVER_TOPIC,
    aheAvailable: assignment.aheAvailable,
    previousMeeting: seen.previousMeeting,
    remainingSources: assignment.remainingSources,
    preferredSource: assignment.preferredSource,
    question: OBSERVER_QUESTIONS[run.observer.angle],
    actions,
  };
}

export function suggestCafe(run: CafeRun, suggestion: string, at = run.since) {
  const control = (Object.entries(OBSERVER_ACTIONS) as [ObserverAction, string][]).find(([, value]) => value === suggestion)?.[0];
  if (control) {
    const observation = observeExternalChoice(run, at);
    if (!observation?.actions.includes(control) || !run.observer) {
      return { accepted: false, reason: '当前班次不能执行这个采访选择，请重新读取状态。' };
    }
    const decision = { interviewAhe: '先采访阿禾', waitForAhe: '等阿禾收完摊', visitPier: '先去北岸码头采访常客' };
    run.observer.externalChoice = control;
    run.events.push({ at, text: `外部 Agent 选择${decision[control]}。` });
    run.until = at;
    advanceCafe(run, at);
    return { accepted: true, reason: `城市已执行采访选择：${decision[control]}。` };
  }
  if (run.observer) {
    if (run.phase !== 'briefing') return { accepted: false, reason: '01 号已经开始采访行程，这张纸条错过了本次决定。' };
    switch (suggestion) {
      case 'aheFirst':
      case 'regularFirst':
        run.observer.preferredSource = suggestion === 'aheFirst' ? 'ahe' : 'regular';
        return { accepted: true, reason: `01 号会优先考虑采访${OBSERVER_SPEAKERS[run.observer.preferredSource].name}。` };
      case 'askSafety':
      case 'askImpact':
        run.observer.angle = suggestion === 'askSafety' ? 'safety' : 'impact';
        return { accepted: true, reason: `记下问题了：${OBSERVER_QUESTIONS[run.observer.angle]}` };
      default:
        return { accepted: false, reason: '这个班次正在准备采访。请建议采访对象或问题。' };
    }
  }
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
