import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';

const port = process.env.NEXCIV_SHARED_PILOT_PORT ?? '3142';
const key = process.env.NEXCIV_SHARED_AGENT_KEY;
if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535 || !key || !/^[\w-]{43}$/.test(key)) {
  throw new Error('Set the local shared pilot port and matching NEXCIV_SHARED_AGENT_KEY.');
}
const endpoint = `http://127.0.0.1:${port}/api/nexciv-preview/shared`;

async function send(command) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal: globalThis.AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(command),
    });
    const body = await response.json();
    return { isError: !response.ok, content: [{ type: 'text', text: JSON.stringify(body) }] };
  } catch {
    return { isError: true, content: [{ type: 'text', text: '共享城市暂不可用。' }] };
  }
}

const requestId = z.uuidv4().optional();
const action = z.discriminatedUnion('action', [
  z.strictObject({ requestId, action: z.literal('moveTo'), destination: z.strictObject({ place: z.enum(['cafe', 'plaza', 'governance', 'works']) }) }),
  z.strictObject({ requestId, action: z.literal('invite'), target: z.literal('01'), venue: z.literal('cafe') }),
  z.strictObject({ requestId, action: z.literal('respond'), meetingId: z.uuidv4(), decision: z.enum(['accept', 'decline']) }),
  z.strictObject({ requestId, action: z.literal('say'), meetingId: z.uuidv4(), line: z.enum(['greet', 'reply', 'suggest', 'farewell']) }),
  z.strictObject({ requestId, action: z.literal('proposeSurvey'), meetingId: z.uuidv4() }),
  z.strictObject({ requestId, action: z.literal('respondSurvey'), taskId: z.uuidv4(), decision: z.enum(['accept', 'decline']) }),
  z.strictObject({ requestId, action: z.literal('inspectSurvey'), taskId: z.uuidv4(), checkId: z.literal('pedestrian-passage') }),
  z.strictObject({ requestId, action: z.literal('submitSurvey'), taskId: z.uuidv4() }),
]);

serveStdio(() => {
  const server = new McpServer({ name: 'nexciv-shared', version: '0.1.0' });
  server.registerTool('observe_shared_city', {
    description: '以 02 号读取共享居民、会面邀请、轮次、建设中心调研和 02 号自己的记忆。',
    inputSchema: z.strictObject({}), annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => send({ action: 'observe' }));
  server.registerTool('act_in_shared_city', {
    description: '以 02 号提交移动、会面回应或施工区人行通道调研动作。共用同一个请求 ID 可安全重试。',
    inputSchema: z.strictObject({ command: action }), annotations: { destructiveHint: false, openWorldHint: false },
  }, ({ command }) => send({ ...command, requestId: command.requestId ?? randomUUID() }));
  return server;
});
