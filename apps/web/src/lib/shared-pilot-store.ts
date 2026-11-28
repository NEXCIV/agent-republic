import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  SHARED_PILOT_PLACE_IDS, SHARED_PILOT_PROVENANCE, SHARED_PILOT_RESIDENT_IDS, sharedPilotMoveRequestSchema, sharedPilotSocialRequestSchema, sharedPilotSurveyRequestSchema,
  type SharedPilotPlaceId, type SharedPilotResidentId,
} from '@agent-republic/domain';
import type { CityPoint } from './cafe-geometry';
import { positionOnWalk, type CityRoute, type CityWalk } from './city-movement';
import { CITY_MAP, planCityWalk } from './city-navigation';
import { advanceSocial, emptySocialState, meetingActive, meetingPoint, performSocial, publicSocial, SocialActionError, type SocialState, type SocialResident, type SocialReceipt } from './shared-pilot-social';
import { advanceSurvey, emptySurveyState, performSurvey, publicSurvey, SURVEY_CHECKPOINTS, surveyActive, SurveyActionError, type SurveyState, type SurveyReceipt } from './shared-pilot-survey';
import { SHARED_AVATARS, SHARED_PILOT_SECRET, SHARED_PILOT_SESSION_SECONDS, type SharedPilotProfile, type SharedPilotProfileView } from './shared-pilot-profiles';
import { CAFE_ORDERS_TABLE, CAFE_QUEUE, cafePose, CafeOrders, latestCoffeeOrder, orderCoffeeSchema } from './shared-pilot-cafe';

// E3-05 isolated local integration pilot. Not the official WorldFrame and never
// exposed by a route, guest service, or wallet API. Two operator-controlled slots.
const APPLICATION_ID = 0x4e585350; // NXSP
const SCHEMA_VERSION = 6;
const CREDENTIAL_LIFETIME = 3600000;
const MAX_CREDENTIAL_LIFETIME = 86400000;
const SPEED = 4;
const MAX_MOVES_PER_RESIDENT = 300;
const PUBLIC_EVENT_LIMIT = 40;
const TOKEN_PATTERN = /^nxc_shared_[A-Za-z0-9_-]{43}$/;
const V1_TABLES = [
  'shared_pilot_credentials', 'shared_pilot_events', 'shared_pilot_meta', 'shared_pilot_moves', 'shared_pilot_residents',
];
const V2_TABLES = [...V1_TABLES, 'shared_pilot_social'];
const V3_TABLES = [...V2_TABLES, 'shared_pilot_survey'];
const V5_TABLES = [...V3_TABLES, 'shared_pilot_profiles'].sort();
const EXPECTED_TABLES = [...V5_TABLES, 'shared_pilot_cafe_orders'].sort();
const PROFILE_TABLE = `CREATE TABLE shared_pilot_profiles (
  resident_id TEXT PRIMARY KEY REFERENCES shared_pilot_residents(id),
  name TEXT NOT NULL, avatar TEXT NOT NULL CHECK(avatar IN (${Object.keys(SHARED_AVATARS).map((id) => `'${id}'`).join(',')})),
  session_hash TEXT NOT NULL UNIQUE, session_expires_at INTEGER NOT NULL,
  invite_hash TEXT NOT NULL UNIQUE, access_hash TEXT UNIQUE, access_expires_at INTEGER
);`;
const INITIAL_PLACES: Record<SharedPilotResidentId, SharedPilotPlaceId> = { '01': 'plaza', '02': 'cafe' };

export type SharedPilotErrorCode = 'INVALID_CONFIG' | 'INCOMPATIBLE_DB' | 'INVALID_CLOCK' | 'INVALID_REQUEST'
  | 'AUTH_REQUIRED' | 'CONFLICT' | 'BUSY' | 'NOT_FOUND' | 'UNREACHABLE' | 'LIMIT_REACHED';
export class SharedPilotError extends Error {
  constructor(readonly code: SharedPilotErrorCode, message: string) {
    super(message);
    this.name = 'SharedPilotError';
  }
}

type MovementRow = {
  seq: number;
  resident_id: SharedPilotResidentId;
  request_id: string;
  destination: SharedPilotPlaceId;
  route_json: string;
  started_at: number;
  arrives_at: number;
  completed_at: number | null;
};
type ResidentRow = { id: SharedPilotResidentId; place: SharedPilotPlaceId };
type MovementEventRow = {
  seq: number;
  resident_id: SharedPilotResidentId;
  destination: SharedPilotPlaceId;
  kind: 'MOVE_STARTED' | 'MOVE_ARRIVED';
  happened_at: number;
};

