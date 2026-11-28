import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { GET, POST } from '../src/app/api/nexciv-preview/shared/route';
import { SharedPilotRuntime } from '../src/lib/shared-pilot-runtime';
import * as model from '../src/lib/shared-pilot-model';
import { SharedPilotStore } from '../src/lib/shared-pilot-store';

it('accepts only a single offered choice and rejects non-HTTPS and internal provider endpoints', () => {
  expect(model.parseModelChoice('{"choice":"move:works"}', ['wait', 'move:works'])).toBe('move:works');
  expect(model.parseModelChoice('{"choice":"move:works","residentId":"02"}', ['move:works'])).toBeUndefined();
  expect(model.parseModelChoice('{"choice":"unlisted"}', ['wait'])).toBeUndefined();
  for (const baseUrl of ['http://example.com/v1', 'https://localhost/v1', 'https://127.0.0.1/v1', 'https://example.com/v1?key=abc']) {
    expect(model.parseModelConfig({ baseUrl, model: 'test-model', apiKey: 'test-key' })).toBeUndefined();
  }
  expect(model.parseModelConfig({ baseUrl: 'https://example.com/v1', model: 'test-model', apiKey: 'test-key' })).toBeDefined();
});

it.skipIf(!process.getBuiltinModule?.('node:sqlite'))('bounds decision calls and cancels a delayed choice when paused', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'nexciv-model-limit-'));
  const store = new SharedPilotStore(join(folder, 'shared.sqlite'), Date.now);
  const config = model.parseModelConfig({ baseUrl: 'https://example.com/v1', model: 'test-model', apiKey: 'test-key' })!;
  const token = store.issueCredential('01', 3600000).token;
  const act = vi.fn();
  vi.useFakeTimers();
  try {
    const choose = vi.fn().mockResolvedValue('wait');
    const run = new model.SharedPilotModelRun(config, () => store.observe(token), act, choose);
    run.start();
    await vi.advanceTimersByTimeAsync(160_000);
    expect(run.view).toMatchObject({ status: 'finished', calls: model.MODEL_CALL_LIMIT });
    expect(choose).toHaveBeenCalledTimes(model.MODEL_CALL_LIMIT);
    expect(act).not.toHaveBeenCalled();
    let resolve!: (choice: string) => void;
    const deferred = new Promise<string>((done) => { resolve = done; });
    const pending = new model.SharedPilotModelRun(config, () => store.observe(token), act, () => deferred);
    pending.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(pending.view.calls).toBe(1);
    pending.stop();
    resolve('move:works');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pending.view.status).toBe('paused');
    expect(act).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

it.skipIf(!process.getBuiltinModule?.('node:sqlite'))('starts an authorized model driver, executes a real allowed move, revokes MCP, and stops cleanly', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'nexciv-model-'));
  const url = 'http://127.0.0.1:3142/api/nexciv-preview/shared';
  const host = new URL(url).host;
  const local = globalThis as typeof globalThis & { nexcivSharedPilot?: { runtime: SharedPilotRuntime } };
  const request = (body: unknown, cookie = '', origin = new URL(url).origin) => POST(new NextRequest(url + '?profile=1', {
    method: 'POST', headers: { host, origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  const getProfile = (cookie: string) => GET(new NextRequest(url + '?profile=1', { headers: { host, cookie } }));
  const publicView = () => GET(new NextRequest(url, { headers: { host } }));
  const observe = (key: string) => POST(new NextRequest(url, {
    method: 'POST', headers: { host, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'observe' }),
  }));
  const config = { action: 'startModel', baseUrl: 'https://example.com/v1', model: 'test-model', apiKey: 'model-key-for-test' };
  const choose = vi.spyOn(model, 'chooseModelAction').mockResolvedValue('move:works');
  try {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXCIV_SHARED_PILOT_DB', join(folder, 'shared.sqlite'));
    vi.stubEnv('NEXCIV_SHARED_AGENT_01_KEY', '');
    vi.stubEnv('NEXCIV_SHARED_AGENT_02_KEY', '');
    vi.stubEnv('NEXCIV_SHARED_AGENT_KEY', '');
    expect((await request(config)).status).toBe(401);
    const claim = await request({ action: 'claim', name: 'Lake', avatar: 'researcher' });
    const cookie = claim.headers.get('set-cookie')!.split(';')[0]!;
    expect((await request(config, cookie, 'https://other.example')).status).toBe(403);
    expect((await request({ ...config, residentId: '02' }, cookie)).status).toBe(400);
    const { key } = await (await request({ action: 'issue' }, cookie)).json();
    expect((await observe(key)).status).toBe(200);
    expect((await request(config, cookie)).status).toBe(200);
    expect((await observe(key)).status).toBe(401);
    await vi.waitFor(async () => {
      const view = await publicView().json();
      expect(view.residents[0].movement?.destination.place).toBe('works');
      expect(view.engines[0]).toMatchObject({ driver: 'MODEL', status: 'running' });
    });
    expect(choose).toHaveBeenCalledTimes(1);
    expect((await getProfile(cookie).json()).modelRun).toMatchObject({ status: 'running', calls: 1 });
    expect((await GET(new NextRequest(url, { headers: { host, cookie } })).json()).ownModelRun)
      .toMatchObject({ status: 'running', calls: 1, lastAction: '前往公共建设中心' });
    expect((await publicView().json()).ownModelRun).toBeNull();
    expect(JSON.stringify(await getProfile(cookie).json())).not.toContain(config.apiKey);
    expect(JSON.stringify(await publicView().json())).not.toContain(config.apiKey);
    expect((await request({ action: 'stopModel' }, cookie)).status).toBe(200);
    expect((await getProfile(cookie).json()).modelRun.status).toBe('paused');
    const renewed = await request({ action: 'issue' }, cookie);
    expect((await observe((await renewed.json()).key)).status).toBe(200);
    expect((await getProfile(cookie).json()).modelRun).toBeNull();
  } finally {
    local.nexcivSharedPilot?.runtime.close();
    local.nexcivSharedPilot = undefined;
    choose.mockRestore();
    vi.unstubAllEnvs();
    rmSync(folder, { recursive: true, force: true });
  }
});
