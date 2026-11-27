import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

    const other = await change({ ...first, invite: invite02, name: '小满', avatar: 'citizen' });
    expect(other.status).toBe(201);
    const otherCookie = other.headers.get('set-cookie')!.split(';')[0]!;
    const { key } = await (await change({ action: 'issue' }, cookie)).json();
    const { key: otherKey } = await (await change({ action: 'issue' }, otherCookie)).json();
    expect(await (await observe(key)).json()).toMatchObject({ viewerResidentId: '01' });
    expect(await (await observe(otherKey)).json()).toMatchObject({ viewerResidentId: '02' });
    expect((await observe(key, { action: 'observe', residentId: '02' })).status).toBe(400);
    const view = await GET(new NextRequest(url, { headers: { host } })).json();
    expect(view.profiles).toEqual([{ residentId: '01', name: first.name, avatar: 'builder' }, { residentId: '02', name: '小满', avatar: 'citizen' }]);
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
