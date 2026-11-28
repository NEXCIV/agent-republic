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
const noteActivities = [
  z.strictObject({ requestId, action: z.literal('moveTo'), destination: z.strictObject({ place: z.enum(['cafe', 'plaza', 'governance', 'works', 'pier', 'forum']) }) }),
  z.strictObject({ requestId, action: z.literal('invite'), target: z.enum(['01', '02']), venue: z.literal('cafe') }),
  z.strictObject({ requestId, action: z.literal('orderCoffee'), drink: z.enum(['flat-white', 'americano']) }),
  z.strictObject({ requestId, action: z.literal('inspectWorks'), checkId: z.enum(['entrance-path', 'pedestrian-passage']) }),
  z.strictObject({ requestId, action: z.literal('goFishing') }),
  z.strictObject({ requestId, action: z.literal('restAtBench'), benchId: z.literal('cafe.bench') }),
];
const action = z.union([
  ...noteActivities,
  z.strictObject({ requestId, action: z.literal('respond'), meetingId: z.uuidv4(), decision: z.enum(['accept', 'decline']) }),
  z.strictObject({ requestId, action: z.literal('say'), meetingId: z.uuidv4(),
    text: z.string().trim().min(1).max(120).describe('根据会面和之前实际说过的话现场写一句'),
    surveyIntent: z.enum(['propose', 'accept', 'decline']).optional().describe('只有实际提出、接受或婉拒共同调研时才填写') }),
  z.strictObject({ requestId, action: z.literal('say'), meetingId: z.uuidv4(), line: z.enum(['greet', 'reply', 'suggest', 'farewell']).describe('旧客户端台词键。新发言使用 text。') }),
  z.strictObject({ requestId, action: z.literal('proposeSurvey'), meetingId: z.uuidv4() }),
  z.strictObject({ requestId, action: z.literal('respondSurvey'), taskId: z.uuidv4(), decision: z.enum(['accept', 'decline']) }),
  z.strictObject({ requestId, action: z.literal('inspectSurvey'), taskId: z.uuidv4(), checkId: z.enum(['entrance-path', 'pedestrian-passage']) }),
  z.strictObject({ requestId, action: z.literal('submitSurvey'), taskId: z.uuidv4() }),
  z.strictObject({ action: z.literal('acceptWorksGoal'), taskId: z.uuidv4() }),
  z.strictObject({ action: z.literal('askWorksGoal'), taskId: z.uuidv4() }),
  z.strictObject({ action: z.literal('inspectWorksGoal'), taskId: z.uuidv4(), checkId: z.enum(['entrance-path', 'pedestrian-passage']) }),
  z.strictObject({ requestId, action: z.literal('exploreSite'), place: z.enum(['cafe', 'works', 'pier']),
    text: z.string().trim().min(1).max(38) }),
  z.strictObject({ requestId, action: z.literal('exploreArrival'), activity: z.enum(['ask', 'look']),
    text: z.string().trim().min(1).max(38) }),
  z.strictObject({ requestId, action: z.literal('readCouncilNotice') }),
  z.strictObject({ requestId, action: z.literal('respondTheatre'), revision: z.number().int().min(0).max(10),
    decision: z.enum(['propose', 'counter', 'accept', 'decline', 'attend', 'skip', 'feedback']),
    slot: z.enum(['early', 'late']).optional(), cue: z.enum(['shoreline', 'water', 'finale']).optional(),
    response: z.enum(['keep', 'adjust']).optional() }),
]);
const noteReply = { noteId: z.uuidv4(), reason: z.string().trim().min(1).max(120) };
const resolution = z.union([
  z.strictObject({ ...noteReply, decision: z.literal('skipped') }),
  z.strictObject({ ...noteReply, decision: z.enum(['adopted', 'adapted']), activity: z.union(noteActivities) }),
]);

serveStdio(() => {
  const server = new McpServer({ name: 'nexciv-shared', version: '0.8.0' });
  server.registerTool('observe_shared_city', {
    description: '读取本居民的附近、纸条、行程和城市状态。council 显示议事公告与阅读记录。theatre 提供场次、revision 及按居民列出的可选动作。',
    inputSchema: z.strictObject({}), annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => send({ action: 'observe' }));
  server.registerTool('act_in_shared_city', {
    description: '以授权居民行动。readCouncilNotice 前往公告栏阅读。respondTheatre 用最新 revision、decision 和场次选项协商或决定是否观演。网页调研使用 pendingWorksGoal 返回的任务。',
    inputSchema: z.strictObject({ command: action }), annotations: { destructiveHint: false, openWorldHint: false },
  }, ({ command }) => send('requestId' in command ? { ...command, requestId: command.requestId ?? randomUUID() }
    : command.action.endsWith('WorksGoal') ? command : { ...command, requestId: randomUUID() }));
  server.registerTool('resolve_player_note', {
    description: '根据自身处境采纳、调整或略过本居民的一张纸条。采纳或调整时在本次请求里提交一个城市动作。原因只显示给玩家和本居民的 Agent。',
    inputSchema: z.strictObject({ reply: resolution }), annotations: { destructiveHint: false, openWorldHint: false },
  }, ({ reply }) => send(reply.decision === 'skipped' ? { action: 'resolvePlayerNote', ...reply }
    : { ...reply, action: 'resolvePlayerNote', activity: { ...reply.activity, requestId: reply.activity.requestId ?? reply.noteId } }));
  server.registerTool('ask_cafe_vendor', {
    description: '询问咖啡摊主菜单、排队情况和附近休息地点。',
    inputSchema: z.strictObject({ question: z.string().trim().min(1).max(120) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ question }) => send({ action: 'cafeTalk', question }));
  server.registerTool('ask_works_manager', {
    description: '到公共建设中心后，询问现场管理员当前可领的巡查点、路线或等候区。',
    inputSchema: z.strictObject({ question: z.string().trim().min(1).max(120) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ question }) => send({ action: 'worksTalk', question }));
  server.registerTool('ask_pier_angler', {
    description: '到北岸码头后，询问钓客钓位、等候情况或钓鱼方法。',
    inputSchema: z.strictObject({ question: z.string().trim().min(1).max(120) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ question }) => send({ action: 'fishingTalk', question }));
  return server;
});
