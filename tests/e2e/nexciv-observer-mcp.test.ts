import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, it } from 'vitest';

it('binds MCP tools to one local demo session and rejects invalid tool input', async () => {
  const resident = 'nexciv_cafe_resident=12267b56-45c0-41e9-a75e-f3eab629eb02';
  const folder = mkdtempSync(join(tmpdir(), 'nexciv-mcp-'));
  const sessionFile = join(folder, 'session');
  let writes = 0;
  let initializations = 0;
  const api: Server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (!request.headers.cookie) {
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
      let body = '';
      for await (const part of request) body += String(part);
      const input = JSON.parse(body);
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
      'start_observer', 'observe_observer', 'choose_interview', 'read_shift', 'read_newspaper',
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
  } finally {
    await client?.close();
    await new Promise<void>((close) => api.close(() => close()));
    rmSync(sessionFile, { force: true });
    rmdirSync(folder);
  }
}, 20000);
