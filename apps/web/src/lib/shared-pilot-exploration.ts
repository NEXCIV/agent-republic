import { SHARED_PILOT_PROVENANCE, sharedPilotMoveRequestSchema, sharedPilotSpeechSchema,
  type SharedPilotPlaceId, type SharedPilotResidentId } from '@agent-republic/domain';
import { z } from 'zod';

export const EXPLORATION_PLACES = ['cafe', 'works', 'pier'] as const;
export type ExplorationPlace = typeof EXPLORATION_PLACES[number];
export const EXPLORATION_CONTACT = { cafe: '阿棠', works: '现场管理员', pier: '阿澄' } as const;
export const EXPLORATION_LINE_MS = 14_000;
export const explorationTextSchema = sharedPilotSpeechSchema.max(38).refine(safePilotSpeech);
const requestId = sharedPilotMoveRequestSchema.shape.requestId;

export function safePilotSpeech(text: string) {
  return !/[\p{Cc}\p{Cf}]/u.test(text)
    && !/(?:https?:\/\/|www\.|nxc_shared_|\bsk-[a-z\d_-]{12,}|\b[a-z\d_-]{43}\b|0x[a-f\d]{40,}|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b)/i.test(text);
}

export const explorationActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('exploreSite'), requestId, place: z.enum(EXPLORATION_PLACES), text: explorationTextSchema }).strict(),
  z.object({ action: z.literal('exploreArrival'), requestId, activity: z.enum(['ask', 'look']), text: explorationTextSchema }).strict(),
]);
export type ExplorationAction = z.infer<typeof explorationActionSchema>;
export type ExplorationActivity = Extract<ExplorationAction, { action: 'exploreArrival' }>['activity'];
export type FirstExploration = {
  trip: Extract<ExplorationAction, { action: 'exploreSite' }>;
  startedAt: number;
  arrivesAt: number;
  result?: { action: Extract<ExplorationAction, { action: 'exploreArrival' }>; happenedAt: number; reply: string };
};

export type ExplorationScene = { place: ExplorationPlace; contact: string; observation: string };
export type FirstExplorationObservation =
  | { phase: 'intro'; place: SharedPilotPlaceId; destinations: ExplorationScene[] }
  | { phase: 'travelling'; place: ExplorationPlace }
  | { phase: 'onSite'; place: ExplorationPlace; site: ExplorationScene };

export function explorationScenes(state: {
  cafe: { serving: boolean; queued: number };
  freeWorksChecks: number;
  fishing: { occupied: boolean; queued: number };
}): ExplorationScene[] {
  return [
    { place: 'cafe', contact: EXPLORATION_CONTACT.cafe, observation: state.cafe.serving
      ? `阿棠正在接单，${state.cafe.queued} 位居民等候。` : `阿棠的柜台空闲，${state.cafe.queued} 位居民等候。` },
    { place: 'works', contact: EXPLORATION_CONTACT.works, observation: `管理员在建设中心入口外，${state.freeWorksChecks} 处巡查点可用。` },
    { place: 'pier', contact: EXPLORATION_CONTACT.pier, observation: state.fishing.occupied
      ? `阿澄在码头，钓位有人，${state.fishing.queued} 位居民等候。` : '阿澄在码头，钓位空闲。' },
  ];
}

export function explorationView(entries?: Partial<Record<SharedPilotResidentId, FirstExploration>>) {
  const events = Object.entries(entries ?? {}).flatMap(([id, visit]) => {
    const residentId = id as SharedPilotResidentId;
    const base = { residentId, place: visit.trip.place, mode: 'DEMO' as const, provenance: SHARED_PILOT_PROVENANCE };
    return [{ ...base, id: `explore-${id}-intro`, kind: 'EXPLORATION_INTRO' as const, happenedAt: visit.startedAt,
      text: visit.trip.text, reply: null },
    ...(visit.result ? [{ ...base, id: `explore-${id}-arrival`, kind: 'EXPLORATION_ARRIVAL' as const, happenedAt: visit.result.happenedAt,
      text: visit.result.action.text, reply: visit.result.reply }] : [])];
  }).sort((a, b) => a.happenedAt - b.happenedAt);
  return { events };
}
