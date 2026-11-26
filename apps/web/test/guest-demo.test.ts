import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../src/app/api/nexciv-preview/guest/route';
import { GET as localGet } from '../src/app/api/nexciv-preview/cafe/route';
import { GUEST_COOKIE, GUEST_COOKIE_AGE, type GuestDemoSessions } from '../src/lib/guest-demo-session';
import { CafeDemoStore } from '../src/lib/cafe-demo-store';
import type { DatabaseSync } from 'node:sqlite';

const origin = 'https://preview.example.test';
const endpoint = '/api/nexciv-preview/guest';
const local = globalThis as typeof globalThis & { nexcivGuestStore?: { file: string; sessions: GuestDemoSessions } };
const supported = Boolean(process.getBuiltinModule?.('node:sqlite'));

describe.skipIf(!supported)('isolated public city guest demo', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'nexciv-guest-'));
    vi.stubEnv('NEXCIV_GUEST_ORIGIN', origin);
    vi.stubEnv('NEXCIV_GUEST_DB', join(folder, 'guest.sqlite'));
    vi.stubEnv('NEXCIV_GUEST_SECRET', Buffer.alloc(32, 42).toString('base64url'));
    vi.stubEnv('NEXCIV_CAFE_DEMO_DB', join(folder, 'local.sqlite'));
    vi.useFakeTimers();
  });

  function reopen() {
    local.nexcivGuestStore?.sessions.close();
    local.nexcivGuestStore = undefined;
  }

  afterEach(() => {
    reopen();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    rmSync(folder, { recursive: true, force: true });
  });

  function get(query = '', credentials: HeadersInit = {}) {
    const headers = new Headers({ host: new URL(origin).host });
    new Headers(credentials).forEach((value, name) => headers.set(name, value));
    return GET(new NextRequest(origin + endpoint + query, { headers }));
  }

  function post(input: Record<string, unknown>, credentials: HeadersInit = {}) {
    const headers = new Headers({ host: new URL(origin).host, origin, 'content-type': 'application/json' });
    new Headers(credentials).forEach((value, name) => headers.set(name, value));
    return POST(new NextRequest(origin + endpoint, {
      method: 'POST', headers, body: JSON.stringify({ requestId: randomUUID(), ...input }),
    }));
  }

  function browser() {
    const response = get();
    expect(response.status).toBe(200);
    return { cookie: response.headers.get('set-cookie')!.split(';')[0]! };
  }

  it('requires explicit valid HTTPS guest config and leaves the local endpoint local', async () => {
    vi.stubEnv('NEXCIV_GUEST_SECRET', '');
    expect(get().status).toBe(404);
    vi.stubEnv('NEXCIV_GUEST_SECRET', Buffer.alloc(32, 42).toString('base64url'));
    vi.stubEnv('NEXCIV_GUEST_ORIGIN', 'http://preview.example.test');
    expect(get().status).toBe(404);
    vi.stubEnv('NEXCIV_GUEST_ORIGIN', origin);
    vi.stubEnv('NEXCIV_GUEST_DB', join(folder, 'local.sqlite'));
    expect(get().status).toBe(404);
    vi.stubEnv('NEXCIV_GUEST_DB', join(folder, 'guest.sqlite'));
    const remoteCafe = localGet(new NextRequest(origin + '/api/nexciv-preview/cafe', { headers: { host: new URL(origin).host } }));
    expect(remoteCafe.status).toBe(403);
    const otherFile = join(folder, 'preexisting.sqlite');
    const existing = new CafeDemoStore(otherFile);
    try {
      const resident = randomUUID();
      const started = existing.start(randomUUID(), true, resident);
      expect('run' in started).toBe(true);
      vi.stubEnv('NEXCIV_GUEST_DB', otherFile);
      expect(get().status).toBe(503);
      expect(existing.read(resident)?.run.phase).toBe('working');
    } finally {
      existing.close();
    }
  });

  it('uses only scoped browser sessions and never opens pairing or external actions', async () => {
    expect(get('?control=city').status).toBe(409);
    const created = get();
    expect(created.headers.get('cache-control')).toBe('private, no-store');
    const cookie = created.headers.get('set-cookie')!;
    expect(cookie).toContain(GUEST_COOKIE + '=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toContain('Path=' + endpoint);
    expect(await created.json()).toBeNull();
    const guest = { cookie: cookie.split(';')[0]! };
    expect(get('', { 'sec-fetch-site': 'cross-site' }).status).toBe(403);
    expect(get('?control=pairing', guest).status).toBe(403);
    expect(get('?control=observer', guest).status).toBe(403);
    expect(get('?control=city', { cookie: GUEST_COOKIE + '=invalid' }).status).toBe(409);
    expect(get('?control=city', { cookie: 'nexciv_cafe_resident=' + randomUUID() }).status).toBe(409);
    expect((await post({ action: 'issueMcpCode' }, guest)).status).toBe(403);
    expect((await post({ action: 'start', kind: 'observer', driver: 'external', busy: true }, guest)).status).toBe(400);
    expect((await post({ action: 'moveTo', destination: { place: 'works' } }, { ...guest, origin: 'https://other.example.test' })).status).toBe(403);
    expect((await post({ action: 'moveTo', destination: { place: 'works' }, padding: 'a'.repeat(8500) }, guest)).status).toBe(400);
  });

  it('keeps guest city progress isolated between browsers and on restart', async () => {
    const owner = browser();
    const other = browser();
    const command = { action: 'moveTo', requestId: randomUUID(), destination: { place: 'works' } };
    const firstResponse = await post(command, owner);
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(await (await post(command, owner)).json()).toEqual(first);
    expect((await get('?control=city', owner).json()).movement.requestId).toBe(command.requestId);
    expect((await get('?control=city', other).json()).movement).toBeNull();
    vi.setSystemTime(first.arrivesAt);
    const chat = await post({ action: 'interactCity', actionId: 'works.chat' }, owner);
    expect(chat.status).toBe(200);
    const receipt = await chat.json();
    vi.setSystemTime(receipt.endsAt);
    reopen();
    const restored = await get('?control=city', owner).json();
    expect(restored.recentActivities[0]).toMatchObject({ requestId: receipt.requestId, status: 'completed' });
    expect((await get('?control=city', other).json()).recentActivities).toEqual([]);
  });

  it('supports rules-only café shifts and keeps a visitor’s records private', async () => {
    const owner = browser();
    const other = browser();
    const started = await post({ action: 'start', kind: 'cafe', busy: true }, owner);
    expect(started.status).toBe(200);
    const shift = await started.json();
    expect(shift.run.phase).toBe('working');
    const reply = await post({ action: 'note', suggestion: 'fish', shiftStartedAt: shift.run.events[0]!.at }, owner);
    expect(reply.status).toBe(200);
    expect((await reply.json()).run.requestedActivity).toBe('fish');
    expect(await get('', other).json()).toBeNull();
    expect(await get('?newspaper=latest', other).json()).toEqual({ issues: [], current: null });
  });

  it('completes a rules observer interview and archives only that guest’s newspaper', async () => {
    const owner = browser();
    const other = browser();
    const started = await post({ action: 'start', kind: 'observer', busy: true }, owner);
    expect(started.status).toBe(200);
    const shift = await started.json();
    expect(shift.run.observer.driver).toBe('rules');
    const note = await post({ action: 'note', suggestion: 'askImpact', shiftStartedAt: shift.run.events[0]!.at }, owner);
    expect(note.status).toBe(200);
    expect((await note.json()).accepted).toBe(true);
    vi.setSystemTime(Date.now() + 240000);
    reopen();
    const completed = await get('', owner).json();
    expect(completed.run.phase).toBe('done');
    expect(completed.run.observer.sources).toHaveLength(2);
    const paper = await get('?newspaper=latest', owner).json();
    expect(paper.current.sources).toHaveLength(2);
    expect(await get(`?newspaper=${paper.current.issue.id}`, owner).json()).toEqual(paper);
    expect(get(`?newspaper=${paper.current.issue.id}`, other).status).toBe(404);
  });

  it('runs the named civic lighting actions without granting any chain or MCP capabilities', async () => {
    const owner = browser();
    const other = browser();
    const move = await (await post({ action: 'moveTo', destination: { place: 'governance' } }, owner)).json();
    vi.setSystemTime(move.arrivesAt);
    const reading = await post({ action: 'interactCity', actionId: 'governance.read' }, owner);
    expect(reading.status).toBe(200);
    vi.setSystemTime((await reading.json()).endsAt);
    const survey = await post({ action: 'interactCity', actionId: 'governance.survey' }, owner);
    expect(survey.status).toBe(200);
    vi.setSystemTime((await survey.json()).endsAt);
    const report = await post({ action: 'interactCity', actionId: 'governance.submit' }, owner);
    expect(report.status).toBe(200);
    const review = await get('?control=city', owner).json();
    expect(review.lightingPilot.stage).toBe('review');
    vi.setSystemTime(review.lightingPilot.approvedAt);
    const dispatched = await post({ action: 'interactCity', actionId: 'works.install-light' }, owner);
    expect(dispatched.status).toBe(200);
    vi.setSystemTime((await dispatched.json()).endsAt);
    reopen();
    expect((await get('?control=city', owner).json()).lightingPilot.stage).toBe('lit');
    expect((await get('?control=city', other).json()).lightingPilot).toBeUndefined();
  });

  it('bounds new sessions and action requests durably, then expires guest records', async () => {
    const owner = browser();
    for (let index = 0; index < 12; index++) {
      expect((await post({ action: 'moveTo', destination: { place: 'cafe' } }, owner)).status).toBe(200);
    }
    reopen();
    const crowded = await post({ action: 'moveTo', destination: { place: 'cafe' } }, owner);
    expect(crowded.status).toBe(429);
    expect(Number(crowded.headers.get('retry-after'))).toBeGreaterThan(0);
    vi.setSystemTime(Date.now() + 60000);
    expect((await post({ action: 'moveTo', destination: { place: 'cafe' } }, owner)).status).toBe(200);
    for (let index = 0; index < 19; index++) browser();
    expect(get().status).toBe(429);
    vi.setSystemTime(Date.now() + GUEST_COOKIE_AGE * 1000);
    expect(get('?control=city', owner).status).toBe(409);
    expect((await get('?control=city', browser()).json()).movement).toBeNull();
    const sqlite = process.getBuiltinModule!('node:sqlite') as typeof import('node:sqlite');
    const db: DatabaseSync = new sqlite.DatabaseSync(join(folder, 'guest.sqlite'));
    try {
      expect(db.prepare('SELECT COUNT(*) AS count FROM guest_sessions').get()?.count).toBe(1);
      expect(db.prepare('SELECT COUNT(*) AS count FROM city_walks').get()?.count).toBe(0);
    } finally { db.close(); }
  });
});
