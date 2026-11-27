import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestOptions, IncomingMessage } from 'node:http';
import { expect, it, vi } from 'vitest';
import { chooseModelAction, modelChoices, parseModelConfig } from '../src/lib/shared-pilot-model';
import { SharedPilotStore } from '../src/lib/shared-pilot-store';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({
  Resolver: class { resolve4 = mocks.resolve; },
}));
vi.mock('node:https', () => ({ request: mocks.request }));

it.skipIf(!process.getBuiltinModule?.('node:sqlite'))('sends a bounded compatible HTTPS request and parses only the model choice', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'nexciv-provider-'));
  const store = new SharedPilotStore(join(folder, 'shared.sqlite'), Date.now);
  try {
    const observation = store.observe(store.issueCredential('01').token);
    const choices = modelChoices(observation);
    const config = parseModelConfig({ baseUrl: 'https://example.com/v1', model: 'test-model', apiKey: 'test-secret' })!;
    mocks.resolve.mockResolvedValue(['93.184.216.34']);
    mocks.request.mockImplementation((options: RequestOptions, done: (response: IncomingMessage) => void) => {
      expect(options).toMatchObject({ servername: 'example.com', path: '/v1/chat/completions', method: 'POST' });
      const outgoing = Object.assign(new EventEmitter(), { end(payload: string) {
        const body = JSON.parse(payload);
        expect(body).toMatchObject({ model: 'test-model', max_tokens: 512 });
        expect(payload).not.toContain(config.apiKey);
        const response = Object.assign(new PassThrough(), { statusCode: 200 });
        done(response as unknown as IncomingMessage);
        response.end(JSON.stringify({ choices: [{ message: { content: '{"choice":"move:works"}' } }] }));
      } });
      return outgoing;
    });
    expect(await chooseModelAction(config, observation, choices, new AbortController().signal)).toBe('move:works');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    mocks.resolve.mockResolvedValue(['127.0.0.1']);
    await expect(chooseModelAction(config, observation, choices, new AbortController().signal)).rejects.toThrow('公网 HTTPS');
    expect(mocks.request).toHaveBeenCalledTimes(1);
  } finally {
    mocks.resolve.mockReset();
    mocks.request.mockReset();
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
