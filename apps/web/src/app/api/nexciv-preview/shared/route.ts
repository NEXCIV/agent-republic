import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { SHARED_PILOT_RESIDENT_IDS, sharedPilotMoveRequestSchema, sharedPilotSocialRequestSchema, sharedPilotSurveyRequestSchema, type SharedPilotResidentId } from '@agent-republic/domain';
import { SharedPilotRuntime, type SharedAgentCommand } from '../../../../lib/shared-pilot-runtime';
import { SharedPilotError } from '../../../../lib/shared-pilot-store';
import { SHARED_PILOT_NAME, SHARED_PILOT_SECRET, SHARED_PILOT_SESSION_SECONDS, isSharedPilotAvatar } from '../../../../lib/shared-pilot-profiles';
import { parseModelConfig } from '../../../../lib/shared-pilot-model';
import { cafeTalkSchema, orderCoffeeSchema } from '../../../../lib/shared-pilot-cafe';
import { cancelWorksGoalSchema, inspectWorksSchema, surveyWorksSiteSchema, worksGoalActionSchema, worksTalkSchema } from '../../../../lib/shared-pilot-works';
import { fishingTalkSchema, goFishingSchema } from '../../../../lib/shared-pilot-fishing';
import { explorationActionSchema } from '../../../../lib/shared-pilot-exploration';
import { resolvePlayerNoteSchema, submitPlayerNoteSchema } from '../../../../lib/shared-pilot-notes';
import { benchRestSchema } from '../../../../lib/shared-pilot-bench';
import { councilReadSchema, sharedTheatreSchema } from '../../../../lib/shared-pilot-civic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Preserve running agents across development route recompilation. Bump when
// the in-memory runtime contract changes.
const PILOT_RUNTIME_VERSION = 16;
const state = globalThis as typeof globalThis & { nexcivSharedPilot?: { version: number; file: string; external: string; runtime: SharedPilotRuntime } };
const loopback = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;
const profileCookie = 'nexciv_shared_profile';

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

function connections() {
  const keys = { '01': process.env.NEXCIV_SHARED_AGENT_01_KEY,
    '02': process.env.NEXCIV_SHARED_AGENT_02_KEY || process.env.NEXCIV_SHARED_AGENT_KEY };
  const values = Object.values(keys).filter((value): value is string => Boolean(value));
  if (new Set(values).size !== values.length || values.some((value) => !SHARED_PILOT_SECRET.test(value))) return null;
  return {
    keys,
    externalResidents: SHARED_PILOT_RESIDENT_IDS.filter((id) => keys[id]),
    profileResidents: SHARED_PILOT_RESIDENT_IDS.filter((id) => !keys[id]),
  };
}

