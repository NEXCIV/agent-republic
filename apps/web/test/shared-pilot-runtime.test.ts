import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SharedPilotRuntime } from '../src/lib/shared-pilot-runtime';
import { GET } from '../src/app/api/nexciv-preview/shared/route';

describe.skipIf(!process.getBuiltinModule?.('node:sqlite'))('two connected rule agents in a shared local city', () => {
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
