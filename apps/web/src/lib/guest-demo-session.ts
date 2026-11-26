import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { CafeDemoStore } from './cafe-demo-store';

const SESSION_LIFETIME = 30 * 86400000;
const MAX_ACTIVE_SESSIONS = 100;
const NEW_SESSIONS_PER_HOUR = 20;
const MAX_ACTIONS = 300;
const ACTIONS_PER_MINUTE = 12;
const READS_PER_MINUTE = 180;
export const GUEST_COOKIE = '__Secure-nexciv_guest';
export const GUEST_COOKIE_AGE = SESSION_LIFETIME / 1000;
export const GUEST_ENDPOINT = '/api/nexciv-preview/guest';
export const GUEST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type GuestConfig = { origin: string; file: string; secret: Buffer };
export function guestDemoConfig(): GuestConfig | null {
  const origin = process.env.NEXCIV_GUEST_ORIGIN;
  const file = process.env.NEXCIV_GUEST_DB;
  const secret = process.env.NEXCIV_GUEST_SECRET;
  if (!origin || !file || !secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || !path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.sqlite') return null;
    const key = Buffer.from(secret, 'base64url');
    if (key.length !== 32 || key.toString('base64url') !== secret) return null;
    const localFile = path.resolve(process.env.NEXCIV_CAFE_DEMO_DB || 'cache/nexciv-cafe-v1.sqlite');
    const guestFile = path.resolve(file);
    const comparable = (name: string) => process.platform === 'win32' ? name.toLowerCase() : name;
    if (comparable(guestFile) === comparable(localFile)) return null;
    if (existsSync(guestFile) && existsSync(localFile)) {
      if (comparable(realpathSync(guestFile)) === comparable(realpathSync(localFile))) return null;
      const guestStat = statSync(guestFile);
      const localStat = statSync(localFile);
      if (guestStat.ino !== 0 && guestStat.ino === localStat.ino && guestStat.dev === localStat.dev) return null;
    }
    return { origin, file: guestFile, secret: key };
  } catch {
    return null;
  }
}

type Session = { id: string; expires: number };
type Limited = { retryAfter: number };

export function guestCookie(config: GuestConfig, session: Session) {
  const payload = `${session.id}.${session.expires}`;
  const signature = createHmac('sha256', config.secret).update(`nexciv-guest-v1.${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyGuestCookie(config: GuestConfig, value: string | undefined, now = Date.now()): Session | null {
  if (!value) return null;
  const [id, expiration, signature, ...rest] = value.split('.');
  if (!id || !GUEST_UUID.test(id) || !expiration || !/^\d{10,15}$/.test(expiration)
    || !signature || !/^[A-Za-z0-9_-]{43}$/.test(signature) || rest.length) return null;
  const expires = Number(expiration);
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + SESSION_LIFETIME) return null;
  const session = { id, expires };
  const actual = Buffer.from(value);
  const expected = Buffer.from(guestCookie(config, session));
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? session : null;
}

/**
 * Single-process pilot. Session issuance, POST limits and expiry are durable.
 * The guest roster owns all guest IDs; it never adopts an existing local ID.
 */
export class GuestDemoSessions {
  readonly city: CafeDemoStore;
  private readonly db: DatabaseSync;
  private readonly readWindows = new Map<string, { minute: number; count: number }>();

  constructor(file: string) {
    const sqlite = process.getBuiltinModule?.('node:sqlite') as typeof import('node:sqlite') | undefined;
    if (!sqlite) throw new Error('Guest demo needs Node.js with SQLite');
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new sqlite.DatabaseSync(file);
    try {
      this.db.exec('PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON;');
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (tables.length && !tables.some(({ name }) => name === 'guest_sessions')) {
        throw new Error('Guest database must be new or previously used by the guest demo');
      }
      this.db.exec('PRAGMA journal_mode=WAL;');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS guest_sessions (
          id TEXT PRIMARY KEY NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          actions_total INTEGER NOT NULL DEFAULT 0,
          action_minute INTEGER NOT NULL DEFAULT 0,
          actions_in_minute INTEGER NOT NULL DEFAULT 0
        );
      `);
      this.city = new CafeDemoStore(file);
    } catch (error) {
      this.db.close();
      throw error;
    }
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

  private prune(at: number) {
    const expired = this.db.prepare('SELECT id FROM guest_sessions WHERE expires_at<=?').all(at);
    for (const { id } of expired) {
      const resident = String(id);
      this.db.prepare('DELETE FROM shifts WHERE resident=?').run(resident);
      this.db.prepare('DELETE FROM city_walks WHERE resident=?').run(resident);
      this.db.prepare('DELETE FROM city_activities WHERE resident=?').run(resident);
      this.db.prepare('DELETE FROM theatre_trials WHERE resident=?').run(resident);
      this.db.prepare('DELETE FROM cafe_mcp_connections WHERE resident=?').run(resident);
      this.db.prepare('DELETE FROM guest_sessions WHERE id=?').run(resident);
      this.readWindows.delete(resident);
    }
  }

  create(at = Date.now()): Session | Limited {
    return this.transaction(() => {
      this.prune(at);
      const { count } = this.db.prepare('SELECT count(*) AS count FROM guest_sessions').get()!;
      if (Number(count) >= MAX_ACTIVE_SESSIONS) return { retryAfter: 3600 };
      const { count: recent } = this.db.prepare('SELECT count(*) AS count FROM guest_sessions WHERE created_at>?').get(at - 3600000)!;
      if (Number(recent) >= NEW_SESSIONS_PER_HOUR) return { retryAfter: 3600 };
      const session = { id: randomUUID(), expires: at + SESSION_LIFETIME };
      this.db.prepare('INSERT INTO guest_sessions(id,created_at,expires_at) VALUES (?,?,?)').run(session.id, at, session.expires);
      return session;
    });
  }

  exists(session: Session) {
    return Boolean(this.db.prepare('SELECT id FROM guest_sessions WHERE id=? AND expires_at=?').get(session.id, session.expires));
  }

  read(session: Session, at = Date.now()): Limited | null {
    const minute = Math.floor(at / 60000);
    const previous = this.readWindows.get(session.id);
    const count = previous?.minute === minute ? previous.count : 0;
    const retryAfter = Math.max(1, Math.ceil(((minute + 1) * 60000 - at) / 1000));
    if (count >= READS_PER_MINUTE) return { retryAfter };
    this.readWindows.set(session.id, { minute, count: count + 1 });
    return null;
  }

  write(session: Session, at = Date.now()): Limited | null {
    return this.transaction(() => {
      const minute = Math.floor(at / 60000);
      const row = this.db.prepare('SELECT actions_total,action_minute,actions_in_minute FROM guest_sessions WHERE id=? AND expires_at=?')
        .get(session.id, session.expires)!;
      const count = row.action_minute === minute ? Number(row.actions_in_minute) : 0;
      if (Number(row.actions_total) >= MAX_ACTIONS) return { retryAfter: Math.max(1, Math.ceil((session.expires - at) / 1000)) };
      if (count >= ACTIONS_PER_MINUTE) return { retryAfter: Math.max(1, Math.ceil(((minute + 1) * 60000 - at) / 1000)) };
      this.db.prepare('UPDATE guest_sessions SET actions_total=actions_total+1,action_minute=?,actions_in_minute=? WHERE id=?')
        .run(minute, count + 1, session.id);
      return null;
    });
  }

  close() {
    this.city.close();
    this.db.close();
  }
}
