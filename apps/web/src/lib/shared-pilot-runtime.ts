import { randomUUID } from 'node:crypto';
import { SHARED_PILOT_MAX_TURNS, SHARED_PILOT_RESIDENT_IDS, type SharedPilotMoveRequest, type SharedPilotPlaceId, type SharedPilotResidentId, type SharedPilotSocialRequest, type SharedPilotSurveyRequest } from '@agent-republic/domain';
import { SharedPilotError, SharedPilotStore } from './shared-pilot-store';
import { availableSurveyIntents, meetingActive, nextSpeaker, type SharedMeeting } from './shared-pilot-social';
import { SURVEY_CHECKPOINTS, SURVEY_OBSERVATION_MS, surveyActive } from './shared-pilot-survey';
import type { SharedPilotProfile } from './shared-pilot-profiles';
import { chooseModelAction, SharedPilotModelRun, type ModelConfig } from './shared-pilot-model';
import { CITY_PLACES } from './city-movement';
import type { CafeTalk, OrderCoffee } from './shared-pilot-cafe';
import { worksBriefActive, type CancelWorksGoal, type InspectWorks, type SurveyWorksSite, type WorksGoalAction, type WorksTalk } from './shared-pilot-works';
import type { FishingTalk, GoFishing } from './shared-pilot-fishing';
import type { ExplorationAction } from './shared-pilot-exploration';

type Observation = ReturnType<SharedPilotStore['observe']>;
type RuleConnection = { residentId: SharedPilotResidentId; token: string; decisions: number };
export type SharedAgentCommand = SharedPilotMoveRequest | SharedPilotSocialRequest | SharedPilotSurveyRequest
  | OrderCoffee | CafeTalk | InspectWorks | WorksTalk | WorksGoalAction | GoFishing | FishingTalk | ExplorationAction | { action: 'observe' };
const PREFERENCES: Record<SharedPilotResidentId, readonly SharedPilotPlaceId[]> = {
  '01': ['plaza', 'governance', 'cafe', 'works'],
  '02': ['cafe', 'works', 'plaza', 'governance'],
};
const MAX_DECISIONS = 16;
const DWELL_MS = 6500;

function ruleSpeech(meeting: SharedMeeting, observation: Observation, peerUsesRules: boolean): SharedPilotSocialRequest {
  const actor = observation.viewerResidentId;
  const peer = actor === meeting.inviter ? meeting.invitee : meeting.inviter;
  const name = observation.profiles.find(({ residentId }) => residentId === peer)?.name ?? `${peer} 号`;
  const previous = meeting.lines.at(-1);
  const intents = availableSurveyIntents(meeting, actor);
  const base = { action: 'say' as const, meetingId: meeting.id, requestId: randomUUID() };
  if (intents.includes('accept')) {
    return { ...base, text: '好，我也想看看建设中心入口和人行通道。我们喝完咖啡再过去吧。', surveyIntent: 'accept' };
  }
  if (peerUsesRules && meeting.lines.length === SHARED_PILOT_MAX_TURNS - 2 && intents.includes('propose')) {
    const text = observation.survey.report ? '上次我们看过入口了，想不想再去建设中心核对一下人行通道？'
      : '我想去公共建设中心看看入口和人行通道，你愿意一起去吗？';
    return { ...base, text, surveyIntent: 'propose' };
  }
  const familiar = observation.privateSocial.encounters > 0;
  const text = previous ? (meeting.lines.length === SHARED_PILOT_MAX_TURNS - 1
    ? '谢谢你聊起这个。我要继续逛逛了，下次在咖啡街见。'
    : `你刚才说「${Array.from(previous.text).slice(0, 24).join('')}」让我想到，接下来也可以去别处看看。你想去哪儿？`)
    : `${name}，${familiar ? '又见面了' : '很高兴在咖啡街认识你'}。我正想去${CITY_PLACES[PREFERENCES[actor][1]!]}看看，你呢？`;
  return { ...base, text };
}

