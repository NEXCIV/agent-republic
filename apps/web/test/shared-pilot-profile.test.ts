import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { GET, POST } from '../src/app/api/nexciv-preview/shared/route';
import { SharedPilotRuntime } from '../src/lib/shared-pilot-runtime';

it.skipIf(!process.getBuiltinModule?.('node:sqlite'))('claims an invited slot once and issues only revocable, resident-scoped credentials', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'nexciv-profile-'));
  const url = 'http://127.0.0.1:3142/api/nexciv-preview/shared';
  const host = new URL(url).host;
  const invite01 = randomBytes(32).toString('base64url');
  const invite02 = randomBytes(32).toString('base64url');
  const local = globalThis as typeof globalThis & { nexcivSharedPilot?: { runtime: SharedPilotRuntime } };
  const close = () => { local.nexcivSharedPilot?.runtime.close(); local.nexcivSharedPilot = undefined; };
  const profile = (cookie = '') => GET(new NextRequest(url + '?profile=1', { headers: { host, cookie } }));
  const change = (body: unknown, cookie = '', origin = new URL(url).origin) => POST(new NextRequest(url + '?profile=1', {
    method: 'POST', headers: { host, origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  const observe = (key: string, body: unknown = { action: 'observe' }) => POST(new NextRequest(url, {
    method: 'POST', headers: { host, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  const first = { action: 'claim', invite: invite01, name: '湖畔小岚', avatar: 'builder' };
  try {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXCIV_SHARED_PILOT_DB', join(folder, 'shared.sqlite'));
    expect(profile().status).toBe(404);
    vi.stubEnv('NEXCIV_SHARED_INVITE_01', invite01);
    vi.stubEnv('NEXCIV_SHARED_INVITE_02', invite02);
    expect((await change(first, '', 'https://example.test')).status).toBe(403);
    expect((await change({ ...first, residentId: '02' })).status).toBe(400);
    expect((await change({ ...first, avatar: 'toString' })).status).toBe(400);
    expect((await change({ ...first, invite: randomBytes(32).toString('base64url') })).status).toBe(401);
    const claimed = await change(first);
    expect(claimed.status).toBe(201);
    const cookie = claimed.headers.get('set-cookie')!.split(';')[0]!;
    expect(claimed.headers.get('set-cookie')).toMatch(/HttpOnly.*SameSite=strict/i);
    expect((await change(first)).status).toBe(409);
    expect((await change({ ...first, invite: invite02 }, cookie)).status).toBe(409);
    expect((await change({ action: 'issue' })).status).toBe(401);
    expect((await change({ action: 'issue', residentId: '02' }, cookie)).status).toBe(400);
    expect(await profile(cookie).json()).toMatchObject({ profile: { residentId: '01', name: first.name, avatar: 'builder' }, hasKey: false });
    expect(await profile().json()).toMatchObject({ profile: null });

    const other = await change({ ...first, invite: invite02, name: '小满', avatar: 'technician' });
    expect(other.status).toBe(201);
    const otherCookie = other.headers.get('set-cookie')!.split(';')[0]!;
    const { key } = await (await change({ action: 'issue' }, cookie)).json();
    const { key: otherKey } = await (await change({ action: 'issue' }, otherCookie)).json();
    expect(await (await observe(key)).json()).toMatchObject({ viewerResidentId: '01' });
    expect(await (await observe(otherKey)).json()).toMatchObject({ viewerResidentId: '02' });
    expect((await observe(key, { action: 'observe', residentId: '02' })).status).toBe(400);
    const view = await GET(new NextRequest(url, { headers: { host } })).json();
    expect(view.profiles).toEqual([{ residentId: '01', name: first.name, avatar: 'builder' }, { residentId: '02', name: '小满', avatar: 'technician' }]);
    expect(JSON.stringify(view)).not.toMatch(new RegExp(`${key}|${otherKey}|${invite01}|${invite02}`));

    close();
    expect(await profile(cookie).json()).toMatchObject({ hasKey: true });
    expect((await observe(key)).status).toBe(200);
    const { key: rotated } = await (await change({ action: 'issue' }, cookie)).json();
    expect((await observe(key)).status).toBe(401);
    expect((await observe(rotated)).status).toBe(200);
    expect((await change({ action: 'revoke' }, cookie)).status).toBe(200);
    expect((await observe(rotated)).status).toBe(401);
    expect((await observe(otherKey)).status).toBe(200);
    vi.stubEnv('NODE_ENV', 'production');
    expect(profile(cookie).status).toBe(404);
    expect((await observe(otherKey)).status).toBe(404);
  } finally {
    close();
    vi.unstubAllEnvs();
    rmSync(folder, { recursive: true, force: true });
  }
});

it.skipIf(!process.getBuiltinModule?.('node:sqlite'))('migrates v4 profiles without changing their sessions, keys, or invitations', () => {
  const folder = mkdtempSync(join(tmpdir(), 'nexciv-profile-v4-'));
  const file = join(folder, 'shared.sqlite');
  const now = () => 1800000000000;
  const profile = { residentId: '01', name: 'Lake', avatar: 'citizen' } as const;
  const initial = new SharedPilotRuntime(file, now, true, ['01', '02']);
  try {
    const { session } = initial.claimProfile(profile, 'first-invite', '');
    const { key } = initial.setProfileKey(session, true, ['01']);
    initial.close();

    const sqlite = process.getBuiltinModule('node:sqlite') as { DatabaseSync: typeof DatabaseSync };
    const db = new sqlite.DatabaseSync(file);
    try {
      db.exec(`
        ALTER TABLE shared_pilot_profiles RENAME TO current_profiles;
        CREATE TABLE shared_pilot_profiles (
          resident_id TEXT PRIMARY KEY REFERENCES shared_pilot_residents(id),
          name TEXT NOT NULL, avatar TEXT NOT NULL CHECK(avatar IN ('citizen','builder')),
          session_hash TEXT NOT NULL UNIQUE, session_expires_at INTEGER NOT NULL,
          invite_hash TEXT NOT NULL UNIQUE, access_hash TEXT UNIQUE, access_expires_at INTEGER
        );
        INSERT INTO shared_pilot_profiles SELECT * FROM current_profiles;
        DROP TABLE current_profiles;
        PRAGMA user_version=4;
      `);
    } finally { db.close(); }

    const migrated = new SharedPilotRuntime(file, now, true, ['01', '02']);
    try {
      expect(migrated.profile(session)).toEqual({ profile, hasKey: true });
      expect(migrated.actWithProfileKey(key!, ['01'], { action: 'observe' })).toMatchObject({ viewerResidentId: '01' });
      const second = { residentId: '02', name: 'Reed', avatar: 'researcher' } as const;
      expect(() => migrated.claimProfile(second, 'first-invite', '')).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
      migrated.claimProfile(second, 'second-invite', '');
      expect(migrated.snapshot().profiles).toEqual([profile, second]);
    } finally { migrated.close(); }
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

it.skipIf(!process.getBuiltinModule?.('node:sqlite'))('keeps internal city reads working after an hour and applies the player key expiry', () => {
  const folder = mkdtempSync(join(tmpdir(), 'nexciv-profile-expiry-'));
  let now = 1800000000000;
  const runtime = new SharedPilotRuntime(join(folder, 'shared.sqlite'), () => now, true, ['01', '02']);
  try {
    const { session } = runtime.claimProfile({ residentId: '01', name: 'Lake', avatar: 'citizen' }, 'invite', '');
    const { key } = runtime.setProfileKey(session, true, ['01']);
    now += 3600000;
    runtime.tick();
    expect(runtime.snapshot().profiles[0]?.name).toBe('Lake');
    expect(runtime.actWithProfileKey(key!, ['01'], { action: 'observe' })).toMatchObject({ viewerResidentId: '01' });
    now += 23 * 3600000;
    expect(runtime.profile(session).hasKey).toBe(false);
    expect(() => runtime.actWithProfileKey(key!, ['01'], { action: 'observe' })).toThrow(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
  } finally {
    runtime.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