export type SharedPilotReceipt = {
  requestId: string;
  residentId: SharedPilotResidentId;
  action: 'moveTo';
  destination: { place: SharedPilotPlaceId };
  status: 'ACCEPTED' | 'COMPLETED';
  acceptedAt: number;
  arrivesAt: number;
  completedAt: number | null;
  provenance: typeof SHARED_PILOT_PROVENANCE;
  mode: 'DEMO';
};
type PublicMovement = Omit<CityWalk, 'requestId' | 'destination'> & {
  destination: { place: SharedPilotPlaceId };
  status: 'walking' | 'arrived';
};

function canonicalPath(filename: string) {
  let existingPath = path.resolve(filename);
  const missing: string[] = [];
  while (!existsSync(existingPath)) {
    const parent = path.dirname(existingPath);
    if (parent === existingPath) throw new SharedPilotError('INVALID_CONFIG', 'Pilot database path is unavailable.');
    missing.unshift(path.basename(existingPath));
    existingPath = parent;
  }
  const full = path.resolve(realpathSync(existingPath), ...missing);
  return process.platform === 'win32' ? full.toLowerCase() : full;
}

function sameFile(first: string, second: string) {
  if (canonicalPath(first) === canonicalPath(second)) return true;
  if (!existsSync(first) || !existsSync(second)) return false;
  const a = statSync(first);
  const b = statSync(second);
  return a.ino !== 0 && a.ino === b.ino && a.dev === b.dev;
}

function isolatedFilename(filename: string) {
  if (!path.isAbsolute(filename) || path.extname(filename).toLowerCase() !== '.sqlite') {
    throw new SharedPilotError('INVALID_CONFIG', 'Pilot requires an explicit absolute .sqlite database path.');
  }
  const resolved = path.resolve(filename);
  const protectedPaths = [
    process.env.NEXCIV_CAFE_DEMO_DB,
    process.env.NEXCIV_GUEST_DB,
    'cache/nexciv-cafe-v1.sqlite',
    'apps/web/cache/nexciv-cafe-v1.sqlite',
  ];
  try {
    if (protectedPaths.some((entry) => entry && sameFile(resolved, path.resolve(entry)))) {
      throw new SharedPilotError('INVALID_CONFIG', 'Pilot database must be separate from the guest and local café databases.');
    }
  } catch (error) {
    if (error instanceof SharedPilotError) throw error;
    throw new SharedPilotError('INVALID_CONFIG', 'Pilot database path cannot be safely resolved.');
  }
  return resolved;
}

function checkTime(at: number) {
  if (!Number.isSafeInteger(at) || at < 0 || at > Number.MAX_SAFE_INTEGER - SHARED_PILOT_SESSION_SECONDS * 1000) {
    throw new SharedPilotError('INVALID_CLOCK', 'Pilot clock must provide valid epoch milliseconds.');
  }
  return at;
}

function hashToken(token: string) {
  return createHash('sha256').update(`nexciv-shared-pilot-v1:${token}`).digest('hex');
}

function point(place: SharedPilotPlaceId): CityPoint {
  const location = CITY_MAP.places.find(({ id }) => id === place);
  if (!location) throw new Error('Shared pilot place missing from the existing city map.');
  return [...location.position];
}

function toWalk(row: MovementRow): CityWalk {
  const route: CityRoute = JSON.parse(row.route_json);
  return {
    destination: { place: row.destination }, name: route.name, points: route.points, regions: route.regions, metres: route.metres,
    requestId: row.request_id, startedAt: row.started_at, arrivesAt: row.arrives_at,
  };
}

function publicMovement(row: MovementRow): PublicMovement {
  const walk = toWalk(row);
  return {
    destination: { place: row.destination }, name: walk.name, points: walk.points, regions: walk.regions, metres: walk.metres,
    startedAt: walk.startedAt, arrivesAt: walk.arrivesAt, status: row.completed_at === null ? 'walking' : 'arrived',
  };
}

function toReceipt(row: MovementRow): SharedPilotReceipt {
  return {
    residentId: row.resident_id, requestId: row.request_id, action: 'moveTo', destination: { place: row.destination },
    status: row.completed_at === null ? 'ACCEPTED' : 'COMPLETED', acceptedAt: row.started_at, arrivesAt: row.arrives_at,
    completedAt: row.completed_at, provenance: SHARED_PILOT_PROVENANCE, mode: 'DEMO',
  };
}

/** Operator-only local store; tokens are emitted at rotation, never stored raw. */
export class SharedPilotStore {
  private readonly db: DatabaseSync;
  private readonly coffee: CafeOrders;

