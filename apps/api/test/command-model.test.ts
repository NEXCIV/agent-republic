import { describe, expect, it, vi } from 'vitest';
import { LocalCommandModel } from '../src/agents/command-model.js';

const call = { agentId: 'actor', requestKey: 'plan:request', kind: 'MAIN_DECISION' as const };
const prompt = { system: 'Plan', user: 'visit the plaza' };
const json = (value: unknown) => new Response(JSON.stringify(value));
const local = { model_info: { 'general.architecture': 'llama' } };

describe('optional local command model', () => {
  it('never transmits a command to a cloud-backed model or without quota', async () => {
    const remote = vi.fn(async () => json({ ...local, remote_host: 'https://example.invalid' }));
    const reserve = vi.fn(async () => false);
    expect(await new LocalCommandModel('test', 10, reserve, remote).complete(call, prompt)).toBeNull();
    expect(remote).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(remote.mock.calls)).not.toContain(prompt.user);
    const fetchLocal = vi.fn(async () => json(local));
    expect(await new LocalCommandModel('test', 10, reserve, fetchLocal).complete(call, prompt)).toBeNull();
    expect(fetchLocal).toHaveBeenCalledTimes(1);
  });

  it('bounds prompt bytes, generation length and ignores partial responses', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(local))
      .mockResolvedValueOnce(json({ done: false, message: { content: '{}' } }));
    const reserve = vi.fn(async () => true);
    const model = new LocalCommandModel('installed-model', 10, reserve, transport);
    expect(await model.complete(call, { system: 'a', user: '中'.repeat(600) })).toBeNull();
    expect(reserve).not.toHaveBeenCalled();
    expect(await model.complete(call, prompt)).toBeNull();
    expect(reserve).toHaveBeenCalledOnce();
    expect(JSON.parse(String(transport.mock.calls[1]?.[1]?.body))).toMatchObject({
      stream: false, format: 'json', options: { num_predict: 500 },
    });
  });
});
