import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const port = process.env.NEXCIV_SHARED_PILOT_PORT ?? '3142';
const key = process.env.NEXCIV_SHARED_AGENT_KEY;
if (!key || !/^[\w-]{43}$/.test(key)) throw new Error('请先在「角色与接入」生成 MCP 凭据并设置 NEXCIV_SHARED_AGENT_KEY。');

const stop = new globalThis.AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
const client = new Client({ name: 'nexciv-works-agent', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./nexciv-shared-mcp.mjs', import.meta.url))],
  env: { NEXCIV_SHARED_PILOT_PORT: port, NEXCIV_SHARED_AGENT_KEY: key },
});

async function tool(name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, { signal: stop.signal });
  const content = result.content?.find(item => item.type === 'text')?.text;
  if (!content?.startsWith('{')) return { error: '共享城市暂未响应。' };
  const value = JSON.parse(content);
  return result.isError ? { error: value.error ?? '共享城市暂未响应。' } : value;
}

function choose(goal) {
  const { taskId, availableActions, openCheckIds, managerReply } = goal;
  if (availableActions.includes('acceptWorksGoal')) return { action: 'acceptWorksGoal', taskId };
  if (openCheckIds.length < 2 && !managerReply && availableActions.includes('askWorksGoal')) {
    return { action: 'askWorksGoal', taskId };
  }
  if (openCheckIds.length && availableActions.includes('inspectWorksGoal')) {
    return { action: 'inspectWorksGoal', taskId, checkId: openCheckIds[0] };
  }
  return null;
}

const describe = {
  acceptWorksGoal: '已接手网页调研，前往公共建设中心。',
  askWorksGoal: '已询问现场管理员。',
  inspectWorksGoal: '已选择可用点位，开始巡查。',
};
let announced;
let lastError;
try {
  await client.connect(transport);
  while (!stop.signal.aborted) {
    const state = await tool('observe_shared_city');
    if (state.error?.includes('凭据无效') || state.error?.includes('登录已过期')) {
      console.error('MCP 凭据已失效。请在「角色与接入」生成新凭据后重新连接。');
      process.exitCode = 1;
      break;
    }
    if (state.viewerResidentId && state.viewerResidentId !== announced) {
      announced = state.viewerResidentId;
      console.log(`${announced} 号 MCP Agent 已连接，等待网页调研目标。`);
    }
    const command = state.pendingWorksGoal && choose(state.pendingWorksGoal);
    const result = command && await tool('act_in_shared_city', { command });
    const error = result?.error ?? state.error;
    if (error && error !== lastError) console.error(error);
    if (command && result && !result.error) console.log(describe[command.action]);
    lastError = error;
    await setTimeout(1000, undefined, { signal: stop.signal });
  }
} catch (error) {
  if (!stop.signal.aborted) {
    console.error(error instanceof Error ? error.message : 'MCP 未能连接。');
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
