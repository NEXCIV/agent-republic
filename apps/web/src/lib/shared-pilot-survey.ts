import { randomUUID } from 'node:crypto';
import { type SharedPilotResidentId, type SharedPilotSurveyRequest } from '@agent-republic/domain';
import type { CityPoint } from './cafe-geometry';
import { surveyAgreement, type SharedMeeting, type SocialResident } from './shared-pilot-social';

type Resident = SharedPilotResidentId;
export const SURVEY_OBSERVATION_MS = 8000;
export const SURVEY_CHECKPOINTS = {
  '01': { checkId: 'entrance-path', label: '入口外侧步道', x: 95, z: 67.346, finding: '已记录入口外侧步道的实测路网节点。建议保持入口至前厅的行人连接。' },
  '02': { checkId: 'pedestrian-passage', label: '施工区人行通道', x: 95, z: 60.55, finding: '已记录施工区人行通道的路网节点。建议在通道入口明确步行引导。' },
} as const;
type CheckId = typeof SURVEY_CHECKPOINTS[Resident]['checkId'];
type SurveyPhase = 'proposed' | 'accepted' | 'surveying' | 'completed' | 'declined' | 'expired';
type SurveyKind = 'SURVEY_PROPOSED' | 'SURVEY_ACCEPTED' | 'SURVEY_DECLINED' | 'SURVEY_ON_SITE' | 'SURVEY_INSPECTING' | 'SURVEY_RECORDED' | 'SURVEY_COMPLETED' | 'SURVEY_EXPIRED';
export type SurveyFinding = { residentId: Resident; checkId: CheckId; label: string; position: CityPoint; startedAt: number; recordedAt: number; text: string };
export type SurveyReport = { taskId: string; sourceMeetingId: string; completedAt: number; findings: SurveyFinding[]; summary: string; mode: 'DEMO'; provenance: 'AI_SIMULATED' };
export type SurveyTask = { id: string; sourceMeetingId: string; proposer: Resident; invitee: Resident; status: SurveyPhase; createdAt: number;
  deadlineAt: number; acceptedAt?: number; startedAt?: number; endedAt?: number;
  inspections: Record<Resident, { startedAt?: number; finding?: SurveyFinding }>;
};
type SurveyEvent = { id: string; taskId: string; residentId?: Resident; kind: SurveyKind; text: string; happenedAt: number; provenance: 'AI_SIMULATED' };
export type SurveyReceipt = { requestId: string; taskId: string; action: SharedPilotSurveyRequest['action']; acceptedAt: number; mode: 'DEMO'; provenance: 'AI_SIMULATED' };
export type SurveyState = { revision: number; task: SurveyTask | null; events: SurveyEvent[]; reports: SurveyReport[]; completed: number; usedMeetingIds: string[];
  requests: Record<Resident, Record<string, { fingerprint: string; receipt: SurveyReceipt }>> };

export function emptySurveyState(): SurveyState {
  return { revision: 0, task: null, events: [], reports: [], completed: 0, usedMeetingIds: [], requests: { '01': {}, '02': {} } };
}

export function surveyActive(task: SurveyTask | null) { return !!task && ['proposed', 'accepted', 'surveying'].includes(task.status); }
export function atSurveyPoint(resident: SocialResident) {
  const { x, z } = SURVEY_CHECKPOINTS[resident.residentId];
  return !resident.moving && Math.hypot(resident.position[0] - x, resident.position[2] - z) < .08;
}

function emit(state: SurveyState, at: number, kind: SurveyKind, text: string, residentId?: Resident) {
  state.events.push({ id: `survey-${++state.revision}`, taskId: state.task!.id, residentId, kind, text, happenedAt: at, provenance: 'AI_SIMULATED' });
  state.events = state.events.slice(-60);
}
export class SurveyActionError extends Error {
  constructor(readonly code: 'BUSY' | 'INVALID_REQUEST' | 'CONFLICT' | 'NOT_FOUND' | 'LIMIT_REACHED', message: string) { super(message); }
}

export function advanceSurvey(state: SurveyState, at: number, residents: SocialResident[]) {
  const task = state.task;
  if (!task || !surveyActive(task)) return false;
  if (at >= task.deadlineAt) {
    task.status = 'expired'; task.endedAt = task.deadlineAt;
    emit(state, task.endedAt, 'SURVEY_EXPIRED', '共同调研超时结束，未生成完成报告。');
    return true;
  }
  if (task.status === 'accepted' && residents.length === 2 && residents.every(atSurveyPoint)) {
    task.status = 'surveying'; task.startedAt = at; task.deadlineAt = at + 90000;
    emit(state, at, 'SURVEY_ON_SITE', '01、02 号均抵达各自的建设中心调研站点。');
    return true;
  }
  return false;
}

