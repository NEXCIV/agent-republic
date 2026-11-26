import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { advanceCafe, beginCafe, CAFE_INITIAL_ENERGY, observeExternalChoice, suggestCafe, type CafeEncounter, type CafeRun, type CafeShiftKind } from './cafe-life';
import type { ObserverDriver } from './cafe-observer';
import { writeNewspaper, type NewspaperIssue, type NewspaperSnapshot } from './cafe-newspaper';
import { buildCafePostcard } from './cafe-postcard';
import type { CafeSnapshot } from './cafe-life';
import { CITY_MAP, cityRestingPoint, planCityWalk } from './city-navigation';
import { CAFE_COUNTER } from './cafe-geometry';
import { positionOnWalk, routeDistance, type CityDestination, type CityMovement, type CityObservation, type CityWalk } from './city-movement';
import { availableCityActions, beginCityActivity, cityActivityView, nearbyCitySite, type CityActivity, type CityActivityView } from './city-activities';

type Response = Omit<CafeSnapshot, 'run'> & { run: CafeRun };
type Row = { state: string };
export type CafeActor = string | { mcpToken: string };
export class InvalidCafeMcpConnection extends Error {}
export const CAFE_RETENTION_DAYS = 30;
const PAIR_CODE_LIFETIME = 5 * 60 * 1000;
const MCP_CONNECTION_LIFETIME = 24 * 60 * 60 * 1000;
const CITY_WALK_METRES_PER_SECOND = 4;
const hashCredential = (value: string) => createHash('sha256').update(value).digest('hex');

export class CafeDemoStore {
  private readonly db: DatabaseSync;
  private timer?: NodeJS.Timeout;

