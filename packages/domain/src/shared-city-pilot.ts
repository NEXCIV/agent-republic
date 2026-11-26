import { z } from 'zod';

/**
 * E3-05: isolated, invite-only DEMO movement vocabulary. These fixed slots are
 * simulation characters, not Agent ID owners or claims to chain citizenship.
 * The caller's resident is resolved by the service; no identity, route,
 * timing, or claimed result is accepted in the action request.
 */
export const SHARED_PILOT_RESIDENT_IDS = ['01', '02'] as const;
export type SharedPilotResidentId = (typeof SHARED_PILOT_RESIDENT_IDS)[number];

export const SHARED_PILOT_PLACE_IDS = ['cafe', 'plaza', 'governance', 'works'] as const;
export type SharedPilotPlaceId = (typeof SHARED_PILOT_PLACE_IDS)[number];

/** Label pilot simulation output; use a separate DEMO label as well. */
export const SHARED_PILOT_PROVENANCE = 'AI_SIMULATED' as const;

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const sharedPilotMoveRequestSchema = z.object({
  requestId: z.string().regex(uuidV4, 'requestId must be a UUID v4').transform((id) => id.toLowerCase()),
  action: z.literal('moveTo'),
  destination: z.object({ place: z.enum(SHARED_PILOT_PLACE_IDS) }).strict(),
}).strict();

export type SharedPilotMoveRequest = z.infer<typeof sharedPilotMoveRequestSchema>;

const actionId = z.string().regex(uuidV4).transform((id) => id.toLowerCase());
export const SHARED_PILOT_LINES = ['greet', 'reply', 'suggest', 'farewell'] as const;
export const sharedPilotSocialRequestSchema = z.discriminatedUnion('action', [
  z.object({ requestId: actionId, action: z.literal('invite'), target: z.enum(SHARED_PILOT_RESIDENT_IDS), venue: z.literal('cafe') }).strict(),
  z.object({ requestId: actionId, action: z.literal('respond'), meetingId: actionId, decision: z.enum(['accept', 'decline']) }).strict(),
  z.object({ requestId: actionId, action: z.literal('say'), meetingId: actionId, line: z.enum(SHARED_PILOT_LINES) }).strict(),
]);
export type SharedPilotSocialRequest = z.infer<typeof sharedPilotSocialRequestSchema>;