export function performSurvey(state: SurveyState, actor: Resident, request: SharedPilotSurveyRequest, at: number, residents: SocialResident[], meeting: SharedMeeting | null): SurveyReceipt {
  const fingerprint = JSON.stringify(request);
  const replay = state.requests[actor][request.requestId];
  if (replay) {
    if (replay.fingerprint !== fingerprint) throw new SurveyActionError('CONFLICT', '该请求编号已用于其他调研动作。');
    return replay.receipt;
  }
  if (Object.keys(state.requests[actor]).length >= 300) throw new SurveyActionError('LIMIT_REACHED', '调研动作记录已达上限。');
  const own = residents.find(({ residentId }) => residentId === actor);
  let task = state.task;
  if (request.action === 'proposeSurvey') {
    if (surveyActive(task) || own?.moving) throw new SurveyActionError('BUSY', '当前居民或调研任务正忙。');
    if (!meeting || meeting.status !== 'completed' || meeting.id !== request.meetingId || !surveyAgreement(meeting).accepted || state.usedMeetingIds.includes(meeting.id)) {
      throw new SurveyActionError('INVALID_REQUEST', '需要未履行的已完成咖啡街约定。');
    }
    if (state.usedMeetingIds.length >= 100) throw new SurveyActionError('LIMIT_REACHED', '共同调研次数已达试点上限。');
    const other = actor === '01' ? '02' : '01';
    task = { id: randomUUID(), sourceMeetingId: meeting.id, proposer: actor, invitee: other, status: 'proposed', createdAt: at,
      deadlineAt: at + 30000, inspections: { '01': {}, '02': {} } };
    state.task = task; state.usedMeetingIds.push(meeting.id);
    emit(state, at, 'SURVEY_PROPOSED', `${actor} 号提议履行咖啡街约定：共同前往公共建设中心调研。`, actor);
  } else {
    if (!task || task.id !== request.taskId) throw new SurveyActionError('NOT_FOUND', '找不到当前调研任务。');
    if (request.action === 'respondSurvey') {
      if (task.status !== 'proposed' || task.invitee !== actor) throw new SurveyActionError('INVALID_REQUEST', '只有受邀者能回应待处理调研。');
      task.status = request.decision === 'accept' ? 'accepted' : 'declined';
      if (task.status === 'accepted') { task.acceptedAt = at; task.deadlineAt = at + 150000; }
      else task.endedAt = at;
      emit(state, at, task.status === 'accepted' ? 'SURVEY_ACCEPTED' : 'SURVEY_DECLINED', `${actor} 号${task.status === 'accepted' ? '接受共同调研，分配两个现场点位。' : '拒绝共同调研。'}`, actor);
    } else {
      if (task.status !== 'surveying' || !own || residents.length !== 2 || !residents.every(atSurveyPoint)) throw new SurveyActionError('INVALID_REQUEST', '两名居民必须实际抵达各自的调研点。');
      const inspection = task.inspections[actor];
      const check = SURVEY_CHECKPOINTS[actor];
      if (request.action === 'inspectSurvey') {
        if (request.checkId !== check.checkId || inspection.startedAt !== undefined) throw new SurveyActionError('INVALID_REQUEST', '仅能开始自己尚未执行的检查项。');
        inspection.startedAt = at;
        emit(state, at, 'SURVEY_INSPECTING', `${actor} 号开始观察${check.label}。`, actor);
      } else {
        if (inspection.startedAt === undefined || inspection.finding || at < inspection.startedAt + SURVEY_OBSERVATION_MS) throw new SurveyActionError('INVALID_REQUEST', '需要完成现场观察后才能提交自己的记录。');
        inspection.finding = { residentId: actor, checkId: check.checkId, label: check.label, position: [...own.position], startedAt: inspection.startedAt, recordedAt: at, text: check.finding };
        emit(state, at, 'SURVEY_RECORDED', `${actor} 号提交${check.label}的现场记录。`, actor);
        const [first, second] = [task.inspections['01'].finding, task.inspections['02'].finding];
        if (first && second) {
          task.status = 'completed'; task.endedAt = at; state.completed++;
          state.reports.push({ taskId: task.id, sourceMeetingId: task.sourceMeetingId, completedAt: at, findings: [first, second],
            summary: '两处已测绘步道路网节点完成观察与记录。建议保留入口通行，并增加施工区人行导引。', mode: 'DEMO', provenance: 'AI_SIMULATED' });
          state.reports = state.reports.slice(-12);
          emit(state, at, 'SURVEY_COMPLETED', '两份独立记录齐备，公共建设中心共同调研报告已完成。');
        }
      }
    }
  }
  const receipt: SurveyReceipt = { requestId: request.requestId, taskId: task.id, action: request.action, acceptedAt: at, mode: 'DEMO', provenance: 'AI_SIMULATED' };
  state.requests[actor][request.requestId] = { fingerprint, receipt };
  return receipt;
}

export function publicSurvey(state: SurveyState, residents: SocialResident[], meeting: SharedMeeting | null) {
  const task = state.task;
  return { revision: state.revision, task, events: state.events, completed: state.completed,
    eligibleMeetingId: meeting?.status === 'completed' && surveyAgreement(meeting).accepted && !state.usedMeetingIds.includes(meeting.id) ? meeting.id : null,
    arrived: task && ['accepted', 'surveying', 'completed'].includes(task.status) ? residents.filter(atSurveyPoint).map(({ residentId }) => residentId) : [],
    checkpoints: { '01': { label: SURVEY_CHECKPOINTS['01'].label, x: 95, z: SURVEY_CHECKPOINTS['01'].z }, '02': { label: SURVEY_CHECKPOINTS['02'].label, x: 95, z: SURVEY_CHECKPOINTS['02'].z } },
    report: state.reports.at(-1) ?? null,
  };
}
export type SharedSurveyView = ReturnType<typeof publicSurvey>;
