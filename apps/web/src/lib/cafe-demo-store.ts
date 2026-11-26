import type { DatabaseSync } from 'node:sqlite';
import { advanceCafe, beginCafe, suggestCafe, type CafeRun } from './cafe-life';

type Response = { run: CafeRun; serverTime: number; feedback?: string; accepted?: boolean };
type Row = { state: string };

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
        id TEXT PRIMARY KEY, state TEXT NOT NULL, next_at INTEGER, started INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cafe_due ON shifts(next_at);
      CREATE TABLE IF NOT EXISTS notes (
        shift TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE, id TEXT NOT NULL,
        suggestion TEXT NOT NULL, reply TEXT NOT NULL, PRIMARY KEY(shift,id)
      );
    `);
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

  private current(id: string, at: number): CafeRun | null {
    const row = this.db.prepare('SELECT state FROM shifts WHERE id=?').get(id) as Row | undefined;
    if (!row) return null;
    const run: CafeRun = JSON.parse(row.state);
    if (run.until !== null && run.until <= at) {
      advanceCafe(run, at);
      this.save(id, run);
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

  start(id: string, busy: boolean): Response {
    const at = this.clock();
    const result = this.transaction((): Response => {
      this.db.prepare('DELETE FROM shifts WHERE started < ?').run(at - 7 * 86400000);
      const existing = this.current(id, at);
      if (existing) {
        const originallyBusy = existing.friendBusyUntil > existing.events[0]!.at;
        if (originallyBusy !== busy) return { run: existing, serverTime: at, accepted: false, feedback: '开班编号已用于另一种班次。' };
        return { run: existing, serverTime: at };
      }
      const initial = beginCafe(at, 'social', busy);
      this.db.prepare('INSERT INTO shifts VALUES (?, ?, ?, ?)').run(id, JSON.stringify(initial), initial.until, at);
      return { run: initial, serverTime: at };
    });
    this.arm();
    return result;
  }

  read(id: string): Response | null {
    const serverTime = this.clock();
    const run = this.transaction(() => this.current(id, serverTime));
    return run && { run, serverTime };
  }

  note(id: string, request: string, suggestion: string): Response | null {
    const serverTime = this.clock();
    return this.transaction(() => {
      const run = this.current(id, serverTime);
      if (!run) return null;
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
