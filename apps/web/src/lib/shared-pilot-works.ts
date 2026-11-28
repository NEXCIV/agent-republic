import { SHARED_PILOT_PROVENANCE, SHARED_PILOT_SURVEY_CHECKS, sharedPilotMoveRequestSchema, sharedPilotSpeechSchema,
  type SharedPilotResidentId } from '@agent-republic/domain';
import { z } from 'zod';
import type { CityPoint } from './cafe-geometry';
import type { CityRoute } from './city-movement';

export const WORKS_MANAGER = { kind: 'person', id: 'works.manager' } as const;
export const WORKS_MANAGER_POSITION: CityPoint = [96.5, 0.203, 72.4];
export const WORKS_CHECKS = {
  'entrance-path': { checkId: 'entrance-path', label: '入口外侧步道', x: 95, z: 67.346,
    finding: '已记录入口外侧步道的实测路网节点。建议保持入口至前厅的行人连接。' },
  'pedestrian-passage': { checkId: 'pedestrian-passage', label: '施工区人行通道', x: 95, z: 60.55,
    finding: '已记录施工区人行通道的路网节点。建议在通道入口明确步行引导。' },
} as const;
export const SURVEY_OBSERVATION_MS = 8000;
export const inspectWorksSchema = z.object({
  action: z.literal('inspectWorks'),
  requestId: sharedPilotMoveRequestSchema.shape.requestId,
  checkId: z.enum(SHARED_PILOT_SURVEY_CHECKS),
}).strict();
export const surveyWorksSiteSchema = z.object({
  action: z.literal('surveyWorksSite'),
  requestId: sharedPilotMoveRequestSchema.shape.requestId,
  driver: z.literal('mcp').optional(),
}).strict();
const goalId = sharedPilotMoveRequestSchema.shape.requestId;
export const worksGoalActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('acceptWorksGoal'), taskId: goalId }).strict(),
  z.object({ action: z.literal('askWorksGoal'), taskId: goalId }).strict(),
  z.object({ action: z.literal('inspectWorksGoal'), taskId: goalId, checkId: z.enum(SHARED_PILOT_SURVEY_CHECKS) }).strict(),
]);
export const cancelWorksGoalSchema = z.object({ action: z.literal('cancelWorksGoal'), goalId: z.string().regex(/^works-goal-[1-9]\d{0,5}$/) }).strict();
export const worksTalkSchema = z.object({
  action: z.literal('worksTalk'),
  question: sharedPilotSpeechSchema.refine(text => !/[\p{Cc}\p{Cf}]/u.test(text)),
}).strict();
export type InspectWorks = z.infer<typeof inspectWorksSchema>;
export type SurveyWorksSite = z.infer<typeof surveyWorksSiteSchema>;
export type WorksTalk = z.infer<typeof worksTalkSchema>;
export type WorksGoalAction = z.infer<typeof worksGoalActionSchema>;
export type CancelWorksGoal = z.infer<typeof cancelWorksGoalSchema>;
export type WorksCheck = InspectWorks['checkId'];
type WorksDecision = { checkId: WorksCheck; decidedAt: number; managerReply: string | null; otherPointOccupied?: boolean };
export type WorksBrief = { status: 'pending' } | { status: 'failed'; reason: string }
  | { status: 'assigned'; decision: WorksDecision; inspectionSeq: number };
export type InspectionRoute = CityRoute & {
  worksInspection?: { checkId: WorksCheck; label: string; finding: string; durationMs: number; origin?: 'site-brief' };
  worksBrief?: WorksBrief;
};
type InspectionRow = { seq: number; resident_id: SharedPilotResidentId; started_at: number; arrives_at: number;
  completed_at: number | null; route_json: string };
type Stage = 'travelling' | 'observing' | 'completed';
type EventKind = 'INSPECTION_ASSIGNED' | 'INSPECTION_STARTED' | 'INSPECTION_RECORDED'
  | 'WORKS_GOAL_CLAIMED' | 'WORKS_GOAL_ASKED';
const provenance = { mode: 'DEMO', provenance: SHARED_PILOT_PROVENANCE } as const;
export const WORKS_GOALS_TABLE = `
  CREATE TABLE shared_pilot_works_goals (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    resident_id TEXT NOT NULL REFERENCES shared_pilot_residents(id),
    request_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    arrival_seq INTEGER REFERENCES shared_pilot_moves(seq),
    inspection_seq INTEGER REFERENCES shared_pilot_moves(seq),
    manager_reply TEXT,
    asked_at INTEGER,
    other_point_occupied INTEGER NOT NULL DEFAULT 0,
    closed_at INTEGER,
    UNIQUE (resident_id, request_id)
  );
  CREATE UNIQUE INDEX shared_pilot_active_works_goal ON shared_pilot_works_goals(resident_id) WHERE closed_at IS NULL;
`;
export type WorksGoalRow = {
  seq: number; id: string; resident_id: SharedPilotResidentId; request_id: string; created_at: number;
  arrival_seq: number | null; inspection_seq: number | null; manager_reply: string | null;
  asked_at: number | null; other_point_occupied: number; closed_at: number | null;
};
export type WorksBriefView = {
  id: string; residentId: SharedPilotResidentId; acceptedAt: number; arrivedAt: number | null;
  stage: Stage | 'waiting' | 'deciding' | 'failed' | 'cancelled';
  driver: 'rules' | 'mcp'; claimedAt: number | null; managerReply: string | null;
  decision: WorksDecision | null; reason: string | null; visit: ReturnType<typeof worksVisit> | null;
};
export const WORKS_STATUS: Record<Stage, string> = {
  travelling: '前往巡查点', observing: '正在现场观察', completed: '已提交巡查记录',
};

