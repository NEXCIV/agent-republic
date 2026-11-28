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
const action = z.union([
  z.strictObject({ requestId, action: z.literal('moveTo'), destination: z.strictObject({ place: z.enum(['cafe', 'plaza', 'governance', 'works']) }) }),
  z.strictObject({ requestId, action: z.literal('invite'), target: z.enum(['01', '02']), venue: z.literal('cafe') }),
  z.strictObject({ requestId, action: z.literal('respond'), meetingId: z.uuidv4(), decision: z.enum(['accept', 'decline']) }),
  z.strictObject({ requestId, action: z.literal('say'), meetingId: z.uuidv4(),
    text: z.string().trim().min(1).max(120).describe('根据会面和之前实际说过的话现场写一句'),
    surveyIntent: z.enum(['propose', 'accept', 'decline']).optional().describe('只有实际提出、接受或婉拒共同调研时才填写') }),
  z.strictObject({ requestId, action: z.literal('say'), meetingId: z.uuidv4(), line: z.enum(['greet', 'reply', 'suggest', 'farewell']).describe('旧客户端台词键。新发言使用 text。') }),
  z.strictObject({ requestId, action: z.literal('proposeSurvey'), meetingId: z.uuidv4() }),
  z.strictObject({ requestId, action: z.literal('respondSurvey'), taskId: z.uuidv4(), decision: z.enum(['accept', 'decline']) }),
  z.strictObject({ requestId, action: z.literal('inspectSurvey'), taskId: z.uuidv4(), checkId: z.enum(['entrance-path', 'pedestrian-passage']) }),
  z.strictObject({ requestId, action: z.literal('submitSurvey'), taskId: z.uuidv4() }),
  z.strictObject({ requestId, action: z.literal('orderCoffee'), drink: z.enum(['flat-white', 'americano']) }),
]);

serveStdio(() => {
  const server = new McpServer({ name: 'nexciv-shared', version: '0.3.0' });
  server.registerTool('observe_shared_city', {
    description: '读取授权居民的位置、会面、调研和咖啡摊队伍。会面中参考 nextSpeaker 和 nextTurnAt。',
    inputSchema: z.strictObject({}), annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => send({ action: 'observe' }));
  server.registerTool('act_in_shared_city', {
    description: '以授权居民提交移动、点咖啡、发言或调研动作。点单后沿路走到咖啡摊，按到店顺序排队。使用相同的请求 ID 重试同一动作。',
    inputSchema: z.strictObject({ command: action }), annotations: { destructiveHint: false, openWorldHint: false },
  }, ({ command }) => send({ ...command, requestId: command.requestId ?? randomUUID() }));
  server.registerTool('ask_cafe_vendor', {
    description: '询问咖啡摊主菜单、排队情况和附近休息地点。',
    inputSchema: z.strictObject({ question: z.string().trim().min(1).max(120) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ question }) => send({ action: 'cafeTalk', question }));
  return server;
});