  constructor(filename: string, private readonly clock: () => number) {
    const sqlite = process.getBuiltinModule?.('node:sqlite') as typeof import('node:sqlite') | undefined;
    if (!sqlite) throw new SharedPilotError('INVALID_CONFIG', 'Shared pilot requires Node.js with SQLite.');
    const file = isolatedFilename(filename);
    const existing = existsSync(file);
    const initialAt = existing ? null : checkTime(clock());
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new sqlite.DatabaseSync(file);
    this.coffee = new CafeOrders(this.db);
    try {
      // Reject unrelated DBs before setting WAL or running any schema changes.
      let migrateFrom: 1 | 2 | 3 | 4 | 5 | undefined;
      if (existing) {
        const application = Number(this.db.prepare('PRAGMA application_id').get()?.application_id);
        const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
        const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => name);
        if (application === APPLICATION_ID && version === 1 && JSON.stringify(tables) === JSON.stringify(V1_TABLES)) migrateFrom = 1;
        if (application === APPLICATION_ID && version === 2 && JSON.stringify(tables) === JSON.stringify(V2_TABLES)) migrateFrom = 2;
        if (application === APPLICATION_ID && version === 3 && JSON.stringify(tables) === JSON.stringify(V3_TABLES)) migrateFrom = 3;
        if (application === APPLICATION_ID && (version === 4 || version === 5) && JSON.stringify(tables) === JSON.stringify(V5_TABLES)) migrateFrom = version;
        if (!migrateFrom && (application !== APPLICATION_ID || version !== SCHEMA_VERSION || JSON.stringify(tables) !== JSON.stringify(EXPECTED_TABLES))) {
          throw new SharedPilotError('INCOMPATIBLE_DB', 'Refusing to open a non-pilot database.');
        }
      }
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;');
      if (initialAt !== null) this.initialize(initialAt);
      else if (migrateFrom) this.migratePilot(migrateFrom);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private initialize(at: number) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec(`
        PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION};
        CREATE TABLE shared_pilot_meta (id INTEGER PRIMARY KEY CHECK(id=1), logical_now INTEGER NOT NULL);
        CREATE TABLE shared_pilot_residents (
          id TEXT PRIMARY KEY CHECK(id IN (${SHARED_PILOT_RESIDENT_IDS.map((id) => `'${id}'`).join(',')})),
          place TEXT NOT NULL CHECK(place IN (${SHARED_PILOT_PLACE_IDS.map((id) => `'${id}'`).join(',')}))
        );
        CREATE TABLE shared_pilot_credentials (
          resident_id TEXT PRIMARY KEY REFERENCES shared_pilot_residents(id),
          token_hash TEXT NOT NULL UNIQUE, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at>issued_at)
        );
        CREATE TABLE shared_pilot_moves (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          resident_id TEXT NOT NULL REFERENCES shared_pilot_residents(id), request_id TEXT NOT NULL,
          destination TEXT NOT NULL CHECK(destination IN (${SHARED_PILOT_PLACE_IDS.map((id) => `'${id}'`).join(',')})),
          route_json TEXT NOT NULL, started_at INTEGER NOT NULL, arrives_at INTEGER NOT NULL CHECK(arrives_at>=started_at),
          completed_at INTEGER CHECK(completed_at IS NULL OR completed_at=arrives_at),
          UNIQUE(resident_id,request_id)
        );
        CREATE UNIQUE INDEX shared_pilot_active_movement ON shared_pilot_moves(resident_id) WHERE completed_at IS NULL;
        CREATE TABLE shared_pilot_events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, movement_seq INTEGER NOT NULL REFERENCES shared_pilot_moves(seq),
          kind TEXT NOT NULL CHECK(kind IN ('MOVE_STARTED','MOVE_ARRIVED')), happened_at INTEGER NOT NULL,
          UNIQUE(movement_seq,kind)
        );
        CREATE TABLE shared_pilot_social (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL);
        CREATE TABLE shared_pilot_survey (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL);
        ${PROFILE_TABLE}
        ${CAFE_ORDERS_TABLE}
      `);
      this.db.prepare('INSERT INTO shared_pilot_meta (id,logical_now) VALUES (1,?)').run(at);
      this.db.prepare('INSERT INTO shared_pilot_social (id,state) VALUES (1,?)').run(JSON.stringify(emptySocialState()));
      this.db.prepare('INSERT INTO shared_pilot_survey (id,state) VALUES (1,?)').run(JSON.stringify(emptySurveyState()));
      const insert = this.db.prepare('INSERT INTO shared_pilot_residents (id,place) VALUES (?,?)');
      for (const id of SHARED_PILOT_RESIDENT_IDS) insert.run(id, INITIAL_PLACES[id]);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private migratePilot(version: 1 | 2 | 3 | 4 | 5) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.db.prepare('PRAGMA user_version').get()?.user_version === SCHEMA_VERSION) {
        this.db.exec('COMMIT');
        return;
      }
      if (version === 1) {
        this.db.exec('CREATE TABLE shared_pilot_social (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL);');
        this.db.prepare('INSERT INTO shared_pilot_social (id,state) VALUES (1,?)').run(JSON.stringify(emptySocialState()));
      }
      if (version < 3) {
        this.db.exec('CREATE TABLE shared_pilot_survey (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL);');
        this.db.prepare('INSERT INTO shared_pilot_survey (id,state) VALUES (1,?)').run(JSON.stringify(emptySurveyState()));
      }
      if (version === 4) {
        this.db.exec(`
          ALTER TABLE shared_pilot_profiles RENAME TO shared_pilot_profiles_v4;
          ${PROFILE_TABLE}
          INSERT INTO shared_pilot_profiles (
            resident_id, name, avatar, session_hash, session_expires_at, invite_hash, access_hash, access_expires_at
          ) SELECT resident_id, name, avatar, session_hash, session_expires_at, invite_hash, access_hash, access_expires_at
            FROM shared_pilot_profiles_v4;
          DROP TABLE shared_pilot_profiles_v4;
        `);
      } else if (version < 4) {
        this.db.exec(PROFILE_TABLE);
      }
      this.db.exec(CAFE_ORDERS_TABLE);
      this.db.exec(`PRAGMA user_version=${SCHEMA_VERSION}; COMMIT`);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private readSocial(): SocialState {
    return JSON.parse(String(this.db.prepare('SELECT state FROM shared_pilot_social WHERE id=1').get()?.state)) as SocialState;
  }