  constructor(file: string, private readonly clock = Date.now, private readonly schedule = true) {
    const sqlite = process.getBuiltinModule?.('node:sqlite') as typeof import('node:sqlite') | undefined;
    if (!sqlite) throw new Error('The local café demo needs Node.js 22.13+ with node:sqlite');
    this.db = new sqlite.DatabaseSync(file);
    this.db.exec(`
      PRAGMA busy_timeout = 3000;
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS shifts (
        id TEXT PRIMARY KEY, state TEXT NOT NULL, next_at INTEGER, started INTEGER NOT NULL, resident TEXT
      );
      CREATE INDEX IF NOT EXISTS cafe_due ON shifts(next_at);
      CREATE TABLE IF NOT EXISTS notes (
        shift TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE, id TEXT NOT NULL,
        suggestion TEXT NOT NULL, reply TEXT NOT NULL, PRIMARY KEY(shift,id)
      );
      CREATE TABLE IF NOT EXISTS newspaper_issues (
        shift TEXT PRIMARY KEY REFERENCES shifts(id) ON DELETE CASCADE,
        issue TEXT NOT NULL,
        published INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cafe_mcp_connections (
        resident TEXT PRIMARY KEY NOT NULL,
        code_hash TEXT UNIQUE,
        code_expires INTEGER,
        token_hash TEXT UNIQUE,
        token_expires INTEGER
      );
      CREATE TABLE IF NOT EXISTS city_walks (
        resident TEXT NOT NULL,
        id TEXT NOT NULL,
        started INTEGER NOT NULL,
        walk TEXT NOT NULL,
        shown INTEGER NOT NULL,
        PRIMARY KEY (resident,id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS city_current_walk ON city_walks(resident) WHERE shown=1;
      CREATE TABLE IF NOT EXISTS city_activities (
        resident TEXT NOT NULL,
        id TEXT NOT NULL,
        started INTEGER NOT NULL,
        ends INTEGER NOT NULL,
        activity TEXT NOT NULL,
        PRIMARY KEY (resident,id)
      );
      CREATE INDEX IF NOT EXISTS city_activity_history ON city_activities(resident,started DESC);
    `);
    this.transaction(() => {
      if (!this.db.prepare('PRAGMA table_info(shifts)').all().some((column) => column.name === 'resident')) {
        this.db.exec('ALTER TABLE shifts ADD COLUMN resident TEXT');
      }
      this.db.exec('CREATE INDEX IF NOT EXISTS cafe_resident_shifts ON shifts(resident, started DESC)');
    });
    this.arm();
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private save(id: string, run: CafeRun) {
    this.db.prepare('UPDATE shifts SET state=?, next_at=? WHERE id=?').run(JSON.stringify(run), run.until, id);
  }

  private publishIssue(shiftId: string, run: CafeRun) {
    const issue = writeNewspaper(shiftId, run);
    if (!issue) return;
    this.db.prepare('INSERT INTO newspaper_issues(shift,issue,published) VALUES (?,?,?) ON CONFLICT(shift) DO NOTHING')
      .run(shiftId, JSON.stringify(issue), issue.publishedAt);
  }

  private current(id: string, at: number): CafeRun | null {
    const row = this.db.prepare('SELECT state FROM shifts WHERE id=?').get(id) as Row | undefined;
    if (!row) return null;
    const run: CafeRun = JSON.parse(row.state);
    if (run.until !== null && run.until <= at) {
      advanceCafe(run, at);
      this.save(id, run);
      this.publishIssue(id, run);
    }
    return run;
  }

  private arm(minimumDelay = 25) {
    if (!this.schedule) return;
    clearTimeout(this.timer);
    const next = this.db.prepare('SELECT min(next_at) AS due FROM shifts').get()?.due;
    if (typeof next !== 'number') return;
    this.timer = setTimeout(() => {
      try {
        const at = this.clock();
        this.transaction(() => {
          for (const row of this.db.prepare('SELECT id FROM shifts WHERE next_at<=?').all(at)) {
            this.current(String(row.id), at);
          }
        });
      } catch (error) {
        console.error('Café deadline processing failed', error);
        this.arm(3000);
        return;
      }
      this.arm();
    }, Math.max(minimumDelay, next - this.clock()));
    this.timer.unref();
  }

  private latestId(resident: string): string | undefined {
    const row = this.db.prepare('SELECT id FROM shifts WHERE resident=? ORDER BY started DESC LIMIT 1').get(resident);
    return typeof row?.id === 'string' ? row.id : undefined;
  }

  mcpStatus(resident: string) {
    const at = this.clock();
    const row = this.db.prepare('SELECT code_expires,token_expires FROM cafe_mcp_connections WHERE resident=?').get(resident);
    const expiresAt = typeof row?.token_expires === 'number' && row.token_expires > at ? row.token_expires : null;
    const codeExpiresAt = typeof row?.code_expires === 'number' && row.code_expires > at ? row.code_expires : null;
    return { connected: expiresAt !== null, expiresAt, codeExpiresAt };
  }

  issueMcpCode(resident: string) {
    const at = this.clock();
    const code = randomBytes(18).toString('base64url');
    const codeExpiresAt = at + PAIR_CODE_LIFETIME;
    this.transaction(() => {
      this.db.prepare('DELETE FROM cafe_mcp_connections WHERE COALESCE(code_expires,0)<=? AND COALESCE(token_expires,0)<=?')
        .run(at, at);
      this.db.prepare(`
        INSERT INTO cafe_mcp_connections(resident,code_hash,code_expires) VALUES (?,?,?)
        ON CONFLICT(resident) DO UPDATE SET code_hash=excluded.code_hash, code_expires=excluded.code_expires
      `).run(resident, hashCredential(code), codeExpiresAt);
    });
    return { code, codeExpiresAt };
  }

  redeemMcpCode(code: string) {
    const at = this.clock();
    const token = `nxc_mcp_${randomBytes(32).toString('base64url')}`;
    const expiresAt = at + MCP_CONNECTION_LIFETIME;
    const result = this.db.prepare(`
      UPDATE cafe_mcp_connections
      SET token_hash=?, token_expires=?, code_hash=NULL, code_expires=NULL
      WHERE code_hash=? AND code_expires>?
    `).run(hashCredential(token), expiresAt, hashCredential(code), at);
    return result.changes === 1 ? { token, expiresAt } : null;
  }

  disconnectMcp(resident: string) {
    this.db.prepare('DELETE FROM cafe_mcp_connections WHERE resident=?').run(resident);
    return { connected: false, expiresAt: null, codeExpiresAt: null };
  }

  private authorizedResident(actor: CafeActor) {
    if (typeof actor === 'string') return actor;
    const row = this.db.prepare('SELECT resident FROM cafe_mcp_connections WHERE token_hash=? AND token_expires>?')
      .get(hashCredential(actor.mcpToken), this.clock());
    if (typeof row?.resident !== 'string') throw new InvalidCafeMcpConnection();
    return row.resident;
  }

  private activeRun(resident: string, at: number) {
    const id = this.latestId(resident);
    return id ? this.current(id, at) : null;
  }

  private currentWalk(resident: string): CityWalk | null {
    const row = this.db.prepare('SELECT walk FROM city_walks WHERE resident=? AND shown=1').get(resident);
    return row ? JSON.parse(String(row.walk)) : null;
  }

  private movement(walk: CityWalk, at: number): CityMovement {
    return { ...walk, status: at < walk.arrivesAt ? 'walking' : 'arrived' };
  }

  private cityActivityHistory(resident: string): CityActivity[] {
    return this.db.prepare('SELECT activity FROM city_activities WHERE resident=? ORDER BY started DESC, rowid DESC LIMIT 6')
      .all(resident).map(({ activity }) => JSON.parse(String(activity)));
  }

  private activityInProgress(resident: string, at: number) {
    return Boolean(this.db.prepare('SELECT 1 FROM city_activities WHERE resident=? AND ends>? LIMIT 1').get(resident, at));
  }

  private energyFromActivities(history: CityActivity[], run: CafeRun | null, at: number) {
    return history.find((activity) => activity.endsAt <= at && (!run || activity.endsAt >= run.since))?.energyAfter;
  }

  cityMap(actor: CafeActor) {
    this.authorizedResident(actor);
    return CITY_MAP;
  }

  cityObservation(actor: CafeActor): CityObservation {
    return this.transaction(() => {
      const resident = this.authorizedResident(actor);
      const serverTime = this.clock();
      const run = this.activeRun(resident, serverTime);
      const activeShift = run !== null && run.phase !== 'done';
      const history = this.cityActivityHistory(resident);
      const activeActivity = history[0] && history[0].endsAt > serverTime ? history[0] : null;
      const walk = activeActivity?.walk ?? this.currentWalk(resident);
      const movement = walk ? this.movement(walk, serverTime) : null;
      const reason = activeShift ? '已有进行中的班次。' : activeActivity ? `进行中 · ${activeActivity.label}`
        : movement?.status === 'walking' ? '01 号正在赶路。' : undefined;
      const position = walk ? positionOnWalk(walk, serverTime)
        : activeShift ? null : cityRestingPoint(run?.place, Boolean(run?.observer));
      const energy = this.energyFromActivities(history, run, serverTime) ?? run?.energy ?? CAFE_INITIAL_ENERGY;
      const nearby = nearbyCitySite(position);
      return {
        agentId: '01', serverTime, position, movement, canMove: !reason, reason, energy,
        nearby: nearby?.site ?? null,
        availableActions: reason || !nearby ? [] : availableCityActions(nearby.actions, energy),
        recentActivities: history.map((activity) => cityActivityView(activity, serverTime)),
      };
    });
  }

  interactCity(actor: CafeActor, requestId: string, actionId: string): CityActivityView | { error: string; code: 409 | 422 } {
    return this.transaction(() => {
      const resident = this.authorizedResident(actor);
      const at = this.clock();
      const row = this.db.prepare('SELECT activity FROM city_activities WHERE resident=? AND id=?').get(resident, requestId);
      if (row) {
        const activity: CityActivity = JSON.parse(String(row.activity));
        return activity.actionId === actionId ? cityActivityView(activity, at)
          : { error: '请求编号已用于另一项现场行动。', code: 409 };
      }
      if (this.db.prepare('SELECT 1 FROM city_walks WHERE resident=? AND id=?').get(resident, requestId)) {
        return { error: '请求编号已用于一次试走。', code: 409 };
      }
      const run = this.activeRun(resident, at);
      const walk = this.currentWalk(resident);
      if ((run && run.phase !== 'done') || (walk && walk.arrivesAt > at) || this.activityInProgress(resident, at)) {
        return { error: '请等当前行程或活动结束，再选择现场行动。', code: 409 };
      }
      const position = walk?.points.at(-1) ?? cityRestingPoint(run?.place, Boolean(run?.observer));
      const nearby = nearbyCitySite(position);
      const action = nearby?.actions.find(({ id }) => id === actionId);
      if (!action || !nearby) return { error: '当前位置没有这项交互，请先查看附近可做的事。', code: 422 };
      const history = this.cityActivityHistory(resident);
      const energy = this.energyFromActivities(history, run, at) ?? run?.energy ?? CAFE_INITIAL_ENERGY;
      if (!availableCityActions([action], energy).length) return { error: '精力不足，请先休息。', code: 409 };
      const activity = beginCityActivity(action, nearby.site.place, position, energy, requestId, at);
      if (!activity) return { error: '巡查点位目前无法沿步道到达。', code: 422 };
      this.db.prepare('INSERT INTO city_activities(resident,id,started,ends,activity) VALUES (?,?,?,?,?)')
        .run(resident, requestId, at, activity.endsAt, JSON.stringify(activity));
      this.db.prepare('DELETE FROM city_activities WHERE resident=? AND ends<?')
        .run(resident, at - CAFE_RETENTION_DAYS * 86400000);
      return cityActivityView(activity, at);
    });
  }

  moveTo(actor: CafeActor, requestId: string, destination: CityDestination): CityMovement | { error: string; code: 409 | 422 } {
    return this.transaction(() => {
      const resident = this.authorizedResident(actor);
      const at = this.clock();
      const row = this.db.prepare('SELECT walk FROM city_walks WHERE resident=? AND id=?').get(resident, requestId);
      if (row) {
        const saved: CityWalk = JSON.parse(String(row.walk));
        if (JSON.stringify(saved.destination) !== JSON.stringify(destination)) {
          return { error: '请求编号已用于另一个目的地。', code: 409 };
        }
        return this.movement(saved, at);
      }
      if (this.db.prepare('SELECT 1 FROM city_activities WHERE resident=? AND id=?').get(resident, requestId)) {
        return { error: '请求编号已用于一项现场行动。', code: 409 };
      }
      if (this.activityInProgress(resident, at)) return { error: '01 号正在执行现场活动，结束后可以继续出发。', code: 409 };
      const run = this.activeRun(resident, at);
      if (run && run.phase !== 'done') return { error: '班次正在执行，请结束后再自由移动。', code: 409 };
      const previous = this.currentWalk(resident);
      if (previous && previous.arrivesAt > at) return { error: '01 号正在赶路，到达后可继续出发。', code: 409 };
      const origin = previous?.points.at(-1) ?? cityRestingPoint(run?.place, Boolean(run?.observer));
      const route = planCityWalk(origin, destination);
      if (!route) return { error: '目的地不在已测绘的步道上。请使用地图中的地点或步道坐标。', code: 422 };
      const duration = route.metres < 1e-7 ? 0 : Math.max(1000, Math.ceil(1000 * route.metres / CITY_WALK_METRES_PER_SECOND));
      const walk: CityWalk = { ...route, requestId, startedAt: at, arrivesAt: at + duration };
      this.db.prepare('UPDATE city_walks SET shown=0 WHERE resident=? AND shown=1').run(resident);
      this.db.prepare('DELETE FROM city_walks WHERE shown=0 AND started<?').run(at - CAFE_RETENTION_DAYS * 86400000);
      this.db.prepare('INSERT INTO city_walks VALUES (?,?,?,?,1)').run(resident, requestId, at, JSON.stringify(walk));
      return this.movement(walk, at);
    });
  }

  start(id: string, busy: boolean, actor: CafeActor, kind: CafeShiftKind = 'cafe', driver: ObserverDriver = 'rules'): Response | { error: string } {
    const at = this.clock();
    const result = this.transaction(() => {
      const resident = this.authorizedResident(actor);
      this.db.prepare('DELETE FROM shifts WHERE started < ?').run(at - CAFE_RETENTION_DAYS * 86400000);
      const owner = this.db.prepare('SELECT resident FROM shifts WHERE id=?').get(id);
      if (owner) {
        if (owner.resident !== resident) return { error: '开班编号已使用，请刷新后重试。' };
        if (this.latestId(resident) !== id) return { error: '该请求属于上一个班次。' };
        const existing = this.current(id, at)!;
        const originallyBusy = existing.friendBusyUntil > existing.events[0]!.at;
        if (originallyBusy !== busy || Boolean(existing.observer) !== (kind === 'observer') || (existing.observer?.driver ?? 'rules') !== driver) return { error: '开班编号已用于另一种班次。' };
        return { run: existing, serverTime: at };
      }
      const run = this.activeRun(resident, at);
      if (run && run.phase !== 'done') return { error: '已有进行中的班次。' };
      if (this.activityInProgress(resident, at)) return { error: '01 号正在执行现场活动。' };
      const walk = this.currentWalk(resident);
      if (walk && (walk.arrivesAt > at || routeDistance(walk.points.at(-1)!, CAFE_COUNTER) > 1e-5)) {
        return { error: '请先让 01 号走回咖啡摊，再开始班次。' };
      }
      if (walk) this.db.prepare('UPDATE city_walks SET shown=0 WHERE resident=? AND shown=1').run(resident);
      const memory = this.db.prepare(`
        SELECT json_extract(state, '$.meeting') AS outcome, started AS shiftStartedAt
        FROM shifts WHERE resident=? AND json_extract(state, '$.meeting') IN ('declined', 'chatted')
        ORDER BY started DESC LIMIT 1
      `).get(resident) as CafeEncounter | undefined;
      const energy = this.energyFromActivities(this.cityActivityHistory(resident), run, at);
      const initial = beginCafe(at, 'social', busy, memory, kind, driver, energy);
      this.db.prepare('INSERT INTO shifts(id,state,next_at,started,resident) VALUES (?,?,?,?,?)').run(id, JSON.stringify(initial), initial.until, at, resident);
      return { run: initial, serverTime: at };
    });
    this.arm();
    return result;
  }

  observeExternal(actor: CafeActor) {
    const snapshot = this.read(actor);
    return snapshot ? observeExternalChoice(snapshot.run, snapshot.serverTime) : null;
  }

  read(actor: CafeActor, migrateLegacy = false, seenAt?: number): Response | null {
    const serverTime = this.clock();
    return this.transaction(() => {
      const resident = this.authorizedResident(actor);
      if (migrateLegacy) {
        this.db.prepare('UPDATE shifts SET resident=? WHERE id=? AND resident IS NULL').run(resident, resident);
      }
      const id = this.latestId(resident);
      if (!id) return null;
      const run = this.current(id, serverTime);
      if (!run) return null;
      if (seenAt === undefined || !Number.isSafeInteger(seenAt) || seenAt >= serverTime
        || seenAt < serverTime - CAFE_RETENTION_DAYS * 86400000) return { run, serverTime };
      const row = run.observer && run.phase === 'done'
        ? this.db.prepare('SELECT issue FROM newspaper_issues WHERE shift=?').get(id) : undefined;
      const issue = typeof row?.issue === 'string' ? JSON.parse(row.issue) as NewspaperIssue : undefined;
      return { run, serverTime, postcard: buildCafePostcard(run, seenAt, issue) };
    });
  }

  newspaper(actor: CafeActor, issueId?: string): NewspaperSnapshot | null {
    const serverTime = this.clock();
    const cutoff = serverTime - CAFE_RETENTION_DAYS * 86400000;
    return this.transaction(() => {
      const resident = this.authorizedResident(actor);
      const latest = this.latestId(resident);
      if (latest) this.current(latest, serverTime);

      // Preserve access for interviews completed before the newspaper feature shipped.
      const completed = this.db.prepare(`
        SELECT s.id,s.state FROM shifts s
        LEFT JOIN newspaper_issues n ON n.shift=s.id
        WHERE s.resident=? AND s.started>=? AND s.next_at IS NULL
          AND n.shift IS NULL AND json_type(s.state,'$.observer')='object'
      `).all(resident, cutoff);
      for (const row of completed) this.publishIssue(String(row.id), JSON.parse(String(row.state)));

      const editions = this.db.prepare(`
        SELECT n.issue FROM newspaper_issues n JOIN shifts s ON s.id=n.shift
        WHERE s.resident=? AND s.started>=? ORDER BY n.published DESC, s.started DESC
      `).all(resident, cutoff).map((row) => JSON.parse(String(row.issue)) as NewspaperIssue);
      const issues = editions.map(({ id, publishedAt, headline }) => ({ id, publishedAt, headline }));
      const issue = issueId ? editions.find(({ id }) => id === issueId) : editions[0];
      if (!issue) return issueId ? null : { issues, current: null };

      const run = this.current(issue.id, serverTime);
      const sources = issue.sourceIds.map((id) => run?.observer?.sources.find((source) => source.id === id));
      if (sources.some((source) => !source)) return null;
      return { issues, current: { issue, sources: sources.filter((source) => source !== undefined) } };
    });
  }

  note(actor: CafeActor, shiftStartedAt: number, request: string, suggestion: string): Response | null {
    const serverTime = this.clock();
    const result = this.transaction(() => {
      const resident = this.authorizedResident(actor);
      const id = this.latestId(resident);
      if (!id) return null;
      const run = this.current(id, serverTime)!;
      if (run.events[0]?.at !== shiftStartedAt) {
        return { run, serverTime, accepted: false, feedback: '已进入另一个班次，请为当前班次重新递纸条。' };
      }
      const saved = this.db.prepare('SELECT suggestion,reply FROM notes WHERE shift=? AND id=?').get(id, request);
      if (saved && saved.suggestion !== suggestion) return { run, serverTime, accepted: false, feedback: '纸条编号已用于另一项建议。' };
      const reply: ReturnType<typeof suggestCafe> = saved ? JSON.parse(String(saved.reply)) : suggestCafe(run, suggestion, serverTime);
      if (!saved) {
        this.db.prepare('INSERT INTO notes VALUES (?,?,?,?)').run(id, request, suggestion, JSON.stringify(reply));
        if (reply.accepted) this.save(id, run);
      }
      return { run, serverTime, accepted: reply.accepted, feedback: reply.reason };
    });
    if (result?.accepted) this.arm();
    return result;
  }

  close() { clearTimeout(this.timer); this.db.close(); }
}