/** Two separate rules clients, each authenticated for its own resident. No browser drives their movement. */
export class SharedPilotRuntime {
  private readonly store: SharedPilotStore;
  private readonly connections: RuleConnection[];
  private readonly notBefore: number;
  private timer?: ReturnType<typeof setInterval>;
  private failure = false;
  private readonly lastExternalCallAt = new Map<SharedPilotResidentId, number>();
  private readonly modelRuns = new Map<SharedPilotResidentId, SharedPilotModelRun>();

  constructor(file: string, clock: () => number = Date.now, private readonly socialEnabled = true,
    private readonly externalResidents: readonly SharedPilotResidentId[] = []) {
    this.store = new SharedPilotStore(file, clock);
    try {
      this.connections = SHARED_PILOT_RESIDENT_IDS.map((residentId) => ({
        residentId, token: this.store.issueCredential(residentId, 3600000).token, decisions: 0,
      }));
      this.notBefore = this.store.observe(this.connections[0]!.token).serverTime + 8000;
    } catch (error) {
      this.store.close();
      throw error;
    }
  }

  /** The HTTP adapter derives the resident from its server-side credential configuration. */
  actAsExternal(residentId: SharedPilotResidentId, command: SharedAgentCommand) {
    const connection = this.connections.find((candidate) => candidate.residentId === residentId);
    if (!connection || !this.externalResidents.includes(residentId)) throw new Error('External resident is unavailable');
    const observation = this.observeConnection(connection);
    return this.runExternal(residentId, connection.token, command, observation);
  }

  actWithProfileKey(key: string, profileResidents: readonly SharedPilotResidentId[], command: SharedAgentCommand) {
    const observation = this.store.observe(key);
    const residentId = observation.viewerResidentId;
    if (!profileResidents.includes(residentId)) throw new SharedPilotError('AUTH_REQUIRED', '共享 Agent 凭据无效。');
    return this.runExternal(residentId, key, command, observation);
  }

  profile(session: string) { return this.store.profile(session); }
  cafeTalk(question: string) { return this.store.cafeTalk(question); }
  worksTalk(question: string) { return this.store.worksTalk(question); }
  fishingTalk(question: string) { return this.store.fishingTalk(question); }
  orderCoffee(session: string, residents: readonly SharedPilotResidentId[], command: OrderCoffee) {
    return this.store.orderCoffee(session, command, residents);
  }
  requestInspection(session: string, residents: readonly SharedPilotResidentId[], command: InspectWorks) {
    return this.store.requestInspection(session, command, residents);
  }
  startWorksBrief(session: string, residents: readonly SharedPilotResidentId[], command: SurveyWorksSite) {
    return this.store.startWorksBrief(session, command, residents);
  }
  cancelWorksGoal(session: string, residents: readonly SharedPilotResidentId[], command: CancelWorksGoal) {
    return this.store.cancelWorksGoal(session, command, residents);
  }
  goFishing(session: string, residents: readonly SharedPilotResidentId[], command: GoFishing) {
    return this.store.goFishing(session, command, residents);
  }
  claimProfile(profile: Pick<SharedPilotProfile, 'name' | 'avatar'>, profileResidents: readonly SharedPilotResidentId[], session: string) {
    const claimed = this.store.claim(profile, profileResidents, session);
    this.start();
    return claimed;
  }
  setProfileKey(session: string, issue: boolean, profileResidents: readonly SharedPilotResidentId[]) {
    const result = this.store.setProfileKey(session, issue, profileResidents);
    this.modelRuns.get(result.residentId)?.stop();
    this.modelRuns.delete(result.residentId);
    this.lastExternalCallAt.delete(result.residentId);
    return { key: result.key, expiresAt: result.expiresAt, hasKey: result.hasKey };
  }

  private authorizedProfile(session: string, profileResidents: readonly SharedPilotResidentId[]) {
    const profile = this.store.profile(session).profile;
    if (!profile || !profileResidents.includes(profile.residentId)) throw new SharedPilotError('AUTH_REQUIRED', '请在创建角色的浏览器重新打开入城页。');
    return profile;
  }

