import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SharedPilotRuntime } from '../src/lib/shared-pilot-runtime';
import { GET, POST } from '../src/app/api/nexciv-preview/shared/route';

describe.skipIf(!process.getBuiltinModule?.('node:sqlite'))('two connected rule agents in a shared local city', () => {
  it('reserves 02 for an authorized external agent and rejects a browser, caller-supplied identity, or a wrong key', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'nexciv-shared-mcp-'));
    const key = randomBytes(32).toString('base64url');
    const global = globalThis as typeof globalThis & { nexcivSharedPilot?: { runtime: SharedPilotRuntime } };
    const command = (body: unknown, secret = key, extra: Record<string, string> = {}) => POST(new NextRequest('http://127.0.0.1:3142/api/nexciv-preview/shared', {
      method: 'POST', headers: { host: '127.0.0.1:3142', authorization: `Bearer ${secret}`, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body),
    }));

    try {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('NEXCIV_SHARED_PILOT_DB', join(folder, 'shared.sqlite'));
      expect((await command({ action: 'observe' })).status).toBe(404);
      vi.stubEnv('NEXCIV_SHARED_AGENT_KEY', key);
      expect((await command({ action: 'observe' }, randomBytes(32).toString('base64url'))).status).toBe(401);
      expect((await command({ action: 'observe' }, key, { origin: 'http://127.0.0.1:3142' })).status).toBe(403);
      expect((await command({ action: 'observe' }, key, { host: 'other.example' })).status).toBe(403);
      expect((await command({ action: 'moveTo', requestId: randomUUID(), destination: { place: 'works' }, residentId: '01' })).status).toBe(400);
      const receipt = await (await command({ action: 'moveTo', requestId: randomUUID(), destination: { place: 'works' } })).json();
      expect(receipt.residentId).toBe('02');
      const view = global.nexcivSharedPilot!.runtime.snapshot();
      expect(view.engines[1]).toMatchObject({ residentId: '02', driver: 'EXTERNAL', connected: true });
      expect(view.residents[0]?.movement).toBeNull();
      expect(view.residents[1]?.movement?.destination.place).toBe('works');
      expect(JSON.stringify(view)).not.toContain(key);
    } finally {
      global.nexcivSharedPilot?.runtime.close();
      global.nexcivSharedPilot = undefined;
      vi.unstubAllEnvs();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('maps two independent external keys to their own residents, and rejects ambiguous credentials', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'nexciv-shared-two-clients-'));
    const key01 = randomBytes(32).toString('base64url');
    const key02 = randomBytes(32).toString('base64url');
    const local = globalThis as typeof globalThis & { nexcivSharedPilot?: { runtime: SharedPilotRuntime } };
    const url = 'http://127.0.0.1:3142/api/nexciv-preview/shared';
    const host = '127.0.0.1:3142';
    const command = (key: string, body: unknown) => POST(new NextRequest(url, {
      method: 'POST', headers: { host, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
    const view = () => GET(new NextRequest(url, { headers: { host } }));
    try {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('NEXCIV_SHARED_PILOT_DB', join(folder, 'shared.sqlite'));
      vi.stubEnv('NEXCIV_SHARED_AGENT_01_KEY', key01);
      vi.stubEnv('NEXCIV_SHARED_AGENT_02_KEY', key01);
      expect((await command(key01, { action: 'observe' })).status).toBe(503);
      vi.stubEnv('NEXCIV_SHARED_AGENT_02_KEY', 'invalid');
      expect((await command(key01, { action: 'observe' })).status).toBe(503);

      vi.stubEnv('NEXCIV_SHARED_AGENT_02_KEY', key02);
      expect((await command(key01, { action: 'observe', residentId: '02' })).status).toBe(400);
      expect(await (await command(key01, { action: 'observe' })).json()).toMatchObject({ viewerResidentId: '01' });
      expect(await (await command(key02, { action: 'observe' })).json()).toMatchObject({ viewerResidentId: '02' });
      const requestId = randomUUID();
      const first = { action: 'moveTo', requestId, destination: { place: 'governance' } };
      const second = { action: 'moveTo', requestId, destination: { place: 'works' } };
      const [a, b] = await Promise.all([command(key01, first), command(key02, second)]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      const receipt = await a.json();
      expect(receipt.residentId).toBe('01');
      expect(await b.json()).toMatchObject({ residentId: '02' });
      expect(await (await command(key01, first)).json()).toEqual(receipt);
      expect((await command(key01, second)).status).toBe(409);
      const publicView = await view().json();
      expect(publicView.engines).toEqual([
        { residentId: '01', driver: 'EXTERNAL', connected: true },
        { residentId: '02', driver: 'EXTERNAL', connected: true },
      ]);
      expect(publicView.events.map(({ residentId }: { residentId: string }) => residentId).sort()).toEqual(['01', '02']);
      expect(publicView).not.toHaveProperty('privateSocial');
      expect(publicView).not.toHaveProperty('viewerResidentId');
      expect(JSON.stringify(publicView)).not.toMatch(new RegExp(`${key01}|${key02}|${requestId}`));

      const replacement = randomBytes(32).toString('base64url');
      vi.stubEnv('NEXCIV_SHARED_AGENT_01_KEY', replacement);
      expect((await command(key01, { action: 'observe' })).status).toBe(401);
      expect(await (await command(replacement, { action: 'observe' })).json()).toMatchObject({ viewerResidentId: '01' });
    } finally {
      local.nexcivSharedPilot?.runtime.close();
      local.nexcivSharedPilot = undefined;
      vi.unstubAllEnvs();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('keeps the shared viewer opt-in, local and read-only', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'nexciv-shared-http-'));
    const local = globalThis as typeof globalThis & { nexcivSharedPilot?: { runtime: SharedPilotRuntime } };
    const request = (host = '127.0.0.1:3142', site = 'same-origin') => new NextRequest('http://127.0.0.1:3142/api/nexciv-preview/shared', { headers: { host, 'sec-fetch-site': site } });
    try {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('NEXCIV_SHARED_PILOT_DB', '');
      expect(GET(request()).status).toBe(404);
      vi.stubEnv('NEXCIV_SHARED_PILOT_DB', join(folder, 'shared.sqlite'));
      expect(GET(request('example.test')).status).toBe(403);
      expect(GET(request('127.0.0.1:3142', 'cross-site')).status).toBe(403);
      vi.stubEnv('NODE_ENV', 'production');
      expect(GET(request()).status).toBe(404);
      vi.stubEnv('NODE_ENV', 'test');
      const response = GET(request());
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      const body = await response.json();
      expect(body.residents).toHaveLength(2);
      expect(body).not.toHaveProperty('viewerResidentId');
      expect(JSON.stringify(body)).not.toContain('nxc_shared_');
    } finally {
      local.nexcivSharedPilot?.runtime.close();
      local.nexcivSharedPilot = undefined;
      vi.unstubAllEnvs();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('lets both independently observe and act, and projects only their shared activity', () => {
    const folder = mkdtempSync(join(tmpdir(), 'nexciv-shared-runtime-'));
    let at = 1_800_000_000_000;
    const runtime = new SharedPilotRuntime(join(folder, 'shared.sqlite'), () => at, false);
    try {
      const initial = runtime.snapshot();
      expect(initial.mode).toBe('DEMO');
      expect(initial.residents.map(({ residentId, place }) => [residentId, place])).toEqual([['01', 'plaza'], ['02', 'cafe']]);
      expect(initial.engines).toEqual([{ residentId: '01', driver: 'RULES' }, { residentId: '02', driver: 'RULES' }]);
      expect(initial.events).toEqual([]);
      at += 10000;
      runtime.tick();
      const moving = runtime.snapshot();
      expect(moving.residents.map(({ movement }) => movement?.destination.place)).toEqual(['governance', 'works']);
      expect(moving.events.map(({ residentId, kind }) => [residentId, kind])).toEqual([['01', 'MOVE_STARTED'], ['02', 'MOVE_STARTED']]);
      expect(moving).not.toHaveProperty('viewerResidentId');
      expect(JSON.stringify(moving)).not.toContain('nxc_shared_');
      at += 1000;
      expect(runtime.snapshot().residents[0]?.position).not.toEqual(moving.residents[0]?.position);
      at = Math.max(...moving.residents.map(({ movement }) => movement!.arrivesAt));
      const arrived = runtime.snapshot();
      expect(arrived.residents.map(({ place }) => place)).toEqual(['governance', 'works']);
      expect(arrived.events.filter(({ kind }) => kind === 'MOVE_ARRIVED')).toHaveLength(2);
      expect(runtime.snapshot().events).toEqual(arrived.events);
      at += 9000;
      runtime.tick();
      expect(runtime.snapshot().residents.every(({ movement }) => movement?.status === 'walking')).toBe(true);
    } finally {
      runtime.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