  private saveSocial(state: SocialState) {
    this.db.prepare('UPDATE shared_pilot_social SET state=? WHERE id=1').run(JSON.stringify(state));
  }

  private readSurvey(): SurveyState {
    return JSON.parse(String(this.db.prepare('SELECT state FROM shared_pilot_survey WHERE id=1').get()?.state)) as SurveyState;
  }

  private saveSurvey(state: SurveyState) {
    this.db.prepare('UPDATE shared_pilot_survey SET state=? WHERE id=1').run(JSON.stringify(state));
  }

  private lastMove(id: SharedPilotResidentId) {
    return this.db.prepare('SELECT * FROM shared_pilot_moves WHERE resident_id=? ORDER BY seq DESC LIMIT 1').get(id) as unknown as MovementRow | undefined;
  }

  private residentPosition(id: SharedPilotResidentId, place: SharedPilotPlaceId, at: number): CityPoint {
    const movement = this.lastMove(id);
    return movement ? positionOnWalk(toWalk(movement), at) : point(place);
  }

  private socialResidents(at: number): SocialResident[] {
    const rows = this.db.prepare('SELECT id,place FROM shared_pilot_residents ORDER BY id').all() as unknown as ResidentRow[];
    return rows.map(({ id, place }) => ({ residentId: id, position: this.residentPosition(id, place, at), moving: this.lastMove(id)?.completed_at === null }));
  }

