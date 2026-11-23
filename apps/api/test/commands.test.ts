import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { worldFrameV1Schema } from '@agent-republic/domain';
import fixture from '../../../examples/world-frame.demo.json';
import { buildApiServer } from '../src/server.js';
import { CommandService, readCommandContext } from '../src/agents/commands.js';
import type { AgentConsoleView } from '../src/agents/agent-console.js';

const frame = worldFrameV1Schema.parse(fixture);
const actor: AgentConsoleView = {
  agentId: 'agent-01', owner: fixture.society.agentSummaries[0]!.owner, name: 'Ada',
  goal: 'EXPLORE_COALITIONS', persona: 'COOPERATIVE', status: 'ACTIVE', configVersion: 1,
  createdAt: frame.generatedAt, updatedAt: frame.generatedAt, versions: [], recentActions: [],
};
const verified = {
  hasAgentId: true, registered: true, build: 100n, rep: 0n, eligibleNow: true,
  networkBlockNumber: BigInt(frame.source.blockNumber) + 12n, blockHash: frame.source.blockHash,
};
const read = (state = verified, source = frame) => readCommandContext(
  actor, { getFrame: async () => source }, { readCommandIdentity: async () => state },
);
const request = { requestId: randomUUID(), mode: 'EXECUTE', text: '去中央广场' };

describe('owner command boundaries', () => {
  it.each(['GET', 'POST'] as const)('%s requires a session before accessing a private command', async (method) => {
    const app = buildApiServer({ reader: {} as never, chain: null, chainId: 56 });
    try {
      const response = await app.inject({ method, url: '/api/v1/my-agent/commands' });
      expect(response.statusCode).toBe(401);
    } finally { await app.close(); }
  });

  it('rejects oversized private command bodies without echoing the text', async () => {
    const app = buildApiServer({ reader: {} as never, chain: null, chainId: 56 });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/v1/my-agent/commands',
        payload: { ...request, text: 'privateDraft'.repeat(500) } });
      expect(response.statusCode).toBe(413);
      expect(response.payload).not.toContain('privateDraft');
    } finally { await app.close(); }
  });

  it.each([
    { ...verified, eligibleNow: false },
    { ...verified, registered: false },
    { ...verified, hasAgentId: false },
  ])('requires present and observed citizen rights', async (state) => {
    await expect(read(state)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a fork mismatch, an old head and recovery frames', async () => {
    await expect(read({ ...verified, blockHash: '0x' + 'f'.repeat(64) })).rejects.toMatchObject({ statusCode: 503 });
    await expect(read({ ...verified, networkBlockNumber: verified.networkBlockNumber + 900n })).rejects.toMatchObject({ statusCode: 503 });
    await expect(read({ ...verified, networkBlockNumber: BigInt(frame.source.blockNumber) })).rejects.toMatchObject({ statusCode: 503 });
    await expect(read(verified, { ...frame, source: { ...frame.source, sync: 'REORG_RECOVERY' } })).rejects.toMatchObject({ statusCode: 503 });
  });

  it('rejects injected identity before planning and blocks commands to a paused agent', async () => {
    const store = { submit: vi.fn(), findRequest: async () => null };
    const observe = vi.fn();
    const commands = new CommandService({ getView: async () => ({ ...actor, status: 'PAUSED' }) }, store as never, observe);
    await expect(commands.submit('user', { ...request, owner: actor.owner })).rejects.toMatchObject({ statusCode: 400 });
    await expect(commands.submit('user', request)).rejects.toMatchObject({ statusCode: 409 });
    expect(observe).not.toHaveBeenCalled();
    expect(store.submit).not.toHaveBeenCalled();
  });

  it('stops before reporting results based on an orphaned block', async () => {
    const observation = await read();
    const scope = { appUserId: 'user', agentId: actor.agentId, owner: actor.owner, configVersion: 1 };
    const advance = vi.fn();
    const store = {
      pending: async () => [{ scope, commandId: 'command', expectedRevision: 2,
        sourceBlock: (BigInt(frame.source.blockNumber) - 1n).toString(), sourceBlockHash: '0x' + 'f'.repeat(64) }],
      advance,
    };
    const commands = new CommandService({ getView: async () => actor }, store as never,
      async () => observation, undefined, async () => '0x' + 'b'.repeat(64));
    const onError = vi.fn();
    await commands.dispatch(onError);
    expect(onError).not.toHaveBeenCalled();
    const change = advance.mock.calls[0]?.[2];
    expect(change({})).toMatchObject({ status: 'FAILED', report: expect.stringMatching(/reorganized/) });
  });
});
