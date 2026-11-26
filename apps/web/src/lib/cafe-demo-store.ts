import type { DatabaseSync } from 'node:sqlite';
import { advanceCafe, beginCafe, suggestCafe, type CafeEncounter, type CafeRun, type CafeShiftKind } from './cafe-life';
import { writeNewspaper, type NewspaperIssue, type NewspaperSnapshot } from './cafe-newspaper';
import { buildCafePostcard } from './cafe-postcard';
import type { CafeSnapshot } from './cafe-life';

type Response = Omit<CafeSnapshot, 'run'> & { run: CafeRun };
type Row = { state: string };
export const CAFE_RETENTION_DAYS = 30;

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

  start(id: string, busy: boolean, resident: string, kind: CafeShiftKind = 'cafe'): Response | { error: string } {
    const at = this.clock();
    const result = this.transaction(() => {
      this.db.prepare('DELETE FROM shifts WHERE started < ?').run(at - CAFE_RETENTION_DAYS * 86400000);
      const owner = this.db.prepare('SELECT resident FROM shifts WHERE id=?').get(id);
      if (owner) {
        if (owner.resident !== resident) return { error: '开班编号已使用，请刷新后重试。' };
        if (this.latestId(resident) !== id) return { error: '该请求属于上一个班次。' };
        const existing = this.current(id, at)!;
        const originallyBusy = existing.friendBusyUntil > existing.events[0]!.at;
        if (originallyBusy !== busy || Boolean(existing.observer) !== (kind === 'observer')) return { error: '开班编号已用于另一种班次。' };
        return { run: existing, serverTime: at };
      }
      const latestId = this.latestId(resident);
      if (latestId && this.current(latestId, at)?.phase !== 'done') return { error: '已有进行中的班次。' };
      const memory = this.db.prepare(`
        SELECT json_extract(state, '$.meeting') AS outcome, started AS shiftStartedAt
        FROM shifts WHERE resident=? AND json_extract(state, '$.meeting') IN ('declined', 'chatted')
        ORDER BY started DESC LIMIT 1
      `).get(resident) as CafeEncounter | undefined;
      const initial = beginCafe(at, 'social', busy, memory, kind);
      this.db.prepare('INSERT INTO shifts(id,state,next_at,started,resident) VALUES (?,?,?,?,?)').run(id, JSON.stringify(initial), initial.until, at, resident);
      return { run: initial, serverTime: at };
    });
    this.arm();
    return result;
  }

  read(resident: string, migrateLegacy = false, seenAt?: number): Response | null {
    const serverTime = this.clock();
    return this.transaction(() => {
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

  newspaper(resident: string, issueId?: string): NewspaperSnapshot | null {
    const serverTime = this.clock();
    const cutoff = serverTime - CAFE_RETENTION_DAYS * 86400000;
    return this.transaction(() => {
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

  note(resident: string, shiftStartedAt: number, request: string, suggestion: string): Response | null {
    const serverTime = this.clock();
    return this.transaction(() => {
      const id = this.latestId(resident);
      if (!id) return null;
      const run = this.current(id, serverTime)!;
      if (run.events[0]?.at !== shiftStartedAt) {
        return { run, serverTime, accepted: false, feedback: '已进入另一个班次，请为当前班次重新递纸条。' };
      }
      const saved = this.db.prepare('SELECT suggestion,reply FROM notes WHERE shift=? AND id=?').get(id, request);
      if (saved && saved.suggestion !== suggestion) return { run, serverTime, accepted: false, feedback: '纸条编号已用于另一项建议。' };
      const reply: ReturnType<typeof suggestCafe> = saved ? JSON.parse(String(saved.reply)) : suggestCafe(run, suggestion);
      if (!saved) {
        this.db.prepare('INSERT INTO notes VALUES (?,?,?,?)').run(id, request, suggestion, JSON.stringify(reply));
        if (reply.accepted) this.save(id, run);
      }
      return { run, serverTime, accepted: reply.accepted, feedback: reply.reason };
    });
  }

  close() { clearTimeout(this.timer); this.db.close(); }
}
