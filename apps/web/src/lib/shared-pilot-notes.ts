import { SHARED_PILOT_SPEECH_LIMIT, sharedPilotMoveRequestSchema, sharedPilotSocialRequestSchema, sharedPilotSpeechSchema } from '@agent-republic/domain';
import { z } from 'zod';
import { CITY_PLACES } from './city-movement';
import { COFFEE_MENU, orderCoffeeSchema } from './shared-pilot-cafe';
import { safePilotSpeech } from './shared-pilot-exploration';
import { goFishingSchema } from './shared-pilot-fishing';
import { inspectWorksSchema, WORKS_CHECKS } from './shared-pilot-works';

export const NOTE_MAX_LENGTH = SHARED_PILOT_SPEECH_LIMIT;
export const NOTE_LIFETIME_MS = 15 * 60_000;
const noteId = sharedPilotMoveRequestSchema.shape.requestId;
const noteText = sharedPilotSpeechSchema.refine(safePilotSpeech);
export const submitPlayerNoteSchema = z.object({
  action: z.literal('submitPlayerNote'), noteId, text: noteText,
}).strict();

export const noteActivitySchema = z.union([
  sharedPilotMoveRequestSchema, sharedPilotSocialRequestSchema.options[0], orderCoffeeSchema, inspectWorksSchema, goFishingSchema,
]);
const resolution = { action: z.literal('resolvePlayerNote'), noteId, reason: noteText };
export const resolvePlayerNoteSchema = z.union([
  z.object({ ...resolution, decision: z.literal('skipped') }).strict(),
  z.object({ ...resolution, decision: z.enum(['adopted', 'adapted']), activity: noteActivitySchema }).strict(),
]);

export type ResolvePlayerNote = z.infer<typeof resolvePlayerNoteSchema>;
export type SubmitPlayerNote = z.infer<typeof submitPlayerNoteSchema>;
export type NoteActivity = z.infer<typeof noteActivitySchema>;
export type PlayerNoteRecord = {
  id: string; text: string; sentAt: number;
  response?: { resolution: ResolvePlayerNote; handledAt: number; activityLabel?: string };
};

export function playerNoteView(note: PlayerNoteRecord, at: number) {
  return {
    id: note.id, text: note.text, sentAt: note.sentAt, expiresAt: note.sentAt + NOTE_LIFETIME_MS,
    status: note.response?.resolution.decision ?? (at >= note.sentAt + NOTE_LIFETIME_MS ? 'expired' : 'pending'),
    reason: note.response?.resolution.reason, handledAt: note.response?.handledAt,
    activityLabel: note.response?.activityLabel,
  } as const;
}
export type PlayerNoteView = ReturnType<typeof playerNoteView>;

export function noteActivityLabel(activity: NoteActivity) {
  switch (activity.action) {
    case 'moveTo': return `前往${CITY_PLACES[activity.destination.place]}`;
    case 'invite': return `邀请 ${activity.target} 号到咖啡街见面`;
    case 'orderCoffee': return `点一杯${COFFEE_MENU[activity.drink]}`;
    case 'inspectWorks': return `巡查${WORKS_CHECKS[activity.checkId].label}`;
    case 'goFishing': return '去北岸码头钓鱼';
  }
}
