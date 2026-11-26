import { createServer, type Server } from 'node:http';
import { mkdtempSync, readdirSync, rmdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, it } from 'vitest';

it('binds MCP tools to one local demo session and rejects invalid tool input', async () => {
  const resident = 'nexciv_cafe_resident=12267b56-45c0-41e9-a75e-f3eab629eb02';
  const folder = mkdtempSync(join(tmpdir(), 'nexciv-mcp-'));
  const sessionFile = join(folder, 'session');
  const token = `nxc_mcp_${'a'.repeat(43)}`;
  const code = 'A'.repeat(24);
  let writes = 0;
  let initializations = 0;
  let redeemed = false;
  let revoked = false;
  const api: Server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    let input;
    if (request.method === 'POST') {
      let body = '';
      for await (const part of request) body += String(part);
      input = JSON.parse(body);
    }
    if (input?.action === 'redeemMcpCode' && !request.headers.cookie && !request.headers.authorization) {
      if (redeemed || input.code !== code) {
        response.writeHead(410).end(JSON.stringify({ error: '配对码已使用或过期。' }));
        return;
      }
      redeemed = true;
      response.end(JSON.stringify({ token, expiresAt: 100000 }));
      return;
    }
    if (request.headers.authorization) {
      if (request.headers.authorization !== `Bearer ${token}` || request.headers.cookie || revoked) {
        response.writeHead(401).end(JSON.stringify({ error: '连接已断开。' }));
        return;
      }
      response.end(JSON.stringify({ run: { phase: 'briefing' } }));
      return;
    }
    if (!request.headers.cookie && request.method === 'GET') {
      initializations++;
      response.setHeader('Set-Cookie', resident);
      response.end('null');
      return;
    }
    if (request.headers.cookie !== resident || request.url?.split('?')[0] !== '/api/nexciv-preview/cafe') {
      response.writeHead(403).end('{}');
      return;
    }
    if (request.method === 'POST') {
      writes++;
      response.end(JSON.stringify({ accepted: input.action === 'choose' && input.choice === 'visitPier', run: { phase: 'toPier' } }));
    } else {
      response.end(JSON.stringify({ actions: ['visitPier'], shiftStartedAt: 1000 }));
    }
  });
  await new Promise<void>((listen) => api.listen(0, '127.0.0.1', listen));
  const address = api.address();
  if (!address || typeof address === 'string') throw new Error('No local mock NEXCIV endpoint');

  async function connect() {
    const client = new Client({ name: 'nexciv-test', version: '1' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('scripts/nexciv-observer-mcp.mjs')],
      env: { NEXCIV_DEMO_URL: `http://127.0.0.1:${address.port}`, NEXCIV_MCP_SESSION_FILE: sessionFile },
    });
    await client.connect(transport);
    return client;
  }

  let client: Client | undefined;
  try {
    client = await connect();
    expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
      'pair_browser', 'start_observer', 'observe_observer', 'choose_interview', 'read_shift', 'read_newspaper',
    ]);
    const observation = await client.callTool({ name: 'observe_observer', arguments: {} });
    expect(JSON.stringify(observation)).toContain('visitPier');
    expect(JSON.stringify(observation)).not.toContain(resident);
    const invalid = await client.callTool({ name: 'choose_interview', arguments: { choice: 'castVote', shiftStartedAt: 1000 } });
    expect(invalid.isError).toBe(true);
    expect(writes).toBe(0);
    await client.close();
    client = await connect();
    const accepted = await client.callTool({ name: 'choose_interview', arguments: { choice: 'visitPier', shiftStartedAt: 1000 } });
    expect(JSON.stringify(accepted)).toContain('toPier');
    expect(initializations).toBe(1);
    expect(writes).toBe(1);

    const paired = await client.callTool({ name: 'pair_browser', arguments: { code } });
    expect(JSON.stringify(paired)).toContain('expiresAt');
    expect(JSON.stringify(paired)).not.toContain(token);
    expect((await client.callTool({ name: 'pair_browser', arguments: { code } })).isError).toBe(true);
    await client.close();
    client = await connect();
    expect(JSON.stringify(await client.callTool({ name: 'read_shift', arguments: {} }))).toContain('briefing');
    revoked = true;
    expect((await client.callTool({ name: 'read_shift', arguments: {} })).isError).toBe(true);
    expect(initializations).toBe(1);
  } finally {
    await client?.close();
    await new Promise<void>((close) => api.close(() => close()));
    for (const file of readdirSync(folder)) rmSync(join(folder, file), { force: true });
    rmdirSync(folder);
  }
}, 20000);
