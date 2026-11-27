import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { SHARED_PILOT_RESIDENT_IDS, sharedPilotMoveRequestSchema, sharedPilotSocialRequestSchema, sharedPilotSurveyRequestSchema, type SharedPilotResidentId } from '@agent-republic/domain';
import { SharedPilotRuntime, type SharedAgentCommand } from '../../../../lib/shared-pilot-runtime';
import { SharedPilotError } from '../../../../lib/shared-pilot-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const state = globalThis as typeof globalThis & { nexcivSharedPilot?: { file: string; external: string; runtime: SharedPilotRuntime } };
const loopback = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;
const keyPattern = /^[A-Za-z0-9_-]{43}$/;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function localRequest(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  return loopback.test(host) && (!request.headers.has('x-forwarded-host') || loopback.test(request.headers.get('x-forwarded-host') ?? ''))
    && !['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') ?? '');
}

function configuredFile() {
  const file = process.env.NEXCIV_SHARED_PILOT_DB;
  return process.env.NODE_ENV !== 'production' && file && path.isAbsolute(file) && path.extname(file).toLowerCase() === '.sqlite' ? path.resolve(file) : undefined;
}

function agentKeys() {
  const first = process.env.NEXCIV_SHARED_AGENT_01_KEY || undefined;
  const second = process.env.NEXCIV_SHARED_AGENT_02_KEY || process.env.NEXCIV_SHARED_AGENT_KEY || undefined;
  if ((first && !keyPattern.test(first)) || (second && !keyPattern.test(second)) || (first && first === second)) return null;
  return { '01': first, '02': second };
}

function pilotFor(file: string, externalResidents: readonly SharedPilotResidentId[]) {
  const external = externalResidents.join(',');
  if (!state.nexcivSharedPilot || state.nexcivSharedPilot.file !== file || state.nexcivSharedPilot.external !== external
    || !(state.nexcivSharedPilot.runtime instanceof SharedPilotRuntime)) {
    state.nexcivSharedPilot?.runtime.close();
    state.nexcivSharedPilot = undefined;
    const pilot = new SharedPilotRuntime(file, Date.now, true, externalResidents);
    pilot.start();
    state.nexcivSharedPilot = { file, external, runtime: pilot };
  }
  return state.nexcivSharedPilot.runtime;
}

export function GET(request: NextRequest) {
  if (!localRequest(request)) return json({ error: '共享试玩仅允许本机查看。' }, 403);
  const file = configuredFile();
  if (!file) return json({ error: '本机共享试玩尚未启动。' }, 404);
  const keys = agentKeys();
  if (!keys) return json({ error: '共享 Agent 凭据配置无效。' }, 503);
  try {
    return json(pilotFor(file, SHARED_PILOT_RESIDENT_IDS.filter((id) => keys[id])).snapshot());
  } catch {
    return json({ error: '共享城市暂不可用，请确认本机试验配置。' }, 503);
  }
}

async function readCommand(request: NextRequest): Promise<SharedAgentCommand | undefined> {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json' || !request.body) return;
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) { await reader.cancel(); return; }
      text += decoder.decode(value, { stream: true });
    }
    const body: unknown = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== 'object') return;
    if ('action' in body && body.action === 'observe' && Object.keys(body).length === 1) return { action: 'observe' };
    for (const schema of [sharedPilotMoveRequestSchema, sharedPilotSocialRequestSchema, sharedPilotSurveyRequestSchema]) {
      const parsed = schema.safeParse(body);
      if (parsed.success) return parsed.data;
    }
  } catch {
    return;
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: NextRequest) {
  if (!localRequest(request) || request.headers.has('origin') || request.headers.has('sec-fetch-site')) {
    return json({ error: '此动作仅供本机 Agent 客户端。' }, 403);
  }
  const file = configuredFile();
  if (!file) return json({ error: '共享 Agent 接入未启用。' }, 404);
  const keys = agentKeys();
  if (!keys) return json({ error: '共享 Agent 凭据配置无效。' }, 503);
  const externalResidents = SHARED_PILOT_RESIDENT_IDS.filter((id) => keys[id]);
  if (!externalResidents.length) return json({ error: '共享 Agent 接入未启用。' }, 404);
  const supplied = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const residentId = supplied && externalResidents.find((id) => timingSafeEqual(Buffer.from(keys[id]!), Buffer.from(supplied)));
  if (!residentId) return json({ error: '共享 Agent 凭据无效。' }, 401);
  const command = await readCommand(request);
  if (!command) return json({ error: '共享 Agent 动作无效。' }, 400);
  try {
    return json(pilotFor(file, externalResidents).actAsExternal(residentId, command));
  } catch (error) {
    if (error instanceof SharedPilotError) return json({ error: error.message, code: error.code }, 409);
    return json({ error: '共享 Agent 服务暂不可用。' }, 503);
  }
}