export function worksVisit(row: InspectionRow, at: number) {
  const route = JSON.parse(row.route_json) as InspectionRoute;
  const check = route.worksInspection!;
  const position = route.points.at(-1)!;
  const reportAt = row.arrives_at + check.durationMs;
  const stage: Stage = row.completed_at === null ? 'travelling' : at < reportAt ? 'observing' : 'completed';
  const completed = stage === 'completed';
  return { id: `works-visit-${row.seq}`, residentId: row.resident_id, checkId: check.checkId, label: check.label,
    stage, position, acceptedAt: row.started_at, arrivedAt: row.completed_at, reportAt, origin: check.origin,
    report: completed ? { ...provenance, text: check.finding, recordedAt: reportAt, position } : null };
}

export function worksBriefView(row: InspectionRow, inspection: InspectionRow | undefined, at: number): WorksBriefView {
  const brief = (JSON.parse(row.route_json) as InspectionRoute).worksBrief!;
  const visit = inspection ? worksVisit(inspection, at) : null;
  return {
    id: `works-brief-${row.seq}`, residentId: row.resident_id, acceptedAt: row.started_at, arrivedAt: row.completed_at,
    stage: brief.status === 'failed' ? 'failed' : visit?.stage ?? (row.completed_at === null ? 'travelling' : 'deciding'),
    driver: 'rules', claimedAt: null, managerReply: brief.status === 'assigned' ? brief.decision.managerReply : null,
    decision: brief.status === 'assigned' ? brief.decision : null,
    reason: brief.status === 'failed' ? brief.reason : null, visit,
  };
}

export function worksGoalView(row: WorksGoalRow, arrival: InspectionRow | undefined,
  inspection: InspectionRow | undefined, at: number): WorksBriefView {
  const visit = inspection ? worksVisit(inspection, at) : null;
  return {
    id: `works-goal-${row.seq}`, residentId: row.resident_id, acceptedAt: row.created_at,
    arrivedAt: arrival?.completed_at ?? null, driver: 'mcp', claimedAt: arrival?.started_at ?? null,
    stage: visit?.stage ?? (row.closed_at !== null ? 'cancelled' : !arrival ? 'waiting' : arrival.completed_at === null ? 'travelling' : 'deciding'),
    managerReply: row.manager_reply,
    decision: visit ? { checkId: visit.checkId, decidedAt: visit.acceptedAt, managerReply: row.manager_reply,
      otherPointOccupied: row.other_point_occupied === 1 } : null,
    reason: null, visit,
  };
}

export function worksBriefActive(brief: WorksBriefView) {
  return !['completed', 'failed', 'cancelled'].includes(brief.stage);
}

function worksEvent(id: string, residentId: SharedPilotResidentId, kind: EventKind, happenedAt: number, text: string) {
  return { ...provenance, id: `${id}-${kind}`, residentId, kind, happenedAt, text };
}

export function worksGoalEvents(row: WorksGoalRow, view: WorksBriefView) {
  const events = [];
  if (view.claimedAt !== null) events.push(worksEvent(view.id, view.residentId, 'WORKS_GOAL_CLAIMED', view.claimedAt,
    `${view.residentId} 号的 MCP Agent 已接手建设中心调研。`));
  if (row.asked_at !== null && row.manager_reply) events.push(worksEvent(view.id, view.residentId, 'WORKS_GOAL_ASKED', row.asked_at,
    `${view.residentId} 号询问现场管理员。管理员：${row.manager_reply}`));
  return events;
}

export function worksView(rows: InspectionRow[], at: number) {
  const visits = rows.map(row => worksVisit(row, at));
  const events = visits.flatMap(visit => {
    const event = (kind: EventKind, happenedAt: number, text: string) => worksEvent(visit.id, visit.residentId, kind, happenedAt, text);
    const first = event('INSPECTION_ASSIGNED', visit.acceptedAt, visit.origin === 'site-brief'
      ? `${visit.residentId} 号选择巡查${visit.label}。` : `现场管理员安排 ${visit.residentId} 号巡查${visit.label}。`);
    if (visit.arrivedAt === null) return [first];
    const second = event('INSPECTION_STARTED', visit.arrivedAt, `${visit.residentId} 号抵达${visit.label}，开始观察。`);
    return visit.report ? [first, second, event('INSPECTION_RECORDED', visit.report.recordedAt,
      `${visit.residentId} 号完成${visit.label}巡查。 ${visit.report.text}`)] : [first, second];
  }).sort((a, b) => a.happenedAt - b.happenedAt);
  return { visits, events };
}

export function worksReply(question: string, occupied: WorksCheck[], teamOnSite: boolean) {
  const open = SHARED_PILOT_SURVEY_CHECKS.filter(id => !occupied.includes(id));
  const count = occupied.length;
  const availability = teamOnSite ? '两位居民正在准备或执行共同调研，个人巡查请等调研结束。'
    : count === 0 ? '入口外侧步道和施工区人行通道现在都可以巡查。'
    : open.length ? `${WORKS_CHECKS[occupied[0]!].label}已安排居民，${WORKS_CHECKS[open[0]!].label}还可以领。`
    : '两个巡查点的任务都已安排，请等有人完成后再领。';
  const text = /等候|休息|长椅|waiting area/i.test(question) ? '入口台阶外侧是等候区。走人行道过去，给入口留出通行空间。'
    : /怎么走|路线|怎么去|route|where/i.test(question) ? '从入口外沿有铺装的人行道走，先到入口外侧步道，再往北是施工区人行通道。'
    : /记录|报告|结果|record|report/i.test(question) ? '到巡查点观察八秒后，居民会留下点位、时间和观察记录。可以在城市动态查看。'
    : availability;
  return { ...provenance, text };
}