  modelProfile(residentId: SharedPilotResidentId) {
    return {
      modelRun: this.modelRuns.get(residentId)?.view ?? null,
      mcpConnected: Date.now() - (this.lastExternalCallAt.get(residentId) ?? 0) <= 120000 && !this.modelRuns.has(residentId),
    };
  }

  startModel(session: string, profileResidents: readonly SharedPilotResidentId[], config: ModelConfig) {
    const { residentId } = this.authorizedProfile(session, profileResidents);
    if (this.modelRuns.get(residentId)?.active) throw new SharedPilotError('CONFLICT', 'Agent 已启动，请先暂停当前运行。');
    const connection = this.connections.find((candidate) => candidate.residentId === residentId)!;
    this.setProfileKey(session, false, profileResidents);
    const observe = () => {
      this.authorizedProfile(session, profileResidents);
      return this.observeConnection(connection);
    };
    const run = new SharedPilotModelRun(config, observe, (command) => {
      const observation = observe();
      return this.runExternal(residentId, connection.token, command, observation);
    }, chooseModelAction);
    this.modelRuns.set(residentId, run);
    run.start();
    this.start();
    return this.modelProfile(residentId);
  }

  stopModel(session: string, profileResidents: readonly SharedPilotResidentId[]) {
    const { residentId } = this.authorizedProfile(session, profileResidents);
    this.modelRuns.get(residentId)?.stop();
    return this.modelProfile(residentId);
  }

  private observeConnection(connection: RuleConnection) {
    try {
      return this.store.observe(connection.token);
    } catch (error) {
      if (!(error instanceof SharedPilotError) || error.code !== 'AUTH_REQUIRED') throw error;
      connection.token = this.store.issueCredential(connection.residentId).token;
      return this.store.observe(connection.token);
    }
  }

  private runExternal(residentId: SharedPilotResidentId, token: string, command: SharedAgentCommand, observation: Observation) {
    this.lastExternalCallAt.set(residentId, observation.serverTime);
    switch (command.action) {
      case 'observe':
        return observation;
      case 'moveTo':
        return this.store.moveTo(token, command);
      case 'orderCoffee':
        return this.store.orderCoffee(token, command);
      case 'cafeTalk':
        return this.store.cafeTalk(command.question, token);
      case 'inspectWorks':
        return this.store.requestInspection(token, command);
      case 'worksTalk':
        return this.store.worksTalk(command.question, token);
      case 'exploreSite':
      case 'exploreArrival':
        return this.store.explore(token, command);
      case 'acceptWorksGoal':
      case 'askWorksGoal':
      case 'inspectWorksGoal':
        return this.store.actOnWorksGoal(token, command);
      case 'goFishing':
        return this.store.goFishing(token, command);
      case 'fishingTalk':
        return this.store.fishingTalk(command.question, token);
      case 'invite':
      case 'respond':
      case 'say':
        return this.store.socialAction(token, command);
      default:
        return this.store.surveyAction(token, command);
    }
  }

