import { SHARED_PILOT_PROVENANCE, sharedPilotMoveRequestSchema, type SharedPilotResidentId } from '@agent-republic/domain';
import { z } from 'zod';
import { COUNCIL_DEMO_AGENDA } from './council-notice';
import { observeTheatre, theatreDecisionFields, validTheatreDecision, type TheatreResidentId } from './theatre-trial';
import { THEATRE_CUES } from './theatre-programme';

const requestId = sharedPilotMoveRequestSchema.shape.requestId;
export const councilReadSchema = z.object({ action: z.literal('readCouncilNotice'), requestId }).strict();
export const sharedTheatreSchema = theatreDecisionFields.extend({ action: z.literal('respondTheatre'), requestId }).refine(validTheatreDecision);
export type CouncilRead = z.infer<typeof councilReadSchema>;
export type SharedTheatreAction = z.infer<typeof sharedTheatreSchema>;
// The two shared seats use the same surveyed aisles as residents 01 and 03 in the single-player show.
export const SHARED_THEATRE_RULES = { proposers: ['01', '03'], estimateBeforeBooking: false } as const;
export const theatreSeat = (residentId: SharedPilotResidentId): TheatreResidentId => residentId === '01' ? '01' : '03';
const sharedResident = (seat: TheatreResidentId): SharedPilotResidentId => seat === '01' ? '01' : '02';

export function theatreActionLabel({ decision, slot, cue, response }: Omit<SharedTheatreAction, 'requestId' | 'action' | 'revision'>) {
  const slotName = slot === 'early' ? '傍晚第一场' : '傍晚第二场';
  switch (decision) {
    case 'propose': return `提议${slotName}`;
    case 'counter': return `改约${slotName}`;
    case 'accept': return '接受对方提议';
    case 'decline': return '谢绝本轮提议';
    case 'attend': return '前往社区剧场观演';
    case 'skip': return '本场不参加';
    case 'feedback': return `${response === 'keep' ? '建议保留' : '建议调整'}「${THEATRE_CUES.find(segment => segment.id === cue)?.name}」`;
  }
}

export function sharedTheatreView(view: ReturnType<typeof observeTheatre>) {
  const resident = (seat: TheatreResidentId) => {
    const { status, position, travelSeconds, watched } = view.residents[seat];
    return { status, position, travelSeconds, watched };
  };
  return {
    phase: view.phase, title: view.title, revision: view.revision, slots: view.slots, booking: view.booking, programme: view.programme,
    offer: view.offer && { by: sharedResident(view.offer.by), slot: view.offer.slot },
    residents: { '01': resident('01'), '02': resident('03') },
    attendees: view.attendees.map(sharedResident),
    availableActions: view.availableActions.map(({ agentId, ...choice }) => ({ ...choice, residentId: sharedResident(agentId) })),
    events: view.events.map(({ agentId, type, at, text }) => {
      const residentId = agentId === undefined ? undefined : sharedResident(agentId);
      return { id: `theatre:${type}:${residentId ?? 'city'}:${at}`, residentId, kind: type, happenedAt: at,
        text: residentId ? `${residentId} 号 · ${text}` : text, provenance: SHARED_PILOT_PROVENANCE };
    }),
  };
}

export const NOTICE_READ_MS = 4_000;
export type CouncilMovement = { seq: number; resident_id: SharedPilotResidentId; started_at: number; arrives_at: number; completed_at: number | null };
export function councilRead(row: CouncilMovement, at: number) {
  const readAt = row.arrives_at + NOTICE_READ_MS;
  return { id: `notice-${row.seq}`, residentId: row.resident_id, acceptedAt: row.started_at, arrivesAt: row.arrives_at, readAt,
    stage: row.completed_at === null ? 'travelling' as const : at < readAt ? 'reading' as const : 'completed' as const };
}
export function councilProjection(rows: CouncilMovement[], at: number) {
  const visits = rows.map(row => councilRead(row, at));
  const events = visits.filter(visit => visit.stage === 'completed').map(({ id, residentId, readAt }) => ({
    id, residentId, kind: 'NOTICE_READ' as const, happenedAt: readAt, provenance: SHARED_PILOT_PROVENANCE,
    text: `${residentId} 号读完议会公告。议题包括${COUNCIL_DEMO_AGENDA.join('、')}。`,
  }));
  return { agenda: COUNCIL_DEMO_AGENDA, visits, events };
}
