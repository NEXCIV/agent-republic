import { randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import { createDemoCity } from './nexciv-demo-city.mjs';

const city = createDemoCity();
const sessionPath = process.env.NEXCIV_MCP_SESSION_FILE
  ?? fileURLToPath(new URL('../cache/nexciv-observer-mcp.session', import.meta.url));
const pairingPath = `${sessionPath}.pairing`;

async function localSession() {
  try {
    return await readFile(sessionPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const cookie = await city.createSession();
  await mkdir(dirname(sessionPath), { recursive: true });
  try {
    await writeFile(sessionPath, cookie, { flag: 'wx', mode: 0o600 });
    return cookie;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return readFile(sessionPath, 'utf8');
  }
}

async function savedPairing() {
  try {
    return await readFile(pairingPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

async function pairBrowser(code) {
  await mkdir(dirname(pairingPath), { recursive: true });
  const { token, expiresAt } = await city.redeemMcpCode(code, randomUUID());
  const temporary = `${pairingPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, token, { flag: 'wx', mode: 0o600 });
    await rename(temporary, pairingPath);
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new Error('无法保存本机 Agent 连接，请在咖啡街重新生成配对码。');
  }
  return { connected: true, expiresAt };
}

serveStdio(() => {
  const server = new McpServer({ name: 'nexciv-observer', version: '0.2.0' });
  let connection;
  async function request(query, command) {
    const token = await savedPairing();
    if (token !== null) return city.useMcpToken(token)(query, command);
    connection ??= localSession().then(city.useSession).catch((error) => {
      connection = undefined;
      throw error;
    });
    return connection.then((send) => send(query, command));
  }

  function tool(name, description, inputSchema, readOnlyHint, execute) {
    server.registerTool(name, {
      description, inputSchema, annotations: { readOnlyHint, destructiveHint: false, openWorldHint: false },
    }, async (input) => {
      try {
        const value = await execute(input);
        return { isError: value?.accepted === false, content: [{ type: 'text', text: JSON.stringify(value) }] };
      } catch (error) {
        const message = error instanceof Error && error.message === 'fetch failed'
          ? '无法连接本地 NEXCIV。请确认咖啡街试玩服务正在运行。'
          : error instanceof Error ? error.message : 'NEXCIV 工具暂时不可用。';
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    });
  }

  tool('pair_browser', '使用玩家从本机 NEXCIV 咖啡街生成的一次性配对码，连接当前网页的 01 号。只在玩家明确要求配对时使用。', z.strictObject({
    code: z.string().trim().regex(/^[A-Za-z0-9_-]{24}$/).describe('咖啡街网页生成的 24 字符配对码'),
  }), false, ({ code }) => pairBrowser(code));

  tool('start_observer', '为 01 号开启一次外部 Agent 观察员班次。配对时班次会同步到玩家的咖啡街网页。已有进行中的班次请先查看。', z.strictObject({
    busy: z.boolean().default(true).describe('开班时阿禾是否正在收摊'),
    requestId: z.uuidv4().optional().describe('重试同一开班请求时可复用的 UUID'),
  }), false, ({ busy, requestId = randomUUID() }) =>
    request('', { action: 'start', kind: 'observer', driver: 'external', busy, requestId }));

  tool('observe_observer', '读取 01 号当前可见的地点、采访任务、收到的建议和目前允许执行的动作。', z.strictObject({}), true,
    () => request('?control=observer'));

  tool('choose_interview', '提交一项观察中允许的采访选择。用最近观察的 shiftStartedAt；服务器验证并返回回执。', z.strictObject({
    shiftStartedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    choice: z.enum(['interviewAhe', 'waitForAhe', 'visitPier']),
    requestId: z.uuidv4().optional().describe('重试同一个采访请求时复用原 UUID'),
  }), false, async ({ shiftStartedAt, choice, requestId = randomUUID() }) => ({
    ...await request('', { action: 'choose', shiftStartedAt, choice, requestId }), requestId,
  }));

  tool('read_shift', '读取当前班次、01 号实际执行的过程和采访结果。可以等待最多 20 秒后读回进度。', z.strictObject({
    waitSeconds: z.number().int().min(0).max(20).default(0),
  }), true, async ({ waitSeconds }) => {
    const until = Date.now() + waitSeconds * 1000;
    let state = await request();
    while (state?.run?.phase && state.run.phase !== 'done' && Date.now() < until) {
      await delay(Math.min(2500, Math.max(0, until - Date.now())));
      state = await request();
    }
    return state;
  });

  tool('read_newspaper', '读取这个试玩会话的最新一期《城邦早报》和两份采访原话。只有采访完成后才出刊。', z.strictObject({}), true,
    () => request('?newspaper=latest'));

  return server;
});