function matches(expected: string | undefined, supplied: string) {
  return expected && timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

function pilotFor(file: string, externalResidents: readonly SharedPilotResidentId[]) {
  const external = externalResidents.join(',');
  if (!state.nexcivSharedPilot || state.nexcivSharedPilot.file !== file || state.nexcivSharedPilot.external !== external
    || state.nexcivSharedPilot.version !== PILOT_RUNTIME_VERSION) {
    state.nexcivSharedPilot?.runtime.close();
    state.nexcivSharedPilot = undefined;
    const pilot = new SharedPilotRuntime(file, Date.now, true, externalResidents);
    pilot.start();
    state.nexcivSharedPilot = { version: PILOT_RUNTIME_VERSION, file, external, runtime: pilot };
  }
  return state.nexcivSharedPilot.runtime;
}

export function GET(request: NextRequest) {
  if (!localRequest(request)) return json({ error: '共享试玩仅允许本机查看。' }, 403);
  const file = configuredFile();
  if (!file) return json({ error: '本机共享试玩尚未启动。' }, 404);
  const config = connections();
  if (!config) return json({ error: '共享 Agent 凭据配置无效。' }, 503);
  const profile = request.nextUrl.searchParams.get('profile') === '1';
  if (profile && !config.profileResidents.length) return json({ error: '本机试玩名额已分配给测试 Agent。' }, 409);
  try {
    const pilot = pilotFor(file, config.externalResidents);
    const session = request.cookies.get(profileCookie)?.value;
    if (profile) {
      const view = pilot.profile(session ?? '');
      if (!view.profile || !config.profileResidents.includes(view.profile.residentId)) return json({ profile: null, hasKey: false, modelRun: null, mcpConnected: false });
      return json({ ...view, ...pilot.modelProfile(view.profile.residentId), mcpScript: path.resolve(process.cwd(), '../../scripts/nexciv-shared-mcp.mjs') });
    }
    const resident = session && config.profileResidents.length ? pilot.profile(session).profile?.residentId : undefined;
    const ownResidentId = resident && config.profileResidents.includes(resident) ? resident : null;
    return json({ ...pilot.snapshot(), profilesEnabled: config.profileResidents.length > 0,
      ownResidentId, ownModelRun: ownResidentId ? pilot.modelProfile(ownResidentId).modelRun : null,
      ownNotes: ownResidentId ? pilot.profileNotes(session!, config.profileResidents) : [] });
  } catch {
    return json({ error: '共享城市暂不可用，请确认本机试验配置。' }, 503);
  }
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | undefined> {
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
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    return;
  } finally {
    reader.releaseLock();
  }
}

function readCommand(body: Record<string, unknown> | undefined): SharedAgentCommand | undefined {
  if (!body) return;
  if (body.action === 'observe' && Object.keys(body).length === 1) return { action: 'observe' };
  for (const schema of [sharedPilotMoveRequestSchema, sharedPilotSocialRequestSchema, sharedPilotSurveyRequestSchema,
    orderCoffeeSchema, cafeTalkSchema, inspectWorksSchema, worksTalkSchema, worksGoalActionSchema, goFishingSchema, fishingTalkSchema, explorationActionSchema,
    resolvePlayerNoteSchema, benchRestSchema, councilReadSchema, sharedTheatreSchema]) {
    const parsed = schema.safeParse(body);
    if (parsed.success) return parsed.data;
  }
}

async function changeProfile(request: NextRequest, file: string, config: NonNullable<ReturnType<typeof connections>>) {
  const origin = `${request.nextUrl.protocol}//${request.headers.get('host')}`;
  if (request.headers.get('origin') !== origin) return json({ error: '请从当前本机城市页面操作。' }, 403);
  const body = await readBody(request);
  if (!body) return json({ error: '角色操作无效。' }, 400);
  const session = request.cookies.get(profileCookie)?.value ?? '';
  const pilot = pilotFor(file, config.externalResidents);
  const note = submitPlayerNoteSchema.safeParse(body);
  if (note.success) return json(pilot.submitPlayerNote(session, config.profileResidents, note.data));
  const read = councilReadSchema.safeParse(body);
  if (read.success) return json(pilot.readCouncilNotice(session, config.profileResidents, read.data));
  const show = sharedTheatreSchema.safeParse(body);
  if (show.success) return json(pilot.theatreAction(session, config.profileResidents, show.data));
  const chat = cafeTalkSchema.safeParse(body);
  if (chat.success) return json(pilot.cafeTalk(chat.data.question));
  const coffee = orderCoffeeSchema.safeParse(body);
  if (coffee.success) return json(pilot.orderCoffee(session, config.profileResidents, coffee.data));
  const worksChat = worksTalkSchema.safeParse(body);
  if (worksChat.success) return json(pilot.worksTalk(worksChat.data.question));
  const inspection = inspectWorksSchema.safeParse(body);
  if (inspection.success) return json(pilot.requestInspection(session, config.profileResidents, inspection.data));
  const siteGoal = surveyWorksSiteSchema.safeParse(body);
  if (siteGoal.success) return json(pilot.startWorksBrief(session, config.profileResidents, siteGoal.data));
  const cancel = cancelWorksGoalSchema.safeParse(body);
  if (cancel.success) return json(pilot.cancelWorksGoal(session, config.profileResidents, cancel.data));
  const angler = fishingTalkSchema.safeParse(body);
  if (angler.success) return json(pilot.fishingTalk(angler.data.question));
  const fishing = goFishingSchema.safeParse(body);
  if (fishing.success) return json(pilot.goFishing(session, config.profileResidents, fishing.data));
  if (!config.profileResidents.length) return json({ error: '本机试玩名额已分配给测试 Agent。' }, 409);
  if (body.action === 'claim') {
    const name = typeof body.name === 'string' ? body.name.normalize('NFC').trim() : '';
    const { avatar } = body;
    if (Object.keys(body).length !== 3 || !SHARED_PILOT_NAME.test(name) || !isSharedPilotAvatar(avatar)) {
      return json({ error: '请填写角色名并选择外观。' }, 400);
    }
    const claimed = pilot.claimProfile({ name, avatar }, config.profileResidents, session);
    const response = json({ profile: claimed.profile, hasKey: claimed.hasKey, ...pilot.modelProfile(claimed.profile.residentId),
      mcpScript: path.resolve(process.cwd(), '../../scripts/nexciv-shared-mcp.mjs') }, 201);
    response.cookies.set(profileCookie, claimed.session, {
      httpOnly: true, sameSite: 'strict', secure: request.nextUrl.protocol === 'https:',
      path: '/api/nexciv-preview/shared', maxAge: SHARED_PILOT_SESSION_SECONDS,
    });
    return response;
  }
  if (Object.keys(body).length === 1 && (body.action === 'issue' || body.action === 'revoke')) {
    return json(pilot.setProfileKey(session, body.action === 'issue', config.profileResidents));
  }
  if (body.action === 'startModel' && Object.keys(body).length === 4) {
    const modelConfig = parseModelConfig(body);
    if (!modelConfig) return json({ error: '请填写有效的公网 HTTPS API 地址、模型名称和 API Key。' }, 400);
    return json(pilot.startModel(session, config.profileResidents, modelConfig));
  }
  if (body.action === 'stopModel' && Object.keys(body).length === 1) {
    return json(pilot.stopModel(session, config.profileResidents));
  }
  return json({ error: '角色操作无效。' }, 400);
}

export async function POST(request: NextRequest) {
  const profile = request.nextUrl.searchParams.get('profile') === '1';
  if (!localRequest(request) || (!profile && (request.headers.has('origin') || request.headers.has('sec-fetch-site')))) {
    return json({ error: '此动作仅供本机 Agent 客户端。' }, 403);
  }
  const file = configuredFile();
  if (!file) return json({ error: '共享 Agent 接入未启用。' }, 404);
  const config = connections();
  if (!config) return json({ error: '共享 Agent 凭据配置无效。' }, 503);
  try {
    if (profile) return await changeProfile(request, file, config);
    const supplied = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!supplied) return json({ error: '共享 Agent 凭据无效。' }, 401);
    const residentId = config.externalResidents.find((id) => matches(config.keys[id], supplied));
    if (!residentId && !config.profileResidents.length) return json({ error: '共享 Agent 凭据无效。' }, 401);
    const pilot = pilotFor(file, config.externalResidents);
    const body = await readBody(request);
    const command = readCommand(body);
    if (!command) return json({ error: '共享 Agent 动作无效。' }, 400);
    return json(residentId ? pilot.actAsExternal(residentId, command) : pilot.actWithProfileKey(supplied, config.profileResidents, command));
  } catch (error) {
    if (error instanceof SharedPilotError || (error instanceof Error && error.name === 'SharedPilotError' && 'code' in error)) {
      if (error.code === 'AUTH_REQUIRED') return json({ error: '登录已过期或 Agent 凭据无效。' }, 401);
      return json({ error: error.message, code: error.code }, 409);
    }
    return json({ error: '共享 Agent 服务暂不可用。' }, 503);
  }
}
