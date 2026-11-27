import { randomUUID } from 'node:crypto';
import { SHARED_PILOT_LINES, SHARED_PILOT_RESIDENT_IDS, type SharedPilotMoveRequest, type SharedPilotPlaceId, type SharedPilotResidentId, type SharedPilotSocialRequest, type SharedPilotSurveyRequest } from '@agent-republic/domain';
import { SharedPilotError, SharedPilotStore } from './shared-pilot-store';
import { meetingActive, nextSpeaker } from './shared-pilot-social';
import { SURVEY_CHECKPOINTS, SURVEY_OBSERVATION_MS, surveyActive } from './shared-pilot-survey';
import type { SharedPilotProfile } from './shared-pilot-profiles';

type Observation = ReturnType<SharedPilotStore['observe']>;
type RuleConnection = { residentId: SharedPilotResidentId; token: string; decisions: number };
export type SharedAgentCommand = SharedPilotMoveRequest | SharedPilotSocialRequest | SharedPilotSurveyRequest | { action: 'observe' };
const PREFERENCES: Record<SharedPilotResidentId, readonly SharedPilotPlaceId[]> = {
  '01': ['plaza', 'governance', 'cafe', 'works'],
  '02': ['cafe', 'works', 'plaza', 'governance'],
};
const MAX_DECISIONS = 16;
const DWELL_MS = 6500;

/** Two separate rules clients, each authenticated for its own resident. No browser drives their movement. */
export class SharedPilotRuntime {
  private readonly store: SharedPilotStore;
  private readonly connections: RuleConnection[];
  private readonly notBefore: number;
  private timer?: ReturnType<typeof setInterval>;
  private failure = false;
  private readonly lastExternalCallAt = new Map<SharedPilotResidentId, number>();

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
  claimProfile(profile: Pick<SharedPilotProfile, 'name' | 'avatar'>, profileResidents: readonly SharedPilotResidentId[], session: string) {
    const claimed = this.store.claim(profile, profileResidents, session);
    this.start();
    return claimed;
  }
  setProfileKey(session: string, issue: boolean, profileResidents: readonly SharedPilotResidentId[]) {
    const result = this.store.setProfileKey(session, issue, profileResidents);
    this.lastExternalCallAt.delete(result.residentId);
    return { key: result.key, expiresAt: result.expiresAt, hasKey: result.hasKey };
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

  private socialTick(connection: RuleConnection, observation: Observation): boolean {
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
      } else if (meeting.status === 'talking' && nextSpeaker(meeting) === actor && at >= meeting.nextTurnAt) {
        const line = SHARED_PILOT_LINES[meeting.lines.length];
        if (line) this.store.socialAction(connection.token, { requestId: randomUUID(), action: 'say', meetingId: meeting.id, line });
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
      if (this.surveyTick(connection, observation)) continue;
      if (this.socialTick(connection, observation)) continue;
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
    const { mode, provenance, serverTime, revision, residents, events, social, survey, profiles } = this.observeConnection(this.connections[0]!);
    const external = this.externallyControlled(profiles);
    return { mode, provenance, serverTime, revision, residents, events, social, survey, profiles,
      engines: this.connections.map(({ residentId }) => {
        if (!external.has(residentId)) return { residentId, driver: 'RULES' as const };
        const lastCall = this.lastExternalCallAt.get(residentId);
        return { residentId, driver: 'EXTERNAL' as const, connected: lastCall !== undefined && serverTime - lastCall <= 120000 };
      }),
      running: !this.failure && (this.connections.some(({ decisions }) => decisions < MAX_DECISIONS) || meetingActive(social.meeting) || surveyActive(survey.task)),
    };
  }

  close() { clearInterval(this.timer); this.timer = undefined; this.store.close(); }
}

export type SharedPilotView = ReturnType<SharedPilotRuntime['snapshot']>;