  private surveyTick(connection: RuleConnection, observation: Observation): boolean {
    if (!this.socialEnabled) return false;
    const { task, arrived, eligibleMeetingId } = observation.survey;
    const at = observation.serverTime;
    const actor = connection.residentId;
    const own = observation.residents.find(({ residentId }) => residentId === actor)!;
    if (task && surveyActive(task)) {
      if (task.status === 'proposed' && actor === task.invitee && at >= task.createdAt + 2000) {
        const busy = own.movement?.status === 'walking' && own.movement.arrivesAt - at > 20000;
        this.store.surveyAction(connection.token, { requestId: randomUUID(), action: 'respondSurvey', taskId: task.id, decision: busy ? 'decline' : 'accept' });
      } else if (task.status === 'accepted' && !arrived.includes(actor) && own.movement?.status !== 'walking'
        && at >= (task.acceptedAt ?? at) + (actor === '02' ? 1500 : 0)) {
        this.store.moveTo(connection.token, { requestId: randomUUID(), action: 'moveTo', destination: { place: 'works' } });
        connection.decisions++;
      } else if (task.status === 'surveying') {
        const inspection = task.inspections[actor];
        if (inspection.startedAt === undefined) {
          this.store.surveyAction(connection.token, { requestId: randomUUID(), action: 'inspectSurvey', taskId: task.id, checkId: SURVEY_CHECKPOINTS[actor].checkId });
        } else if (!inspection.finding && at >= inspection.startedAt + SURVEY_OBSERVATION_MS + (actor === '02' ? 2000 : 0)) {
          this.store.surveyAction(connection.token, { requestId: randomUUID(), action: 'submitSurvey', taskId: task.id });
        }
      }
      return true;
    }
    if (eligibleMeetingId && this.connections.every(({ decisions }) => decisions < MAX_DECISIONS)) {
      const ready = at >= this.notBefore && at >= (observation.social.meeting?.endedAt ?? at) + 3000;
      if (actor === '01' && ready && observation.residents.every(({ movement }) => movement?.status !== 'walking')) {
        this.store.surveyAction(connection.token, { requestId: randomUUID(), action: 'proposeSurvey', meetingId: eligibleMeetingId });
      }
      return true;
    }
    return !!task?.endedAt && at < task.endedAt + 12000;
  }

  private socialTick(connection: RuleConnection, observation: Observation, peerUsesRules: boolean): boolean {
    if (!this.socialEnabled) return false;
    const { meeting, arrived } = observation.social;
    const at = observation.serverTime;
    const own = observation.residents.find(({ residentId }) => residentId === connection.residentId)!;
    const actor = connection.residentId;
    if (meetingActive(meeting) && meeting) {
      if (meeting.status === 'invited' && actor === meeting.invitee) {
        // Familiar residents respond a little faster. Long ongoing journeys can cause refusal.
        const delay = observation.privateSocial.encounters > 0 ? 1200 : 2500;
        if (at >= meeting.createdAt + delay) {
          const busy = own.movement?.status === 'walking' && own.movement.arrivesAt - at > 20000;
          this.store.socialAction(connection.token, { requestId: randomUUID(), action: 'respond', meetingId: meeting.id, decision: busy ? 'decline' : 'accept' });
        }
      } else if (meeting.status === 'accepted' && !arrived.includes(actor) && own.movement?.status !== 'walking') {
        this.store.moveTo(connection.token, { requestId: randomUUID(), action: 'moveTo', destination: { place: 'cafe' } });
        connection.decisions++;
      } else if (meeting.status === 'talking' && meeting.lines.length < SHARED_PILOT_MAX_TURNS && nextSpeaker(meeting) === actor && at >= meeting.nextTurnAt) {
        this.store.socialAction(connection.token, ruleSpeech(meeting, observation, peerUsesRules), 'rules');
      }
      return true;
    }
    if (at < this.notBefore) return true;
    if (meeting?.endedAt && at < meeting.endedAt + 12000) return true;
    const due = !meeting || at >= (meeting.endedAt ?? at) + 45000;
    if (due && this.connections.every(({ decisions }) => decisions < MAX_DECISIONS)) {
      // Leave the next free moment for the invitation instead of repeatedly departing.
      if (actor === '01' && observation.residents.every(({ movement }) => movement?.status !== 'walking')) {
        this.store.socialAction(connection.token, { requestId: randomUUID(), action: 'invite', target: '02', venue: 'cafe' });
      }
      return true;
    }
    return false;
  }

