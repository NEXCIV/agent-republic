import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  SHARED_PILOT_PLACE_IDS, SHARED_PILOT_PROVENANCE, SHARED_PILOT_RESIDENT_IDS, sharedPilotMoveRequestSchema, sharedPilotSocialRequestSchema, sharedPilotSurveyRequestSchema,
  type SharedPilotPlaceId, type SharedPilotResidentId,
} from '@agent-republic/domain';
import { CAFE_BENCH_FRONT, type CityPoint } from './cafe-geometry';
import { positionOnWalk, type CityWalk } from './city-movement';
import { CITY_MAP, planCityWalk } from './city-navigation';
import { advanceSocial, emptySocialState, meetingActive, meetingPoint, performSocial, publicSocial, SocialActionError, type SocialState, type SocialResident, type SocialReceipt } from './shared-pilot-social';
import { advanceSurvey, emptySurveyState, performSurvey, publicSurvey, SURVEY_CHECKPOINTS, surveyActive, SurveyActionError, type SurveyState, type SurveyReceipt } from './shared-pilot-survey';
import { SHARED_AVATARS, SHARED_PILOT_SECRET, SHARED_PILOT_SESSION_SECONDS, latestResidentActivity, type SharedPilotProfile, type SharedPilotProfileView } from './shared-pilot-profiles';
import { CAFE_ORDERS_TABLE, CAFE_QUEUE, cafePose, CafeOrders, orderCoffeeSchema } from './shared-pilot-cafe';
import { cancelWorksGoalSchema, inspectWorksSchema, surveyWorksSiteSchema, SURVEY_OBSERVATION_MS, WORKS_CHECKS, WORKS_GOALS_TABLE,
  worksBriefView, worksGoalActionSchema, worksGoalEvents, worksGoalView, worksReply, worksView,
  type InspectionRoute, type WorksBrief, type WorksCheck, type WorksGoalRow } from './shared-pilot-works';
import { FISHING_TABLE, FISHING_WAIT, FishingVisits, fishingOutcome, fishingPose, goFishingSchema } from './shared-pilot-fishing';
import { explorationActionSchema, explorationScenes, explorationView, type FirstExplorationObservation } from './shared-pilot-exploration';
import { noteActivityLabel, playerNoteView, resolvePlayerNoteSchema, submitPlayerNoteSchema } from './shared-pilot-notes';
import { BENCH_COOLDOWN_MS, BENCH_RANGE, BENCH_SEAT, benchProjection, benchRest, benchRestSchema, localDistance, nearbyAt } from './shared-pilot-bench';
import { COUNCIL_NOTICE_APPROACH, COUNCIL_NOTICE_READING_SPOT } from './council-notice';
import { councilProjection, councilRead, councilReadSchema, sharedTheatreSchema, sharedTheatreView, SHARED_THEATRE_RULES, theatreSeat } from './shared-pilot-civic';
import { applyTheatreDecision, observeTheatre, theatreJourney, type TheatreContext } from './theatre-trial';

