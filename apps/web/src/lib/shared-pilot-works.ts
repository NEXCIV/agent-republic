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
}).strict();
export const worksTalkSchema = z.object({
  action: z.literal('worksTalk'),
  question: sharedPilotSpeechSchema.refine(text => !/[\p{Cc}\p{Cf}]/u.test(text)),
}).strict();
export type InspectWorks = z.infer<typeof inspectWorksSchema>;
export type SurveyWorksSite = z.infer<typeof surveyWorksSiteSchema>;
export type WorksTalk = z.infer<typeof worksTalkSchema>;
export type WorksCheck = InspectWorks['checkId'];
type WorksDecision = { checkId: WorksCheck; decidedAt: number; managerReply: string | null };
export type WorksBrief = { status: 'pending' } | { status: 'failed'; reason: string }
  | { status: 'assigned'; decision: WorksDecision; inspectionSeq: number };
export type InspectionRoute = CityRoute & {
  worksInspection?: { checkId: WorksCheck; label: string; finding: string; durationMs: number; origin?: 'site-brief' };
  worksBrief?: WorksBrief;
};
type InspectionRow = { seq: number; resident_id: SharedPilotResidentId; started_at: number; arrives_at: number;
  completed_at: number | null; route_json: string };
type Stage = 'travelling' | 'observing' | 'completed';
type EventKind = 'INSPECTION_ASSIGNED' | 'INSPECTION_STARTED' | 'INSPECTION_RECORDED';
const provenance = { mode: 'DEMO', provenance: SHARED_PILOT_PROVENANCE } as const;
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

export function worksBriefView(row: InspectionRow, inspection: InspectionRow | undefined, at: number) {
  const brief = (JSON.parse(row.route_json) as InspectionRoute).worksBrief!;
  const visit = inspection ? worksVisit(inspection, at) : null;
  return {
    id: `works-brief-${row.seq}`, residentId: row.resident_id, acceptedAt: row.started_at, arrivedAt: row.completed_at,
    stage: brief.status === 'failed' ? 'failed' as const : visit?.stage ?? (row.completed_at === null ? 'travelling' : 'deciding'),
    decision: brief.status === 'assigned' ? brief.decision : null,
    reason: brief.status === 'failed' ? brief.reason : null, visit,
  };
}

export function worksBriefActive(brief: ReturnType<typeof worksBriefView>) {
  return brief.stage !== 'completed' && brief.stage !== 'failed';
}

export function worksView(rows: InspectionRow[], at: number) {
  const visits = rows.map(row => worksVisit(row, at));
  const events = visits.flatMap(visit => {
    const event = (kind: EventKind, happenedAt: number, text: string) => ({ ...provenance, kind, happenedAt,
      id: `${visit.id}-${kind}`, residentId: visit.residentId, text });
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