  private choose(connection: RuleConnection, observation: Observation): SharedPilotPlaceId | null {
    const own = observation.residents.find(({ residentId }) => residentId === connection.residentId)!;
    if (own.movement?.status === 'walking' || observation.serverTime < this.notBefore
      || (own.movement && observation.serverTime < own.movement.arrivesAt + DWELL_MS)) return null;
    const preferences = PREFERENCES[connection.residentId];
    const peer = observation.residents.find(({ residentId }) => residentId !== connection.residentId);
    const peerDestination = peer?.movement?.status === 'walking' ? peer.movement.destination.place : peer?.place;
    const index = preferences.indexOf(own.place);
    // Prefer a different destination to the other resident, then follow our own interests.
    const choices = preferences.map((_, offset) => preferences[(index + offset + 1) % preferences.length]!)
      .filter((place) => place !== own.place);
    return choices.find((place) => place !== peerDestination) ?? choices[0] ?? null;
  }

  private externallyControlled(profiles: SharedPilotProfile[]) {
    return new Set([...this.externalResidents, ...profiles.map(({ residentId }) => residentId)]);
  }

  tick() {
    if (this.failure) return;
    const firstObservation = this.observeConnection(this.connections[0]!);
    const external = this.externallyControlled(firstObservation.profiles);
    if (external.size === this.connections.length) {
      // With both residents externally controlled, keep settling accepted actions and deadlines.
      return;
    }
    for (const connection of this.connections) {
      if (external.has(connection.residentId)) continue;
      const observation = connection === this.connections[0] ? firstObservation : this.observeConnection(connection);
      if (observation.cafe.orders.some(order => order.stage !== 'completed')) continue;
      if (observation.works.visits.some(visit => visit.stage !== 'completed')) continue;
      if (observation.works.briefs.some(brief => brief.stage !== 'waiting' && worksBriefActive(brief))) continue;
      if (observation.fishing.visits.some(visit => visit.stage !== 'completed')) continue;
      if (this.surveyTick(connection, observation)) continue;
      if (this.socialTick(connection, observation, external.size === 0)) continue;
      if (connection.decisions >= MAX_DECISIONS) continue;
      const destination = this.choose(connection, observation);
      if (!destination) continue;
      this.store.moveTo(connection.token, { requestId: randomUUID(), action: 'moveTo', destination: { place: destination } });
      connection.decisions++;
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
        if (!this.externalResidents.length && this.connections.every(({ decisions }) => decisions >= MAX_DECISIONS)) {
          const { social, survey, profiles } = this.snapshot();
          if (profiles.length) return;
          if (meetingActive(social.meeting) || surveyActive(survey.task)) return;
          clearInterval(this.timer); this.timer = undefined;
        }
      } catch { this.failure = true; clearInterval(this.timer); this.timer = undefined; }
    }, 1000);
    this.timer.unref();
  }

  snapshot() {
    const { mode, provenance, serverTime, revision, residents, events, social, survey, profiles, cafe, works, fishing, exploration } = this.observeConnection(this.connections[0]!);
    const external = this.externallyControlled(profiles);
    return { mode, provenance, serverTime, revision, residents, events, social, survey, profiles, cafe, works, fishing, exploration,
      engines: this.connections.map(({ residentId }) => {
        const run = this.modelRuns.get(residentId);
        if (run) return { residentId, driver: 'MODEL' as const, status: run.view.status };
        if (!external.has(residentId)) return { residentId, driver: 'RULES' as const };
        const lastCall = this.lastExternalCallAt.get(residentId);
        return { residentId, driver: 'EXTERNAL' as const, connected: lastCall !== undefined && serverTime - lastCall <= 120000 };
      }),
      running: !this.failure && (this.connections.some(({ decisions }) => decisions < MAX_DECISIONS) || meetingActive(social.meeting)
        || surveyActive(survey.task) || works.briefs.some(worksBriefActive) || fishing.visits.some(visit => visit.stage !== 'completed')),
    };
  }

  close() {
    clearInterval(this.timer); this.timer = undefined;
    for (const run of this.modelRuns.values()) run.stop();
    this.modelRuns.clear();
    this.store.close();
  }
}

export type SharedPilotView = ReturnType<SharedPilotRuntime['snapshot']>;