// E3-05 isolated local integration pilot. Not the official WorldFrame and never
// exposed by a route, guest service, or wallet API. Two operator-controlled slots.
const APPLICATION_ID = 0x4e585350; // NXSP
const SCHEMA_VERSION = 9;
const CREDENTIAL_LIFETIME = 3600000;
const MAX_CREDENTIAL_LIFETIME = 86400000;
const SPEED = 4;
const MAX_MOVES_PER_RESIDENT = 300;
const PUBLIC_EVENT_LIMIT = 40;
const MAX_PLAYER_NOTES = 120;
const TOKEN_PATTERN = /^nxc_shared_[A-Za-z0-9_-]{43}$/;
const V1_TABLES = [
  'shared_pilot_credentials', 'shared_pilot_events', 'shared_pilot_meta', 'shared_pilot_moves', 'shared_pilot_residents',
];
const V2_TABLES = [...V1_TABLES, 'shared_pilot_social'];
const V3_TABLES = [...V2_TABLES, 'shared_pilot_survey'];
const V5_TABLES = [...V3_TABLES, 'shared_pilot_profiles'].sort();
const V6_TABLES = [...V5_TABLES, 'shared_pilot_cafe_orders'].sort();
const V7_TABLES = [...V6_TABLES, 'shared_pilot_fishing'].sort();
const EXPECTED_TABLES = [...V7_TABLES, 'shared_pilot_works_goals'].sort();
const PLACES_SQL = SHARED_PILOT_PLACE_IDS.map(id => `'${id}'`).join(',');
const RESIDENT_IDS_SQL = SHARED_PILOT_RESIDENT_IDS.map(id => `'${id}'`).join(',');
const createResidentsTable = (table: string) => `CREATE TABLE ${table} (
  id TEXT PRIMARY KEY CHECK(id IN (${RESIDENT_IDS_SQL})),
  place TEXT NOT NULL CHECK(place IN (${PLACES_SQL}))
);`;
const createMovesTable = (table: string, residents: string) => `CREATE TABLE ${table} (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  resident_id TEXT NOT NULL REFERENCES ${residents}(id), request_id TEXT NOT NULL,
  destination TEXT NOT NULL CHECK(destination IN (${PLACES_SQL})),
  route_json TEXT NOT NULL, started_at INTEGER NOT NULL, arrives_at INTEGER NOT NULL CHECK(arrives_at>=started_at),
  completed_at INTEGER CHECK(completed_at IS NULL OR completed_at=arrives_at),
  UNIQUE(resident_id,request_id)
);`;
const ACTIVE_MOVES_INDEX = 'CREATE UNIQUE INDEX shared_pilot_active_movement ON shared_pilot_moves(resident_id) WHERE completed_at IS NULL;';
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
type ActivityRoute = InspectionRoute & Pick<CityWalk, 'stops' | 'facing'> & { benchRest?: true; noticeRead?: true; theatreWalk?: true };
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
  const route: ActivityRoute = JSON.parse(row.route_json);
  return {
    destination: { place: row.destination }, name: route.name, points: route.points, regions: route.regions, metres: route.metres,
    requestId: row.request_id, startedAt: row.started_at, arrivesAt: row.arrives_at,
    ...(route.stops && { stops: route.stops }), ...(route.facing && { facing: route.facing }),
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
  private readonly fishing: FishingVisits;
  private transactionTime?: number;

  constructor(filename: string, private readonly clock: () => number) {
    const sqlite = process.getBuiltinModule?.('node:sqlite') as typeof import('node:sqlite') | undefined;
    if (!sqlite) throw new SharedPilotError('INVALID_CONFIG', 'Shared pilot requires Node.js with SQLite.');
    const file = isolatedFilename(filename);
    const existing = existsSync(file);
    const initialAt = existing ? null : checkTime(clock());
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new sqlite.DatabaseSync(file);
    this.coffee = new CafeOrders(this.db);
    this.fishing = new FishingVisits(this.db);
    try {
      // Reject unrelated DBs before setting WAL or running any schema changes.
      let migrateFrom: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | undefined;
      if (existing) {
        const application = Number(this.db.prepare('PRAGMA application_id').get()?.application_id);
        const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
        const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => name);
        if (application === APPLICATION_ID && version === 1 && JSON.stringify(tables) === JSON.stringify(V1_TABLES)) migrateFrom = 1;
        if (application === APPLICATION_ID && version === 2 && JSON.stringify(tables) === JSON.stringify(V2_TABLES)) migrateFrom = 2;
        if (application === APPLICATION_ID && version === 3 && JSON.stringify(tables) === JSON.stringify(V3_TABLES)) migrateFrom = 3;
        if (application === APPLICATION_ID && (version === 4 || version === 5) && JSON.stringify(tables) === JSON.stringify(V5_TABLES)) migrateFrom = version;
        if (application === APPLICATION_ID && version === 6 && JSON.stringify(tables) === JSON.stringify(V6_TABLES)) migrateFrom = 6;
        if (application === APPLICATION_ID && version === 7 && JSON.stringify(tables) === JSON.stringify(V7_TABLES)) migrateFrom = 7;
        if (application === APPLICATION_ID && version === 8 && JSON.stringify(tables) === JSON.stringify(EXPECTED_TABLES)) migrateFrom = 8;
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
        ${createResidentsTable('shared_pilot_residents')}
        CREATE TABLE shared_pilot_credentials (
          resident_id TEXT PRIMARY KEY REFERENCES shared_pilot_residents(id),
          token_hash TEXT NOT NULL UNIQUE, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at>issued_at)
        );
        ${createMovesTable('shared_pilot_moves', 'shared_pilot_residents')}
        ${ACTIVE_MOVES_INDEX}
        CREATE TABLE shared_pilot_events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, movement_seq INTEGER NOT NULL REFERENCES shared_pilot_moves(seq),
          kind TEXT NOT NULL CHECK(kind IN ('MOVE_STARTED','MOVE_ARRIVED')), happened_at INTEGER NOT NULL,
          UNIQUE(movement_seq,kind)
        );
        CREATE TABLE shared_pilot_social (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL);
        CREATE TABLE shared_pilot_survey (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL);
        ${PROFILE_TABLE}
        ${CAFE_ORDERS_TABLE}
        ${FISHING_TABLE}
        ${WORKS_GOALS_TABLE}
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

  private migratePilot(version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8) {
    // The fixed place checks live in two referenced tables. Replace both inside
    // the same transaction, preserving the IDs used by events, profiles and orders.
    this.db.exec('PRAGMA foreign_keys=OFF');
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
      if (version < 6) this.db.exec(CAFE_ORDERS_TABLE);
      this.db.exec(`
        ${createResidentsTable('shared_pilot_residents_next')}
        ${createMovesTable('shared_pilot_moves_next', 'shared_pilot_residents_next')}
        INSERT INTO shared_pilot_residents_next SELECT * FROM shared_pilot_residents;
        INSERT INTO shared_pilot_moves_next SELECT * FROM shared_pilot_moves;
        DROP TABLE shared_pilot_moves;
        DROP TABLE shared_pilot_residents;
        ALTER TABLE shared_pilot_residents_next RENAME TO shared_pilot_residents;
        ALTER TABLE shared_pilot_moves_next RENAME TO shared_pilot_moves;
        ${ACTIVE_MOVES_INDEX}
      `);
      if (version < 7) this.db.exec(FISHING_TABLE);
      if (version < 8) this.db.exec(WORKS_GOALS_TABLE);
      if (this.db.prepare('PRAGMA foreign_key_check').get()) throw new Error('Shared pilot migration would leave broken references.');
      this.db.exec(`PRAGMA user_version=${SCHEMA_VERSION}; COMMIT`);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.db.exec('PRAGMA foreign_keys=ON'); }
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
    if (this.transactionTime !== undefined) return work(this.transactionTime);
    this.db.exec('BEGIN IMMEDIATE');
    let closed = false;
    try {
      // The trusted clock is injected by the operator, never by a request. Its
      // high-water mark prevents credential resurrection on clock rollback.
      const previous = Number(this.db.prepare('SELECT logical_now FROM shared_pilot_meta WHERE id=1').get()?.logical_now);
      const at = Math.max(checkTime(previous), checkTime(this.clock()));
      this.db.prepare('UPDATE shared_pilot_meta SET logical_now=? WHERE id=1').run(at);
      this.db.exec('SAVEPOINT pilot_work');
      this.transactionTime = at;
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
    } finally {
      this.transactionTime = undefined;
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
    this.fishing.settle();
    this.assignWorksBriefs(at);
    this.db.prepare(`UPDATE shared_pilot_works_goals SET closed_at=(
      SELECT completed_at + ? FROM shared_pilot_moves WHERE seq=inspection_seq
    ) WHERE closed_at IS NULL AND inspection_seq IN (
      SELECT seq FROM shared_pilot_moves WHERE completed_at + ? <= ?
    )`).run(SURVEY_OBSERVATION_MS, SURVEY_OBSERVATION_MS, at);
  }

  private assignWorksBriefs(at: number) {
    const pending = this.db.prepare(`SELECT * FROM shared_pilot_moves WHERE destination='works'
      AND completed_at IS NOT NULL AND json_extract(route_json,'$.worksBrief.status')='pending'
      ORDER BY arrives_at,seq`).all() as unknown as MovementRow[];
    if (!pending.length) return;
    const update = this.db.prepare('UPDATE shared_pilot_moves SET route_json=? WHERE seq=?');
    for (const row of pending) {
      const route = JSON.parse(row.route_json) as InspectionRoute;
      const resident = row.resident_id;
      const occupied = this.activeInspections(at).map(visit => visit.checkId);
      const checkId = (Object.keys(WORKS_CHECKS) as WorksCheck[]).find(id => !occupied.includes(id));
      if (!checkId) continue;
      const managerReply = occupied.length ? worksReply('现在还有哪里可以巡查？', occupied, false).text : null;
      const requestId = randomUUID();
      let brief: WorksBrief;
      try {
        this.beginWorksInspection(resident, requestId, at, checkId, 'site-brief');
        brief = { status: 'assigned', decision: { checkId, managerReply, decidedAt: at },
          inspectionSeq: this.findReceipt(resident, requestId)!.seq };
      } catch (error) {
        if (!(error instanceof SharedPilotError) || !['UNREACHABLE', 'LIMIT_REACHED'].includes(error.code)) throw error;
        brief = { status: 'failed', reason: '目前无法前往可用的巡查点。' };
      }
      update.run(JSON.stringify({ ...route, worksBrief: brief }), row.seq);
    }
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

  private activeInspections(at: number) {
    return this.db.prepare(`SELECT resident_id AS residentId, json_extract(route_json, '$.worksInspection.checkId') AS checkId
      FROM shared_pilot_moves WHERE destination='works' AND json_extract(route_json, '$.worksInspection') IS NOT NULL
      AND (completed_at IS NULL OR completed_at + json_extract(route_json, '$.worksInspection.durationMs')>?)`)
      .all(at) as { residentId: SharedPilotResidentId; checkId: WorksCheck }[];
  }

  private pendingWorksBrief() {
    return this.db.prepare(`SELECT seq FROM shared_pilot_moves WHERE destination='works'
      AND json_extract(route_json,'$.worksBrief.status')='pending' LIMIT 1`).get();
  }

  private latestWorksGoal(actor: SharedPilotResidentId) {
    return this.db.prepare('SELECT * FROM shared_pilot_works_goals WHERE resident_id=? ORDER BY seq DESC LIMIT 1')
      .get(actor) as WorksGoalRow | undefined;
  }

  private claimedWorksGoal(actor?: SharedPilotResidentId) {
    return this.db.prepare(`SELECT 1 FROM shared_pilot_works_goals
      WHERE closed_at IS NULL AND arrival_seq IS NOT NULL AND resident_id=COALESCE(?,resident_id) LIMIT 1`).get(actor ?? null);
  }

  private movementBySeq(seq: number | null) {
    return seq === null ? undefined : this.db.prepare('SELECT * FROM shared_pilot_moves WHERE seq=?').get(seq) as unknown as MovementRow;
  }

  private worksGoalState(row: WorksGoalRow, at: number) {
    return worksGoalView(row, this.movementBySeq(row.arrival_seq), this.movementBySeq(row.inspection_seq), at);
  }

  private browserOrAgent(credential: string, at: number, profileResidents?: readonly SharedPilotResidentId[]) {
    if (!profileResidents) return this.authenticate(credential, at);
    const actor = this.browserProfile(credential, at)?.residentId;
    if (!actor || !profileResidents.includes(actor)) throw new SharedPilotError('AUTH_REQUIRED', '请先在此浏览器创建居民。');
    return actor;
  }

  profileNotes(session: string, profileResidents: readonly SharedPilotResidentId[]) {
    return this.transaction(at => {
      const actor = this.browserOrAgent(session, at, profileResidents);
      return (this.readSocial().playerNotes?.[actor] ?? []).map(note => playerNoteView(note, at));
    });
  }

  submitPlayerNote(session: string, input: unknown, profileResidents: readonly SharedPilotResidentId[]) {
    return this.transaction(at => {
      const actor = this.browserOrAgent(session, at, profileResidents);
      const parsed = submitPlayerNoteSchema.safeParse(input);
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', '请填写一张不含链接或凭据的纸条。');
      const social = this.readSocial();
      const entries = social.playerNotes ??= {};
      const notes = entries[actor] ??= [];
      const { noteId: id, text } = parsed.data;
      const previous = notes.find(note => note.id === id);
      if (previous) {
        if (previous.text !== text) throw new SharedPilotError('CONFLICT', '这张纸条已经送出。');
        return playerNoteView(previous, at);
      }
      if (notes.some(note => playerNoteView(note, at).status === 'pending')) throw new SharedPilotError('BUSY', '上一张纸条正在等待 Agent 处理。');
      if (notes.length >= MAX_PLAYER_NOTES) throw new SharedPilotError('LIMIT_REACHED', '本轮试玩的纸条记录已满。');
      const note = { id, text, sentAt: at };
      notes.push(note);
      this.saveSocial(social);
      return playerNoteView(note, at);
    });
  }

  resolvePlayerNote(token: string, input: unknown) {
    return this.transaction(at => {
      const actor = this.authenticate(token, at);
      const parsed = resolvePlayerNoteSchema.safeParse(input);
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', '纸条回复或活动无效。');
      const resolution = parsed.data;
      const social = this.readSocial();
      const note = social.playerNotes?.[actor]?.find(item => item.id === resolution.noteId);
      if (!note) throw new SharedPilotError('NOT_FOUND', '这张纸条无法处理。');
      if (note.response) {
        if (JSON.stringify(note.response.resolution) !== JSON.stringify(resolution)) throw new SharedPilotError('CONFLICT', '这张纸条已经处理。');
        return playerNoteView(note, at);
      }
      if (playerNoteView(note, at).status === 'expired') throw new SharedPilotError('CONFLICT', '这张纸条已过期。');
      let activityLabel: string | undefined;
      if (resolution.decision !== 'skipped') {
        const { activity } = resolution;
        if (this.findReceipt(actor, activity.requestId) || social.requests[actor][activity.requestId]
          || this.readSurvey().requests[actor][activity.requestId]) {
          throw new SharedPilotError('CONFLICT', '请为这张纸条提交一个新活动。');
        }
        // The activity and the private receipt share this transaction and its server clock.
        switch (activity.action) {
          case 'moveTo': this.moveTo(token, activity); break;
          case 'invite': this.socialAction(token, activity); break;
          case 'orderCoffee': this.orderCoffee(token, activity); break;
          case 'inspectWorks': this.requestInspection(token, activity); break;
          case 'goFishing': this.goFishing(token, activity); break;
          case 'restAtBench': this.restAtBench(token, activity); break;
        }
        activityLabel = noteActivityLabel(activity);
      }
      const updated = this.readSocial();
      const stored = updated.playerNotes![actor]!.find(item => item.id === resolution.noteId)!;
      stored.response = { resolution, handledAt: at, activityLabel };
      this.saveSocial(updated);
      return playerNoteView(stored, at);
    });
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
        const route = JSON.parse(previous.route_json) as ActivityRoute;
        if (previous.destination !== destination.place || this.fishing.find(actor, requestId) || route.worksInspection || route.worksBrief
          || route.benchRest || route.noticeRead || route.theatreWalk) {
          throw new SharedPilotError('CONFLICT', 'Request ID already identifies a different movement.');
        }
        return toReceipt(previous);
      }
      if (this.coffee.active(actor, at)) throw new SharedPilotError('BUSY', '居民正在咖啡摊点单。');
      if (this.fishing.active(at, actor)) throw new SharedPilotError('BUSY', '居民正在北岸钓鱼。');
      if (this.activeInspections(at).some(visit => visit.residentId === actor)) throw new SharedPilotError('BUSY', '居民正在执行现场巡查。');
      if (this.claimedWorksGoal(actor)) throw new SharedPilotError('BUSY', '居民正在执行建设中心调研。');
      if (social.meeting?.status === 'talking' || (social.meeting?.status === 'accepted' && destination.place !== 'cafe')) {
        throw new SharedPilotError('BUSY', 'Resident is attending a café meeting.');
      }
      if (survey.task?.status === 'surveying' || (survey.task?.status === 'accepted' && destination.place !== 'works')) {
        throw new SharedPilotError('BUSY', 'Resident is attending a construction center survey.');
      }
      const anchor = social.meeting?.status === 'accepted' ? meetingPoint(actor) : undefined;
      const checkpoint = survey.task?.status === 'accepted' ? SURVEY_CHECKPOINTS[actor] : undefined;
      const target = checkpoint ? { x: checkpoint.x, z: checkpoint.z } : anchor ? { x: anchor[0], z: anchor[2] }
        : destination.place === 'pier' ? { x: 71, z: -186 } : destination;
      this.beginMove(actor, requestId, destination.place, at, target, checkpoint ? `共同调研 · ${checkpoint.label}` : anchor ? '咖啡街会面'
        : destination.place === 'pier' ? '北岸码头' : undefined);
      this.settle(at); // A zero-distance route completes immediately, once.
      return toReceipt(this.findReceipt(actor, requestId)!);
    });
  }

  private beginMove(actor: SharedPilotResidentId, requestId: string, place: SharedPilotPlaceId, at: number,
    target: Parameters<typeof planCityWalk>[1], name?: string,
    activity?: Pick<ActivityRoute, 'worksInspection' | 'worksBrief' | 'benchRest' | 'noticeRead'>) {
    const { last, count } = this.requireMovementSlot(actor, at);
    const resident = this.db.prepare('SELECT id,place FROM shared_pilot_residents WHERE id=?').get(actor) as unknown as ResidentRow;
    const route = planCityWalk(last ? positionOnWalk(toWalk(last), at) : point(resident.place), target);
    if (!route) throw new SharedPilotError('UNREACHABLE', 'No surveyed route to this pilot place.');
    if (name) route.name = name;
    if (activity?.worksBrief && count >= MAX_MOVES_PER_RESIDENT - 1) {
      throw new SharedPilotError('LIMIT_REACHED', '此居民的行程记录已接近上限，无法安排完整调研。');
    }
    const arrivesAt = at + Math.ceil(route.metres / SPEED * 1000);
    this.saveMovement(actor, requestId, place, at, arrivesAt, { ...route, ...activity });
    return arrivesAt;
  }

  private requireMovementSlot(actor: SharedPilotResidentId, at: number) {
    const last = this.lastMove(actor);
    if (last?.completed_at === null) {
      throw new SharedPilotError('BUSY', 'This resident already has an accepted movement.');
    }
    if (last) {
      const activity = JSON.parse(last.route_json) as ActivityRoute;
      if (activity.benchRest && benchRest(last, at).stage === 'resting') throw new SharedPilotError('BUSY', '居民正在长椅上休息。');
      if (activity.noticeRead && councilRead(last, at).stage === 'reading') throw new SharedPilotError('BUSY', '居民正在阅读议会公告。');
    }
    const count = Number(this.db.prepare('SELECT count(*) AS count FROM shared_pilot_moves WHERE resident_id=?').get(actor)?.count);
    if (count >= MAX_MOVES_PER_RESIDENT) throw new SharedPilotError('LIMIT_REACHED', 'This resident has reached the local pilot journal limit.');
    return { last, count };
  }

  private saveMovement(actor: SharedPilotResidentId, requestId: string, place: SharedPilotPlaceId, at: number, arrivesAt: number, route: ActivityRoute) {
    const result = this.db.prepare(`INSERT INTO shared_pilot_moves (resident_id,request_id,destination,route_json,started_at,arrives_at)
      VALUES (?,?,?,?,?,?)`).run(actor, requestId, place, JSON.stringify(route), at, arrivesAt);
    this.db.prepare("INSERT INTO shared_pilot_events (movement_seq,kind,happened_at) VALUES (?,'MOVE_STARTED',?)").run(result.lastInsertRowid, at);
  }

  private councilRows() {
    return this.db.prepare(`SELECT * FROM shared_pilot_moves WHERE json_extract(route_json, '$.noticeRead')=1
      ORDER BY seq DESC LIMIT 24`).all() as unknown as MovementRow[];
  }

  readCouncilNotice(credential: string, input: unknown, profileResidents?: readonly SharedPilotResidentId[]) {
    return this.transaction(at => {
      const actor = this.browserOrAgent(credential, at, profileResidents);
      const parsed = councilReadSchema.safeParse(input);
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', '公告阅读请求无效。');
      const { requestId } = parsed.data;
      this.settle(at);
      const previous = this.findReceipt(actor, requestId);
      if (previous) {
        if (!(JSON.parse(previous.route_json) as ActivityRoute).noticeRead) throw new SharedPilotError('CONFLICT', '请求编号已用于其他活动。');
        return councilRead(previous, at);
      }
      this.ensureWorksAvailable(actor, at);
      if (this.claimedWorksGoal(actor) || this.activeInspections(at).some(visit => visit.residentId === actor)) {
        throw new SharedPilotError('BUSY', '请先完成当前巡查。');
      }
      if (this.readSocial().requests[actor][requestId] || this.readSurvey().requests[actor][requestId]) {
        throw new SharedPilotError('CONFLICT', '请求编号已用于其他活动。');
      }
      const alternate = COUNCIL_NOTICE_APPROACH[0]!;
      const point = actor === '01' ? COUNCIL_NOTICE_READING_SPOT : { x: alternate[0], z: alternate[2] };
      this.beginMove(actor, requestId, 'governance', at, point, '前往议会公告栏', { noticeRead: true });
      this.settle(at);
      return councilRead(this.findReceipt(actor, requestId)!, at);
    });
  }

  private theatreContext(at: number, social: SocialState, survey: SurveyState): TheatreContext {
    const context = {} as TheatreContext;
    const surveyOrMeeting = meetingActive(social.meeting) || surveyActive(survey.task);
    const inspections = this.activeInspections(at);
    for (const resident of this.socialResidents(at)) {
      const id = resident.residentId;
      const last = this.lastMove(id);
      const recentRoute = last ? JSON.parse(last.route_json) as ActivityRoute : undefined;
      const busy = surveyOrMeeting || resident.moving || this.coffee.active(id, at) || this.fishing.active(at, id)
        || this.latestWorksGoal(id)?.closed_at === null || inspections.some(visit => visit.residentId === id)
        || Boolean(last && (recentRoute?.benchRest && benchRest(last, at).stage === 'resting'
          || recentRoute?.noticeRead && councilRead(last, at).stage === 'reading'));
      // The shared pilot has no energy ledger. Availability is determined by its current activities and travel time.
      context[theatreSeat(id)] = { position: resident.position, busy, energy: 100 };
    }
    return context;
  }

  theatreAction(credential: string, input: unknown, profileResidents?: readonly SharedPilotResidentId[]) {
    return this.transaction(at => {
      const actor = this.browserOrAgent(credential, at, profileResidents);
      const parsed = sharedTheatreSchema.safeParse(input);
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', '剧场决定无效。');
      this.settle(at);
      const social = this.readSocial();
      const survey = this.readSurvey();
      const { requestId, revision, decision, slot, cue, response } = parsed.data;
      const context = this.theatreContext(at, social, survey);
      const result = applyTheatreDecision(social.theatre, context, { revision, decision, slot, cue, response, agentId: theatreSeat(actor) },
        requestId, at, SHARED_THEATRE_RULES);
      if ('error' in result) throw new SharedPilotError(result.code === 409 ? 'CONFLICT' : 'BUSY', result.error!);
      if (result.repeated) return sharedTheatreView(result.view);
      if (this.findReceipt(actor, requestId) || social.requests[actor][requestId] || survey.requests[actor][requestId]) {
        throw new SharedPilotError('CONFLICT', '请求编号已用于其他活动。');
      }
      if (decision === 'attend') {
        this.requireMovementSlot(actor, at);
        const { walk } = theatreJourney(result.state, theatreSeat(actor))!;
        this.saveMovement(actor, requestId, 'forum', at, walk.arrivesAt, {
          destination: { place: 'forum' }, name: walk.name, points: walk.points, regions: walk.regions, metres: walk.metres,
          facing: walk.facing, stops: walk.stops, theatreWalk: true,
        });
      }
      social.theatre = result.state;
      this.saveSocial(social);
      return sharedTheatreView(result.view);
    });
  }

  private benchRows() {
    return this.db.prepare(`SELECT * FROM shared_pilot_moves WHERE json_extract(route_json, '$.benchRest')=1
      ORDER BY seq DESC LIMIT 24`).all() as unknown as MovementRow[];
  }

  private recentBenchRest(actor: SharedPilotResidentId, at: number) {
    const row = this.db.prepare(`SELECT * FROM shared_pilot_moves WHERE resident_id=? AND json_extract(route_json, '$.benchRest')=1
      ORDER BY seq DESC LIMIT 1`).get(actor) as unknown as MovementRow | undefined;
    const last = row && benchRest(row, at);
    return last?.stage === 'completed' ? { place: 'cafe' as const, endedAt: last.endsAt } : null;
  }

  restAtBench(token: string, input: unknown) {
    return this.transaction(at => {
      const actor = this.authenticate(token, at);
      const parsed = benchRestSchema.safeParse(input);
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', '请指定现有长椅。');
      const { requestId } = parsed.data;
      this.settle(at);
      const previous = this.findReceipt(actor, requestId);
      if (previous) {
        if (!(JSON.parse(previous.route_json) as ActivityRoute).benchRest) throw new SharedPilotError('CONFLICT', '请求编号已用于其他活动。');
        return benchRest(previous, at);
      }
      const pending = this.latestWorksGoal(actor);
      if (pending?.closed_at === null || this.activeInspections(at).some(visit => visit.residentId === actor)
        || this.pendingWorksBrief()) throw new SharedPilotError('BUSY', '请先执行完当前的安排。');
      this.ensureWorksAvailable(actor, at);
      const state = this.db.prepare('SELECT place FROM shared_pilot_residents WHERE id=?').get(actor) as unknown as { place: SharedPilotPlaceId };
      if (localDistance(this.residentPosition(actor, state.place, at), CAFE_BENCH_FRONT) > BENCH_RANGE) {
        throw new SharedPilotError('UNREACHABLE', '先走到咖啡街长椅附近。');
      }
      if (this.benchRows().some(row => benchRest(row, at).stage !== 'completed')) throw new SharedPilotError('BUSY', '长椅已有居民使用。');
      const recent = this.recentBenchRest(actor, at);
      if (recent && at < recent.endedAt + BENCH_COOLDOWN_MS) throw new SharedPilotError('BUSY', '这位居民刚在这里休息过。');
      if (this.readSocial().requests[actor][requestId] || this.readSurvey().requests[actor][requestId]) {
        throw new SharedPilotError('CONFLICT', '请求编号已用于其他活动。');
      }
      const [x, , z] = CAFE_BENCH_FRONT;
      this.beginMove(actor, requestId, 'cafe', at, { x, z }, '前往咖啡街长椅', { benchRest: true });
      this.settle(at);
      return benchRest(this.findReceipt(actor, requestId)!, at);
    });
  }

  private ensureWorksAvailable(actor: SharedPilotResidentId, at: number) {
    if (meetingActive(this.readSocial().meeting) || surveyActive(this.readSurvey().task)
      || this.coffee.active(actor, at) || this.fishing.active(at, actor)) {
      throw new SharedPilotError('BUSY', '居民已有安排，请完成当前活动后再巡查。');
    }
  }

  explore(token: string, input: unknown) {
    return this.transaction(at => {
      const actor = this.authenticate(token, at);
      const parsed = explorationActionSchema.safeParse(input);
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', '请使用一个可用地点和一句不含链接或凭据的现场对话。');
      const request = parsed.data;
      if (!this.db.prepare('SELECT 1 FROM shared_pilot_profiles WHERE resident_id=?').get(actor)) {
        throw new SharedPilotError('AUTH_REQUIRED', '建立居民档案后可开始首次探索。');
      }
      this.settle(at);
      const social = this.readSocial();
      const entries = social.firstExplorations ??= {};
      const trip = entries[actor];
      const previous = request.action === 'exploreSite' ? trip?.trip : trip?.result?.action;
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(request)) throw new SharedPilotError('CONFLICT', '已记录该次探索动作。');
        return explorationView({ [actor]: trip }).events.at(request.action === 'exploreSite' ? 0 : -1)!;
      }
      this.ensureWorksAvailable(actor, at);
      const occupied = this.activeInspections(at);
      if (this.latestWorksGoal(actor)?.closed_at === null || occupied.some(item => item.residentId === actor)) {
        throw new SharedPilotError('BUSY', '请先完成当前巡查。');
      }
      const resident = this.db.prepare('SELECT place FROM shared_pilot_residents WHERE id=?').get(actor);
      if (request.action === 'exploreSite') {
        if (resident?.place === request.place) throw new SharedPilotError('INVALID_REQUEST', '请选择一个还没到达的探索地点。');
        const survey = this.readSurvey();
        if (this.findReceipt(actor, request.requestId) || social.requests[actor][request.requestId] || survey.requests[actor][request.requestId]) {
          throw new SharedPilotError('CONFLICT', '请求编号已用于其他动作。');
        }
        const target = request.place === 'pier' ? { x: 71, z: -186 } : { place: request.place };
        const arrivesAt = this.beginMove(actor, request.requestId, request.place, at, target);
        entries[actor] = { trip: request, startedAt: at, arrivesAt };
      } else {
        const movement = this.lastMove(actor);
        if (!trip || request.requestId === trip.trip.requestId || resident?.place !== trip.trip.place
          || movement?.request_id !== trip.trip.requestId || movement.completed_at === null) {
          throw new SharedPilotError('BUSY', '完成首次探索的到场行程后才能互动。');
        }
        const scenes = explorationScenes({ cafe: this.coffee.view(at), freeWorksChecks: 2 - occupied.length, fishing: this.fishing.view(at) });
        const site = scenes.find(item => item.place === trip.trip.place)!;
        const reply = request.activity === 'look' ? site.observation : `${site.contact}：${
          site.place === 'cafe' ? this.coffee.talk(request.text, at).text
            : site.place === 'pier' ? this.fishing.talk(request.text, at).text
              : worksReply(request.text, occupied.map(item => item.checkId), false).text
        }`;
        trip.result = { action: request, happenedAt: at, reply };
      }
      this.saveSocial(social);
      return explorationView({ [actor]: entries[actor] }).events.at(-1)!;
    });
  }

  private beginWorksInspection(actor: SharedPilotResidentId, requestId: string, at: number, checkId: WorksCheck,
    origin?: NonNullable<InspectionRoute['worksInspection']>['origin']) {
    const { x, z, label, finding } = WORKS_CHECKS[checkId];
    // Space two residents along the same surveyed footpath if one stays after a visit.
    const target = { x, z: z + (actor === '02' ? 0.85 : 0) };
    return this.beginMove(actor, requestId, 'works', at, target, `现场巡查 · ${label}`,
      { worksInspection: { checkId, label, finding, durationMs: SURVEY_OBSERVATION_MS, origin } });
  }

  startWorksBrief(session: string, input: unknown, profileResidents: readonly SharedPilotResidentId[]) {
    return this.transaction(at => {
      const actor = this.browserOrAgent(session, at, profileResidents);
      const parsed = surveyWorksSiteSchema.safeParse(input);
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', '现场调研请求无效。');
      const { driver, requestId } = parsed.data;
      this.settle(at);
      const queued = this.db.prepare('SELECT * FROM shared_pilot_works_goals WHERE resident_id=? AND request_id=?')
        .get(actor, requestId) as WorksGoalRow | undefined;
      if (queued) {
        if (driver !== 'mcp') throw new SharedPilotError('CONFLICT', '该请求编号已用于其他城市行动。');
        return { acceptedAt: queued.created_at, arrivesAt: null };
      }
      const previous = this.findReceipt(actor, requestId);
      const receipt = (acceptedAt: number, arrivesAt: number) => ({ mode: 'DEMO' as const,
        provenance: SHARED_PILOT_PROVENANCE, action: 'surveyWorksSite' as const, residentId: actor, requestId, acceptedAt, arrivesAt });
      if (previous) {
        if (driver || !(JSON.parse(previous.route_json) as InspectionRoute).worksBrief) throw new SharedPilotError('CONFLICT', '该请求编号已用于其他城市行动。');
        return receipt(previous.started_at, previous.arrives_at);
      }
      if (this.readSocial().requests[actor][requestId] || this.readSurvey().requests[actor][requestId]) {
        throw new SharedPilotError('CONFLICT', '该请求编号已用于其他城市行动。');
      }
      this.ensureWorksAvailable(actor, at);
      if (this.activeInspections(at).some(visit => visit.residentId === actor)) {
        throw new SharedPilotError('BUSY', '请先完成现场巡查。');
      }
      const lastGoal = this.latestWorksGoal(actor);
      if (lastGoal?.closed_at === null) throw new SharedPilotError('BUSY', '居民已有建设中心调研目标。');
      if (driver === 'mcp') {
        const count = this.db.prepare('SELECT count(*) AS count FROM shared_pilot_works_goals WHERE resident_id=?').get(actor);
        if (Number(count?.count) >= MAX_MOVES_PER_RESIDENT) throw new SharedPilotError('LIMIT_REACHED', '此居民的调研记录已达上限。');
        this.db.prepare('INSERT INTO shared_pilot_works_goals (id,resident_id,request_id,created_at) VALUES (?,?,?,?)')
          .run(randomUUID(), actor, requestId, at);
        return { acceptedAt: at, arrivesAt: null };
      }
      const arrivesAt = this.beginMove(actor, requestId, 'works', at, { place: 'works' }, '前往公共建设中心调研',
        { worksBrief: { status: 'pending' } });
      this.settle(at);
      return receipt(at, arrivesAt);
    });
  }

  cancelWorksGoal(session: string, input: unknown, profileResidents: readonly SharedPilotResidentId[]) {
    return this.transaction(at => {
      const actor = this.browserOrAgent(session, at, profileResidents);
      const parsed = cancelWorksGoalSchema.safeParse(input);
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', '调研目标无效。');
      this.settle(at);
      const row = this.latestWorksGoal(actor);
      if (!row || `works-goal-${row.seq}` !== parsed.data.goalId) throw new SharedPilotError('NOT_FOUND', '没有这个调研目标。');
      const view = this.worksGoalState(row, at);
      if (view.stage === 'cancelled') return view;
      if (view.stage !== 'waiting' && view.stage !== 'deciding') {
        throw new SharedPilotError('BUSY', '请等当前行程或巡查结束。');
      }
      this.db.prepare('UPDATE shared_pilot_works_goals SET closed_at=? WHERE seq=?').run(at, row.seq);
      return this.worksGoalState({ ...row, closed_at: at }, at);
    });
  }

  actOnWorksGoal(token: string, input: unknown) {
    return this.transaction(at => {
      const actor = this.authenticate(token, at);
      const parsed = worksGoalActionSchema.safeParse(input);
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', '调研动作无效。');
      const command = parsed.data;
      this.settle(at);
      const row = this.db.prepare('SELECT * FROM shared_pilot_works_goals WHERE id=? AND resident_id=?')
        .get(command.taskId, actor) as WorksGoalRow | undefined;
      if (!row) throw new SharedPilotError('NOT_FOUND', '没有这个调研目标。');
      const view = this.worksGoalState(row, at);
      if (view.stage === 'cancelled') throw new SharedPilotError('CONFLICT', '这个调研目标已取消。');
      if (command.action === 'acceptWorksGoal') {
        if (row.arrival_seq !== null) return view;
        this.ensureWorksAvailable(actor, at);
        if (this.activeInspections(at).some(visit => visit.residentId === actor)) throw new SharedPilotError('BUSY', '请先完成现场巡查。');
        const routeId = randomUUID();
        const count = this.db.prepare('SELECT count(*) AS count FROM shared_pilot_moves WHERE resident_id=?').get(actor);
        if (Number(count?.count) >= MAX_MOVES_PER_RESIDENT - 1) throw new SharedPilotError('LIMIT_REACHED', '行程记录已接近上限。');
        this.beginMove(actor, routeId, 'works', at, { place: 'works' }, '前往公共建设中心调研');
        const arrival = this.findReceipt(actor, routeId)!.seq;
        this.db.prepare('UPDATE shared_pilot_works_goals SET arrival_seq=? WHERE seq=?').run(arrival, row.seq);
        this.settle(at);
        return this.worksGoalState({ ...row, arrival_seq: arrival }, at);
      }
      if (command.action === 'askWorksGoal' && row.asked_at !== null) return view;
      if (command.action === 'inspectWorksGoal' && view.visit) {
        if (view.visit.checkId === command.checkId) return view;
        throw new SharedPilotError('CONFLICT', '本次调研已选定另一个点位。');
      }
      if (view.stage !== 'deciding') throw new SharedPilotError('BUSY', '接手任务并抵达公共建设中心后才能巡查。');
      const occupied = this.activeInspections(at).map(visit => visit.checkId);
      if (command.action === 'askWorksGoal') {
        const reply = worksReply('当前还有哪些可巡查点？', occupied, false).text;
        this.db.prepare('UPDATE shared_pilot_works_goals SET asked_at=?,manager_reply=? WHERE seq=?').run(at, reply, row.seq);
        return { ...view, managerReply: reply };
      }
      if (occupied.includes(command.checkId)) throw new SharedPilotError('BUSY', '这个点位已经被占用，请重新查看现场。');
      const routeId = randomUUID();
      this.beginWorksInspection(actor, routeId, at, command.checkId, 'site-brief');
      const inspection = this.findReceipt(actor, routeId)!.seq;
      this.db.prepare('UPDATE shared_pilot_works_goals SET inspection_seq=?,other_point_occupied=? WHERE seq=?')
        .run(inspection, Number(occupied.length > 0), row.seq);
      this.settle(at);
      return this.worksGoalState({ ...row, inspection_seq: inspection, other_point_occupied: Number(occupied.length > 0) }, at);
    });
  }

  orderCoffee(credential: string, input: unknown, profileResidents?: readonly SharedPilotResidentId[]) {
    return this.transaction((at) => {
      const actor = this.browserOrAgent(credential, at, profileResidents);
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
      if (this.fishing.active(at, actor)) throw new SharedPilotError('BUSY', '请先结束北岸钓鱼。');
      if (this.activeInspections(at).some(visit => visit.residentId === actor)) throw new SharedPilotError('BUSY', '请先完成现场巡查。');
      if (this.claimedWorksGoal(actor)) throw new SharedPilotError('BUSY', '请先完成建设中心调研。');
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

  requestInspection(credential: string, input: unknown, profileResidents?: readonly SharedPilotResidentId[]) {
    return this.transaction((at) => {
      const actor = this.browserOrAgent(credential, at, profileResidents);
      const parsed = inspectWorksSchema.safeParse(input);
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', '请选择一个可用的巡查点。');
      const { requestId, checkId } = parsed.data;
      this.settle(at);
      const previous = this.findReceipt(actor, requestId);
      const report = (acceptedAt: number, arrivesAt: number, durationMs: number) => ({
        mode: 'DEMO' as const, provenance: SHARED_PILOT_PROVENANCE, action: 'inspectWorks' as const,
        residentId: actor, requestId, checkId, acceptedAt, arrivesAt, reportAt: arrivesAt + durationMs,
      });
      if (previous) {
        const inspection = (JSON.parse(previous.route_json) as InspectionRoute).worksInspection;
        if (inspection?.checkId !== checkId) throw new SharedPilotError('CONFLICT', '该请求编号已用于其他城市行动。');
        return report(previous.started_at, previous.arrives_at, inspection.durationMs);
      }
      const social = this.readSocial();
      const survey = this.readSurvey();
      if (social.requests[actor][requestId] || survey.requests[actor][requestId]) throw new SharedPilotError('CONFLICT', '该请求编号已用于其他城市行动。');
      this.ensureWorksAvailable(actor, at);
      if (this.claimedWorksGoal(actor)) throw new SharedPilotError('BUSY', '请从已接手的调研目标选择点位。');
      if (this.activeInspections(at).some(visit => visit.residentId === actor || visit.checkId === checkId)) {
        throw new SharedPilotError('BUSY', '居民已有巡查任务，或该点位已安排给另一位居民。');
      }
      const durationMs = SURVEY_OBSERVATION_MS;
      const arrivesAt = this.beginWorksInspection(actor, requestId, at, checkId);
      this.settle(at);
      return report(at, arrivesAt, durationMs);
    });
  }

  goFishing(credential: string, input: unknown, profileResidents?: readonly SharedPilotResidentId[]) {
    return this.transaction(at => {
      const actor = this.browserOrAgent(credential, at, profileResidents);
      const parsed = goFishingSchema.safeParse(input);
      if (!parsed.success) throw new SharedPilotError('INVALID_REQUEST', '北岸钓鱼请求无效。');
      const { requestId } = parsed.data;
      this.settle(at);
      const previous = this.fishing.find(actor, requestId);
      if (previous) return this.fishing.receipt(previous);
      const social = this.readSocial();
      const survey = this.readSurvey();
      if (this.findReceipt(actor, requestId) || social.requests[actor][requestId] || survey.requests[actor][requestId]) {
        throw new SharedPilotError('CONFLICT', '该请求编号已用于其他城市行动。');
      }
      if (this.fishing.active(at, actor) || this.coffee.active(actor, at)
        || this.activeInspections(at).some(visit => visit.residentId === actor) || this.claimedWorksGoal(actor)
        || meetingActive(social.meeting) || surveyActive(survey.task)) {
        throw new SharedPilotError('BUSY', '居民已有安排，请完成当前活动后再去钓鱼。');
      }
      const [x, , z] = FISHING_WAIT[actor];
      this.beginMove(actor, requestId, 'pier', at, { x, z }, '前往北岸码头钓鱼');
      this.fishing.insert(this.findReceipt(actor, requestId)!.seq, fishingOutcome(at, actor));
      this.settle(at);
      return this.fishing.receipt(this.fishing.find(actor, requestId)!);
    });
  }

  fishingTalk(question: string, token?: string) {
    return this.transaction(at => {
      const actor = token === undefined ? undefined : this.authenticate(token, at);
      this.settle(at);
      if (actor) {
        const resident = this.db.prepare('SELECT place FROM shared_pilot_residents WHERE id=?').get(actor);
        if (resident?.place !== 'pier' || this.lastMove(actor)?.completed_at === null) {
          throw new SharedPilotError('UNREACHABLE', '先到北岸码头，再问钓客。');
        }
      }
      return this.fishing.talk(question, at);
    });
  }

  worksTalk(question: string, token?: string) {
    return this.transaction((at) => {
      const actor = token === undefined ? undefined : this.authenticate(token, at);
      this.settle(at);
      if (actor) {
        const resident = this.db.prepare('SELECT place FROM shared_pilot_residents WHERE id=?').get(actor);
        if (resident?.place !== 'works' || this.lastMove(actor)?.completed_at === null) {
          throw new SharedPilotError('UNREACHABLE', '先到公共建设中心，再和现场管理员说话。');
        }
      }
      return worksReply(question, this.activeInspections(at).map(visit => visit.checkId), surveyActive(this.readSurvey().task));
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
      if (!social.requests[actor][parsed.data.requestId] && (this.pendingWorksBrief() || this.claimedWorksGoal() || this.activeInspections(at).length)) throw new SharedPilotError('BUSY', '有居民正在执行现场调研。');
      if (!social.requests[actor][parsed.data.requestId] && this.fishing.active(at)) throw new SharedPilotError('BUSY', '有居民正在北岸钓鱼。');
      if (!social.requests[actor][parsed.data.requestId] && this.benchRows().some(row => benchRest(row, at).stage !== 'completed')) {
        throw new SharedPilotError('BUSY', '有居民正在使用咖啡街长椅。');
      }
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
      if (!survey.requests[actor][parsed.data.requestId] && (this.pendingWorksBrief() || this.claimedWorksGoal() || this.activeInspections(at).length)) throw new SharedPilotError('BUSY', '有居民正在执行现场调研。');
      if (!survey.requests[actor][parsed.data.requestId] && this.fishing.active(at)) throw new SharedPilotError('BUSY', '有居民正在北岸钓鱼。');
      if (!survey.requests[actor][parsed.data.requestId] && this.benchRows().some(row => benchRest(row, at).stage !== 'completed')) {
        throw new SharedPilotError('BUSY', '有居民正在使用咖啡街长椅。');
      }
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
      const fishing = this.fishing.view(at);
      const bench = benchProjection(this.benchRows().reverse(), at);
      const council = councilProjection(this.councilRows().reverse(), at);
      const social = this.readSocial();
      const survey = this.readSurvey();
      const theatre = sharedTheatreView(observeTheatre(social.theatre, this.theatreContext(at, social, survey), at, SHARED_THEATRE_RULES));
      const inspections = this.db.prepare(`SELECT * FROM shared_pilot_moves
        WHERE destination='works' AND json_extract(route_json, '$.worksInspection') IS NOT NULL
        ORDER BY seq DESC LIMIT 16`).all() as unknown as MovementRow[];
      const briefLookup = this.db.prepare(`SELECT * FROM shared_pilot_moves WHERE resident_id=? AND destination='works'
        AND json_extract(route_json,'$.worksBrief') IS NOT NULL ORDER BY seq DESC LIMIT 1`);
      const goals = rows.flatMap(({ id }) => {
        const row = this.latestWorksGoal(id);
        return row ? [{ row, view: this.worksGoalState(row, at) }] : [];
      });
      const briefs = rows.flatMap(({ id }) => {
        const row = briefLookup.get(id) as unknown as MovementRow | undefined;
        const goal = goals.find(({ row }) => row.resident_id === id);
        if (goal && (!row || goal.view.acceptedAt >= row.started_at)) return [goal.view];
        if (!row) return [];
        const brief = (JSON.parse(row.route_json) as InspectionRoute).worksBrief!;
        const inspection = brief.status === 'assigned' ? this.movementBySeq(brief.inspectionSeq) : undefined;
        return [worksBriefView(row, inspection, at)];
      });
      const residents = rows.map(({ id, place }) => {
        const movement = latest.get(id) as unknown as MovementRow | undefined;
        const order = latestResidentActivity(cafe.orders, id);
        const atCounter = order && cafePose(order, at);
        const visit = latestResidentActivity(fishing.visits, id);
        const atDock = visit && fishingPose(visit, at);
        return {
          residentId: id, place, position: theatre.residents[id].status === 'seated' && theatre.residents[id].position ? theatre.residents[id].position
            : bench.visits.some(visit => visit.residentId === id && visit.stage === 'resting') ? BENCH_SEAT
            : atDock?.point ?? atCounter?.point ?? (movement ? positionOnWalk(toWalk(movement), at) : point(place)),
          movement: movement ? publicMovement(movement) : null,
        };
      });
      const events = (this.db.prepare(`SELECT e.seq, m.resident_id, m.destination, e.kind, e.happened_at
        FROM shared_pilot_events e JOIN shared_pilot_moves m ON m.seq=e.movement_seq ORDER BY e.seq DESC LIMIT ?`)
        .all(PUBLIC_EVENT_LIMIT) as unknown as MovementEventRow[]).reverse().map((event) => ({
          id: String(event.seq), residentId: event.resident_id, place: event.destination, kind: event.kind, happenedAt: event.happened_at,
          provenance: SHARED_PILOT_PROVENANCE,
        }));
      const personalGoal = goals.find(({ row }) => row.resident_id === viewerResidentId && row.closed_at === null);
      const available = personalGoal?.view.stage === 'deciding' ? this.activeInspections(at).map(visit => visit.checkId) : [];
      const pendingWorksGoal = personalGoal ? { taskId: personalGoal.row.id, goal: '调研公共建设中心',
        stage: personalGoal.view.stage, managerReply: personalGoal.view.managerReply,
        openCheckIds: personalGoal.view.stage === 'deciding' ? (Object.keys(WORKS_CHECKS) as WorksCheck[]).filter(id => !available.includes(id)) : [],
        availableActions: personalGoal.view.stage === 'waiting' ? ['acceptWorksGoal']
          : personalGoal.view.stage === 'deciding' ? [...(personalGoal.view.managerReply ? [] : ['askWorksGoal']), 'inspectWorksGoal'] : [],
      } : null;
      const works = worksView(inspections.reverse(), at);
      const profiles = this.db.prepare('SELECT resident_id AS residentId, name, avatar FROM shared_pilot_profiles ORDER BY resident_id')
        .all() as unknown as SharedPilotProfile[];
      let firstExploration: FirstExplorationObservation | null = null;
      const self = residents.find(resident => resident.residentId === viewerResidentId)!;
      const recentRest = this.recentBenchRest(viewerResidentId, at);
      const restedRecently = Boolean(recentRest && at < recentRest.endedAt + BENCH_COOLDOWN_MS);
      const engaged = Boolean(pendingWorksGoal) || meetingActive(social.meeting) || surveyActive(survey.task)
        || [cafe.orders, fishing.visits, works.visits, bench.visits, council.visits].some(visits => visits.some(visit =>
          visit.residentId === viewerResidentId && visit.stage !== 'completed'));
      const waitingForSiteBrief = briefs.some(brief => brief.driver === 'rules' && (brief.stage === 'travelling' || brief.stage === 'deciding'));
      const busy = self.movement?.status === 'walking' || engaged || waitingForSiteBrief;
      const local = nearbyAt(self.position, !busy && !bench.occupied && !restedRecently,
        bench.occupied ? '已有居民在使用' : restedRecently ? '刚在这里休息过' : busy ? '先完成当前活动' : undefined);
      const peer = residents.find(resident => resident.residentId !== viewerResidentId)!;
      const peerDistance = localDistance(self.position, peer.position);
      const nearby = peerDistance > 22 ? local : [...local, {
        id: `resident.${peer.residentId}`, kind: 'resident' as const, metres: Math.round(peerDistance),
        name: profiles.find(profile => profile.residentId === peer.residentId)?.name ?? `${peer.residentId} 号居民`,
        activity: peer.movement?.status === 'walking' ? '正在路上' : '可以尝试邀请会面',
      }];
      const firstTrip = social.firstExplorations?.[viewerResidentId];
      if (profiles.some(profile => profile.residentId === viewerResidentId) && !engaged) {
        const sites = explorationScenes({ cafe, fishing, freeWorksChecks: 2 - works.visits.filter(visit => visit.stage !== 'completed').length });
        if (!firstTrip && self.movement?.status !== 'walking') {
          firstExploration = { phase: 'intro', place: self.place, destinations: sites.filter(site => site.place !== self.place) };
        } else if (firstTrip && this.lastMove(viewerResidentId)?.request_id === firstTrip.trip.requestId) {
          const place = firstTrip.trip.place;
          if (self.movement?.status === 'walking') firstExploration = { phase: 'travelling', place };
          else if (self.place === place) {
            const site = sites.find(site => site.place === place)!;
            firstExploration = firstTrip.result
              ? { phase: 'followUp', place, site, exchange: { text: firstTrip.result.action.text, reply: firstTrip.result.reply } }
              : { phase: 'onSite', place, site };
          }
        }
      }
      return {
        mode: 'DEMO' as const, provenance: SHARED_PILOT_PROVENANCE, viewerResidentId, serverTime: at, profiles,
        revision: events.at(-1)?.id ?? '0', residents, events,
        cafe,
        fishing,
        bench,
        council,
        theatre,
        nearby,
        recentRest,
        works: { ...works, briefs, events: [...works.events, ...goals.flatMap(({ row, view }) => worksGoalEvents(row, view))]
          .sort((a, b) => a.happenedAt - b.happenedAt) },
        pendingWorksGoal,
        firstExploration,
        playerNotes: (social.playerNotes?.[viewerResidentId] ?? []).map(note => playerNoteView(note, at)),
        exploration: explorationView(social.firstExplorations),
        social: publicSocial(social, this.socialResidents(at)),
        survey: publicSurvey(survey, this.socialResidents(at), social.meeting),
        privateSocial: { memories: social.memories[viewerResidentId], encounters: social.encounters[viewerResidentId] },
      };
    });
  }

  close() { this.db.close(); }
}