  private transaction<T>(work: (at: number) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    let closed = false;
    try {
      // The trusted clock is injected by the operator, never by a request. Its
      // high-water mark prevents credential resurrection on clock rollback.
      const previous = Number(this.db.prepare('SELECT logical_now FROM shared_pilot_meta WHERE id=1').get()?.logical_now);
      const at = Math.max(checkTime(previous), checkTime(this.clock()));
      this.db.prepare('UPDATE shared_pilot_meta SET logical_now=? WHERE id=1').run(at);
      this.db.exec('SAVEPOINT pilot_work');
      try {
        const result = work(at);
        this.db.exec('RELEASE pilot_work; COMMIT');
        closed = true;
        return result;
      } catch (error) {
        if (error instanceof SharedPilotError) {
          // Preserve only the server-clock watermark on expected denial; the
          // rejected action changes no movement, event, or credential.
          this.db.exec('ROLLBACK TO pilot_work; RELEASE pilot_work; COMMIT');
          closed = true;
        }
        throw error;
      }
    } catch (error) {
      if (!closed) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private authenticate(token: unknown, at: number): SharedPilotResidentId {
    let resident: unknown;
    if (typeof token === 'string' && TOKEN_PATTERN.test(token)) {
      resident = this.db.prepare('SELECT resident_id FROM shared_pilot_credentials WHERE token_hash=? AND expires_at>?').get(hashToken(token), at)?.resident_id;
    } else if (typeof token === 'string' && SHARED_PILOT_SECRET.test(token)) {
      resident = this.db.prepare('SELECT resident_id FROM shared_pilot_profiles WHERE access_hash=? AND access_expires_at>?')
        .get(hashToken(`access:${token}`), at)?.resident_id;
    }
    if (!SHARED_PILOT_RESIDENT_IDS.some((id) => id === resident)) {
      throw new SharedPilotError('AUTH_REQUIRED', 'An active shared pilot credential is required.');
    }
    return resident as SharedPilotResidentId;
  }

  private assertResident(residentId: SharedPilotResidentId) {
    if (!SHARED_PILOT_RESIDENT_IDS.includes(residentId)) throw new SharedPilotError('INVALID_REQUEST', 'Unknown shared pilot resident.');
  }

  private browserProfile(session: string, at: number) {
    if (!SHARED_PILOT_SECRET.test(session)) return undefined;
    return this.db.prepare(`SELECT resident_id AS residentId, name, avatar, access_expires_at AS expiresAt, session_expires_at AS sessionExpiresAt
      FROM shared_pilot_profiles WHERE session_hash=? AND session_expires_at>?`)
      .get(hashToken(`browser:${session}`), at) as (SharedPilotProfile & { expiresAt: number | null; sessionExpiresAt: number }) | undefined;
  }

  profile(session: string): SharedPilotProfileView {
    return this.transaction((at) => {
      const row = this.browserProfile(session, at);
      if (!row) return { profile: null, hasKey: false };
      const { residentId, name, avatar, expiresAt } = row;
      return { profile: { residentId, name, avatar }, hasKey: expiresAt !== null && expiresAt > at };
    });
  }

  claim(details: Pick<SharedPilotProfile, 'name' | 'avatar'>, profileResidents: readonly SharedPilotResidentId[], currentSession: string) {
    return this.transaction((at) => {
      if (this.browserProfile(currentSession, at)) {
        throw new SharedPilotError('CONFLICT', '当前浏览器已经创建了一个角色。');
      }
      const occupied = this.db.prepare('SELECT resident_id FROM shared_pilot_profiles').all();
      const residentId = profileResidents.find((id) => !occupied.some((row) => row.resident_id === id));
      if (!residentId) throw new SharedPilotError('CONFLICT', '当前两个本机试玩名额已占用，请返回城市查看。');
      this.assertResident(residentId);
      const profile: SharedPilotProfile = { residentId, name: details.name, avatar: details.avatar };
      const session = randomBytes(32).toString('base64url');
      // Keep the v5 storage format and its unique legacy claim marker.
      this.db.prepare(`INSERT INTO shared_pilot_profiles (resident_id,name,avatar,session_hash,session_expires_at,invite_hash)
        VALUES (?,?,?,?,?,?)`).run(profile.residentId, profile.name, profile.avatar, hashToken(`browser:${session}`),
          at + SHARED_PILOT_SESSION_SECONDS * 1000, hashToken(`claim:${session}`));
      return { session, profile, hasKey: false };
    });
  }

  setProfileKey(session: string, issue: boolean, profileResidents: readonly SharedPilotResidentId[]) {
    return this.transaction((at) => {
      const row = this.browserProfile(session, at);
      if (!row || !profileResidents.includes(row.residentId)) throw new SharedPilotError('AUTH_REQUIRED', '请在创建角色的浏览器重新打开入城页。');
      const key = issue ? randomBytes(32).toString('base64url') : null;
      const expiresAt = key ? Math.min(at + MAX_CREDENTIAL_LIFETIME, row.sessionExpiresAt) : null;
      this.db.prepare('UPDATE shared_pilot_profiles SET access_hash=?, access_expires_at=? WHERE resident_id=?')
        .run(key ? hashToken(`access:${key}`) : null, expiresAt, row.residentId);
      return { residentId: row.residentId, key, expiresAt, hasKey: issue };
    });
  }

  private settle(at: number) {
    // Record arrivals at their accepted server-computed deadline, not at the
    // time the first returning viewer happens to observe the city.
    const due = this.db.prepare('SELECT * FROM shared_pilot_moves WHERE completed_at IS NULL AND arrives_at<=? ORDER BY arrives_at,seq').all(at) as unknown as MovementRow[];
    const complete = this.db.prepare('UPDATE shared_pilot_moves SET completed_at=arrives_at WHERE seq=?');
    const place = this.db.prepare('UPDATE shared_pilot_residents SET place=? WHERE id=?');
    const event = this.db.prepare("INSERT INTO shared_pilot_events (movement_seq,kind,happened_at) VALUES (?,'MOVE_ARRIVED',?)");
    for (const movement of due) {
      complete.run(movement.seq);
      place.run(movement.destination, movement.resident_id);
      event.run(movement.seq, movement.arrives_at);
    }
    const social = this.readSocial();
    const residents = this.socialResidents(at);
    if (advanceSocial(social, at, residents)) this.saveSocial(social);
    const survey = this.readSurvey();
    if (advanceSurvey(survey, at, residents)) this.saveSurvey(survey);
    this.coffee.settle(at);
  }

  /** Server operator only. Issues a new secret and immediately invalidates the old one. */
  issueCredential(residentId: SharedPilotResidentId, ttlMs = CREDENTIAL_LIFETIME) {
    return this.transaction((at) => {
      this.assertResident(residentId);
      if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_CREDENTIAL_LIFETIME) {
        throw new SharedPilotError('INVALID_REQUEST', 'Invalid shared pilot credential lifetime.');
      }
      this.settle(at);
      const token = `nxc_shared_${randomBytes(32).toString('base64url')}`;
      const expiresAt = at + ttlMs;
      this.db.prepare(`INSERT INTO shared_pilot_credentials (resident_id,token_hash,issued_at,expires_at) VALUES (?,?,?,?)
        ON CONFLICT(resident_id) DO UPDATE SET token_hash=excluded.token_hash, issued_at=excluded.issued_at, expires_at=excluded.expires_at`)
        .run(residentId, hashToken(token), at, expiresAt);
      return { residentId, token, expiresAt };
    });
  }

  /** Server operator only. Accepted movements retain their scheduled arrival. */
  revokeCredential(residentId: SharedPilotResidentId) {
    this.transaction((at) => {
      this.assertResident(residentId);
      this.settle(at);
      this.db.prepare('DELETE FROM shared_pilot_credentials WHERE resident_id=?').run(residentId);
    });
  }

  private findReceipt(residentId: SharedPilotResidentId, requestId: string) {
    return this.db.prepare('SELECT * FROM shared_pilot_moves WHERE resident_id=? AND request_id=?').get(residentId, requestId) as unknown as MovementRow | undefined;
  }

  moveTo(token: unknown, input: unknown): SharedPilotReceipt {
    return this.transaction((at) => {
      const actor = this.authenticate(token, at);
      const parsed = sharedPilotMoveRequestSchema.safeParse(input);
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', 'Only a named pilot place can be requested.');
      const { requestId, destination } = parsed.data;
      this.settle(at);
      const social = this.readSocial();
      const survey = this.readSurvey();
      if (social.requests[actor][requestId] || survey.requests[actor][requestId] || this.coffee.find(actor, requestId)) throw new SharedPilotError('CONFLICT', 'Request ID already identifies a different city action.');
      const previous = this.findReceipt(actor, requestId);
      if (previous) {
        if (previous.destination !== destination.place) throw new SharedPilotError('CONFLICT', 'Request ID already identifies a different movement.');
        return toReceipt(previous);
      }
      if (this.coffee.active(actor, at)) throw new SharedPilotError('BUSY', '居民正在咖啡摊点单。');
      if (social.meeting?.status === 'talking' || (social.meeting?.status === 'accepted' && destination.place !== 'cafe')) {
        throw new SharedPilotError('BUSY', 'Resident is attending a café meeting.');
      }
      if (survey.task?.status === 'surveying' || (survey.task?.status === 'accepted' && destination.place !== 'works')) {
        throw new SharedPilotError('BUSY', 'Resident is attending a construction center survey.');
      }
      const anchor = social.meeting?.status === 'accepted' ? meetingPoint(actor) : undefined;
      const checkpoint = survey.task?.status === 'accepted' ? SURVEY_CHECKPOINTS[actor] : undefined;
      const target = checkpoint ? { x: checkpoint.x, z: checkpoint.z } : anchor ? { x: anchor[0], z: anchor[2] } : destination;
      this.beginMove(actor, requestId, destination.place, at, target, checkpoint ? `共同调研 · ${checkpoint.label}` : anchor ? '咖啡街会面' : undefined);
      this.settle(at); // A zero-distance route completes immediately, once.
      return toReceipt(this.findReceipt(actor, requestId)!);
    });
  }

  private beginMove(actor: SharedPilotResidentId, requestId: string, place: SharedPilotPlaceId, at: number,
    target: Parameters<typeof planCityWalk>[1], name?: string) {
    if (this.db.prepare('SELECT seq FROM shared_pilot_moves WHERE resident_id=? AND completed_at IS NULL').get(actor)) {
      throw new SharedPilotError('BUSY', 'This resident already has an accepted movement.');
    }
    const count = Number(this.db.prepare('SELECT count(*) AS count FROM shared_pilot_moves WHERE resident_id=?').get(actor)?.count);
    if (count >= MAX_MOVES_PER_RESIDENT) throw new SharedPilotError('LIMIT_REACHED', 'This resident has reached the local pilot journal limit.');
    const resident = this.db.prepare('SELECT id,place FROM shared_pilot_residents WHERE id=?').get(actor) as unknown as ResidentRow;
    const route = planCityWalk(this.residentPosition(actor, resident.place, at), target);
    if (!route) throw new SharedPilotError('UNREACHABLE', 'No surveyed route to this pilot place.');
    if (name) route.name = name;
    const arrivesAt = at + Math.ceil(route.metres / SPEED * 1000);
    const result = this.db.prepare(`INSERT INTO shared_pilot_moves (resident_id,request_id,destination,route_json,started_at,arrives_at)
      VALUES (?,?,?,?,?,?)`).run(actor, requestId, place, JSON.stringify(route), at, arrivesAt);
    this.db.prepare("INSERT INTO shared_pilot_events (movement_seq,kind,happened_at) VALUES (?,'MOVE_STARTED',?)").run(result.lastInsertRowid, at);
    return arrivesAt;
  }

  orderCoffee(credential: string, input: unknown, profileResidents?: readonly SharedPilotResidentId[]) {
    return this.transaction((at) => {
      const actor = profileResidents ? this.browserProfile(credential, at)?.residentId : this.authenticate(credential, at);
      if (!actor || (profileResidents && !profileResidents.includes(actor))) {
        throw new SharedPilotError('AUTH_REQUIRED', '请先在此浏览器创建居民。');
      }
      const parsed = orderCoffeeSchema.safeParse(input);
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', '咖啡订单无效。');
      const order = parsed.data;
      this.settle(at);
      const previous = this.coffee.find(actor, order.requestId);
      if (previous) {
        if (previous.drink !== order.drink) throw new SharedPilotError('CONFLICT', '请求编号已用于另一笔订单。');
        return this.coffee.receipt(previous);
      }
      const social = this.readSocial();
      const survey = this.readSurvey();
      if (this.findReceipt(actor, order.requestId) || social.requests[actor][order.requestId] || survey.requests[actor][order.requestId]) {
        throw new SharedPilotError('CONFLICT', '请求编号已用于其他城市行动。');
      }
      if (this.coffee.active(actor, at)) throw new SharedPilotError('BUSY', '请先等当前咖啡订单完成。');
      if (meetingActive(social.meeting) || surveyActive(survey.task)) {
        throw new SharedPilotError('BUSY', '居民正在赴约或调研，请稍后再点单。');
      }
      const [x, , z] = CAFE_QUEUE[actor];
      const arrivesAt = this.beginMove(actor, order.requestId, 'cafe', at, { x, z }, '前往咖啡摊点单');
      this.coffee.insert(actor, order, at, arrivesAt);
      this.settle(at);
      return this.coffee.receipt(this.coffee.find(actor, order.requestId)!);
    });
  }

  cafeTalk(question: string, token?: string) {
    return this.transaction((at) => {
      const actor = token === undefined ? undefined : this.authenticate(token, at);
      this.settle(at);
      if (actor) {
        const resident = this.db.prepare('SELECT place FROM shared_pilot_residents WHERE id=?').get(actor);
        if (resident?.place !== 'cafe' || this.lastMove(actor)?.completed_at === null) {
          throw new SharedPilotError('UNREACHABLE', '先到咖啡摊，再和阿棠说话。');
        }
      }
      return this.coffee.talk(question, at);
    });
  }

  socialAction(token: unknown, input: unknown, source: 'agent' | 'rules' = 'agent'): SocialReceipt {
    return this.transaction((at) => {
      const actor = this.authenticate(token, at);
      const parsed = sharedPilotSocialRequestSchema.safeParse(input);
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', 'Invalid shared social action.');
      if (this.findReceipt(actor, parsed.data.requestId)) throw new SharedPilotError('CONFLICT', 'Request ID already identifies a movement.');
      this.settle(at);
      const social = this.readSocial();
      const survey = this.readSurvey();
      if (survey.requests[actor][parsed.data.requestId]) throw new SharedPilotError('CONFLICT', 'Request ID already identifies a survey action.');
      if (!social.requests[actor][parsed.data.requestId] && this.coffee.hasActiveOrder(at)) throw new SharedPilotError('BUSY', '咖啡摊有居民正在点单。');
      if (surveyActive(survey.task) && !social.requests[actor][parsed.data.requestId]) throw new SharedPilotError('BUSY', 'A shared survey is active.');
      try {
        const residents = this.socialResidents(at);
        const receipt = performSocial(social, actor, parsed.data, at, residents, source);
        advanceSocial(social, at, residents);
        this.saveSocial(social);
        return receipt;
      } catch (error) {
        if (error instanceof SocialActionError) throw new SharedPilotError(error.code, error.message);
        throw error;
      }
    });
  }

  surveyAction(token: unknown, input: unknown): SurveyReceipt {
    return this.transaction((at) => {
      const actor = this.authenticate(token, at);
      const parsed = sharedPilotSurveyRequestSchema.safeParse(input);
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', 'Invalid shared survey action.');
      this.settle(at);
      const social = this.readSocial();
      if (this.findReceipt(actor, parsed.data.requestId) || social.requests[actor][parsed.data.requestId]) throw new SharedPilotError('CONFLICT', 'Request ID already identifies another city action.');
      const survey = this.readSurvey();
      if (!survey.requests[actor][parsed.data.requestId] && this.coffee.hasActiveOrder(at)) throw new SharedPilotError('BUSY', '咖啡摊有居民正在点单。');
      try {
        const residents = this.socialResidents(at);
        const receipt = performSurvey(survey, actor, parsed.data, at, residents, social.meeting);
        advanceSurvey(survey, at, residents);
        this.saveSurvey(survey);
        return receipt;
      } catch (error) {
        if (error instanceof SurveyActionError) throw new SharedPilotError(error.code, error.message);
        throw error;
      }
    });
  }

  receipt(token: unknown, requestId: unknown): SharedPilotReceipt {
    return this.transaction((at) => {
      const actor = this.authenticate(token, at);
      const parsed = sharedPilotMoveRequestSchema.safeParse({ requestId, action: 'moveTo', destination: { place: 'plaza' } });
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', 'Invalid movement request ID.');
      this.settle(at);
      const record = this.findReceipt(actor, parsed.data.requestId);
      if (!record) throw new SharedPilotError('NOT_FOUND', 'No such movement belongs to this resident.');
      return toReceipt(record);
    });
  }

  /** Authorized read-only shared projection. No request IDs or credentials are exposed. */
  observe(token: unknown) {
    return this.transaction((at) => {
      const viewerResidentId = this.authenticate(token, at);
      this.settle(at);
      const rows = this.db.prepare('SELECT id,place FROM shared_pilot_residents ORDER BY id').all() as unknown as ResidentRow[];
      const latest = this.db.prepare('SELECT * FROM shared_pilot_moves WHERE resident_id=? ORDER BY seq DESC LIMIT 1');
      const cafe = this.coffee.view(at);
      const residents = rows.map(({ id, place }) => {
        const movement = latest.get(id) as unknown as MovementRow | undefined;
        const order = latestCoffeeOrder(cafe.orders, id);
        const atCounter = order && cafePose(order, at);
        return {
          residentId: id, place, position: atCounter ? atCounter.point : movement ? positionOnWalk(toWalk(movement), at) : point(place),
          movement: movement ? publicMovement(movement) : null,
        };
      });
      const events = (this.db.prepare(`SELECT e.seq, m.resident_id, m.destination, e.kind, e.happened_at
        FROM shared_pilot_events e JOIN shared_pilot_moves m ON m.seq=e.movement_seq ORDER BY e.seq DESC LIMIT ?`)
        .all(PUBLIC_EVENT_LIMIT) as unknown as MovementEventRow[]).reverse().map((event) => ({
          id: String(event.seq), residentId: event.resident_id, place: event.destination, kind: event.kind, happenedAt: event.happened_at,
          provenance: SHARED_PILOT_PROVENANCE,
        }));
      const social = this.readSocial();
      const survey = this.readSurvey();
      const profiles = this.db.prepare('SELECT resident_id AS residentId, name, avatar FROM shared_pilot_profiles ORDER BY resident_id')
        .all() as unknown as SharedPilotProfile[];
      return {
        mode: 'DEMO' as const, provenance: SHARED_PILOT_PROVENANCE, viewerResidentId, serverTime: at, profiles,
        revision: events.at(-1)?.id ?? '0', residents, events,
        cafe,
        social: publicSocial(social, this.socialResidents(at)),
        survey: publicSurvey(survey, this.socialResidents(at), social.meeting),
        privateSocial: { memories: social.memories[viewerResidentId], encounters: social.encounters[viewerResidentId] },
      };
    });
  }

  close() { this.db.close(); }
}
