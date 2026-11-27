import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestOptions, IncomingMessage } from 'node:http';
import { expect, it, vi } from 'vitest';
import { chooseModelAction, modelChoices, parseModelConfig, parseModelDecision, SharedPilotModelRun } from '../src/lib/shared-pilot-model';
import { SharedPilotStore } from '../src/lib/shared-pilot-store';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({
  Resolver: class { resolve4 = mocks.resolve; },
}));
vi.mock('node:https', () => ({ request: mocks.request }));

it.skipIf(!process.getBuiltinModule?.('node:sqlite'))('sends bounded requests and lets the model answer actual dialogue', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'nexciv-provider-'));
  let at = Date.now();
  const store = new SharedPilotStore(join(folder, 'shared.sqlite'), () => at);
  try {
    const a = store.issueCredential('01').token;
    const b = store.issueCredential('02').token;
    const observation = store.observe(a);
    const choices = modelChoices(observation);
    const config = parseModelConfig({ baseUrl: 'https://example.com/v1', model: 'test-model', apiKey: 'test-secret' })!;
    const question = '你想去湖边看落日吗？';
    let answer: { choice: string; text?: string } = { choice: 'move:works' };
    mocks.resolve.mockResolvedValue(['93.184.216.34']);
    mocks.request.mockImplementation((options: RequestOptions, done: (response: IncomingMessage) => void) => {
      expect(options).toMatchObject({ servername: 'example.com', path: '/v1/chat/completions', method: 'POST' });
      const outgoing = Object.assign(new EventEmitter(), { end(payload: string) {
        const body = JSON.parse(payload);
        expect(body).toMatchObject({ model: 'test-model', max_tokens: 512 });
        expect(payload).not.toContain(config.apiKey);
        if (answer.text) expect(JSON.parse(body.messages[1].content))
          .toMatchObject({ meeting: { transcript: [{ residentId: '01', text: question }] } });
        const response = Object.assign(new PassThrough(), { statusCode: 200 });
        done(response as unknown as IncomingMessage);
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
      } });
      return outgoing;
    });
    expect(await chooseModelAction(config, observation, choices, new AbortController().signal)).toBe('move:works');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const { meetingId } = store.socialAction(a, { action: 'invite', requestId: randomUUID(), target: '02', venue: 'cafe' });
    store.socialAction(b, { action: 'respond', requestId: randomUUID(), meetingId, decision: 'accept' });
    const move = (token: string) => store.moveTo(token, { action: 'moveTo', requestId: randomUUID(), destination: { place: 'cafe' } });
    at = Math.max(move(a).arrivesAt, move(b).arrivesAt);
    at = store.observe(a).social.meeting!.nextTurnAt;
    store.socialAction(a, { action: 'say', requestId: randomUUID(), meetingId, text: question });
    at = store.observe(b).social.meeting!.nextTurnAt;
    const next = store.observe(b);
    const nextChoices = modelChoices(next);
    answer = { choice: nextChoices.find(({ speech }) => speech)!.id, text: '想去！我想看看水面上的倒影。' };
    expect(await chooseModelAction(config, next, nextChoices, new AbortController().signal)).toEqual(answer);
    expect(parseModelDecision(JSON.stringify({ ...answer, surveyIntent: 'accept' }), nextChoices)).toBeUndefined();
    expect(parseModelDecision(JSON.stringify({ ...answer, residentId: '01' }), nextChoices)).toBeUndefined();
    const run = new SharedPilotModelRun(config, () => store.observe(b), (command) => { store.socialAction(b, command); }, chooseModelAction);
    try {
      run.start();
      await vi.waitFor(() => expect(store.observe(a).social.meeting?.lines.at(-1))
        .toMatchObject({ residentId: '02', text: answer.text, source: 'agent' }));
    } finally { run.stop(); }
    mocks.resolve.mockResolvedValue(['127.0.0.1']);
    await expect(chooseModelAction(config, observation, choices, new AbortController().signal)).rejects.toThrow('公网 HTTPS');
    expect(mocks.request).toHaveBeenCalledTimes(3);
  } finally {
    mocks.resolve.mockReset();
    mocks.request.mockReset();
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
