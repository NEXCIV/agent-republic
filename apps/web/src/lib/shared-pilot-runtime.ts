import { randomUUID } from 'node:crypto';
import { SHARED_PILOT_RESIDENT_IDS, type SharedPilotPlaceId, type SharedPilotResidentId } from '@agent-republic/domain';
import { SharedPilotStore } from './shared-pilot-store';

type Observation = ReturnType<SharedPilotStore['observe']>;
type RuleConnection = { residentId: SharedPilotResidentId; token: string; decisions: number };
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

  constructor(file: string, clock: () => number = Date.now) {
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

  tick() {
    if (this.failure) return;
    for (const connection of this.connections) {
      if (connection.decisions >= MAX_DECISIONS) continue;
      const observation = this.store.observe(connection.token);
      const destination = this.choose(connection, observation);
      if (!destination) continue;
      this.store.moveTo(connection.token, { requestId: randomUUID(), action: 'moveTo', destination: { place: destination } });
      connection.decisions++;
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.connections.every(({ decisions }) => decisions >= MAX_DECISIONS)) {
        clearInterval(this.timer); this.timer = undefined; return;
      }
      try { this.tick(); } catch { this.failure = true; clearInterval(this.timer); this.timer = undefined; }
    }, 1000);
    this.timer.unref();
  }

  snapshot() {
    const { mode, provenance, serverTime, revision, residents, events } = this.store.observe(this.connections[0]!.token);
    return { mode, provenance, serverTime, revision, residents, events,
      engines: this.connections.map(({ residentId }) => ({ residentId, driver: 'RULES' as const })),
      running: !this.failure && this.connections.some(({ decisions }) => decisions < MAX_DECISIONS),
    };
  }

  close() { clearInterval(this.timer); this.timer = undefined; this.store.close(); }
}

export type SharedPilotView = ReturnType<SharedPilotRuntime['snapshot']>;
