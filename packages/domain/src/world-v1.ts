import { z } from 'zod';
import { evmAddressSchema } from './address.js';

/**
 * E5-01 — the single shared world protocol (docs/WORLD_ENGINE.md §2).
 *
 * This file is the ONLY definition of WorldFrameV1 / AgentObservationV1.
 * Web, API, Worker, the 3D renderer and the agent runtime must import these
 * types; a parallel "WorldSnapshot" is forbidden (AGENTS.md §4).
 *
 * Trust split inside a frame:
 *   facts      → confirmed chain events / contract reads only
 *   society    → moderated off-chain messages, always labeled AI_SIMULATED
 *   simulation → deterministic visual state with no economic effect
 */

const DECIMAL = /^\d+$/;
const HASH32 = /^0x[0-9a-f]{64}$/;

export const decimalStringSchema = z
  .string()
  .regex(DECIMAL, 'must be a decimal unsigned integer string');

export const chainHashSchema = z
  .string()
  .regex(HASH32, 'must be a lowercase 0x-prefixed 32-byte hash');

export const WORLD_SYNC_STATES = ['LIVE', 'DELAYED', 'OFFLINE', 'REORG_RECOVERY'] as const;
export type WorldSyncState = (typeof WORLD_SYNC_STATES)[number];

export const SCENE_VERSION = 'district-01@1';

export const AGENT_ACTIONS = ['IDLE', 'WALK', 'DISCUSS', 'OBSERVE'] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

export const AGENT_LOCATIONS = ['PLAZA', 'COUNCIL', 'IDENTITY', 'PROJECT', 'CORE'] as const;
export type AgentLocation = (typeof AGENT_LOCATIONS)[number];

export const VISUAL_EVENT_KINDS = ['MOVE', 'DISCUSSION', 'MILESTONE', 'WORLD_ALERT'] as const;
export type VisualEventKind = (typeof VISUAL_EVENT_KINDS)[number];

/** District bounds: 40m × 40m with x,z ∈ [-20,20] (WORLD_ENGINE §4). */
export const DISTRICT_BOUND = 20;

/** Hard display cap; AGENTS.md §4 fixes 30 visible agents. */
export const MAX_VISIBLE_AGENTS = 30;

/** §2.1: the public frame carries at most the latest 20 approved messages. */
export const MAX_PUBLIC_MESSAGES = 20;

const worldProjectSchema = z
  .object({
    id: decimalStringSchema,
    titleKey: z.string().min(1).max(64),
    goalBuild: decimalStringSchema,
    fundedBuild: decimalStringSchema,
    status: z.enum(['FUNDING', 'COMPLETED']),
    completedAtBlock: decimalStringSchema.nullable(),
  })
  .strict();

const worldProposalSchema = z
  .object({
    id: decimalStringSchema,
    status: z.enum(['OPEN', 'PASSED', 'REJECTED', 'EXPIRED']),
    yes: z.number().int().min(0),
    no: z.number().int().min(0),
    abstain: z.number().int().min(0),
    deadline: z.string().datetime(),
  })
  .strict();

export const worldFactsSchema = z
  .object({
    citizenCount: z.number().int().min(0),
    projects: z.array(worldProjectSchema),
    proposals: z.array(worldProposalSchema),
  })
  .strict()
  .superRefine((facts, ctx) => {
    assertUnique(facts.projects.map((project) => project.id), ['projects'], ctx, 'project id');
    assertUnique(facts.proposals.map((proposal) => proposal.id), ['proposals'], ctx, 'proposal id');
  });

export type WorldFacts = z.infer<typeof worldFactsSchema>;

const publicMessageSchema = z
  .object({
    id: z.string().min(1).max(64),
    agentId: z.string().min(1).max(64),
    owner: evmAddressSchema,
    text: z.string().min(1).max(2000),
    createdAt: z.string().datetime(),
    // Only approved moderation may ever reach a public frame.
    moderation: z.literal('APPROVED'),
    // Off-chain speech can never be labeled as a chain fact.
    provenance: z.literal('AI_SIMULATED'),
  })
  .strict();

const agentSummarySchema = z
  .object({
    agentId: z.string().min(1).max(64),
    owner: evmAddressSchema,
    displayName: z.string().min(1).max(64),
    persona: z.string().min(1).max(64),
    active: z.boolean(),
  })
  .strict();

export const worldSocietySchema = z
  .object({
    socialRevision: decimalStringSchema,
    publicMessages: z.array(publicMessageSchema).max(MAX_PUBLIC_MESSAGES),
    agentSummaries: z.array(agentSummarySchema),
  })
  .strict();

export type WorldSociety = z.infer<typeof worldSocietySchema>;

const positionSchema = z
  .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
  .refine(
    ([x, , z]) =>
      x >= -DISTRICT_BOUND && x <= DISTRICT_BOUND && z >= -DISTRICT_BOUND && z <= DISTRICT_BOUND,
    `position must stay inside the ${DISTRICT_BOUND * 2}m × ${DISTRICT_BOUND * 2}m district`,
  );

const simulatedAgentSchema = z
  .object({
    agentId: z.string().min(1).max(64),
    position: positionSchema,
    facingRadians: z.number().finite(),
    action: z.enum(AGENT_ACTIONS),
    locationId: z.enum(AGENT_LOCATIONS),
    // Simulation can never claim to be an on-chain fact.
    isSimulated: z.literal(true),
  })
  .strict();

const visualEventSchema = z
  .object({
    id: z.string().min(1).max(96),
    kind: z.enum(VISUAL_EVENT_KINDS),
    targetId: z.string().min(1).max(96),
    happenedAtTick: decimalStringSchema,
    sourceType: z.enum(['CHAIN', 'OFFCHAIN']),
    sourceId: z.string().min(1).max(96),
  })
  .strict();

export const worldSimulationSchema = z
  .object({
    tick: decimalStringSchema,
    worldSeed: z.string().min(1).max(128),
    sceneVersion: z.literal(SCENE_VERSION),
    agents: z.array(simulatedAgentSchema).max(MAX_VISIBLE_AGENTS),
    visualEvents: z.array(visualEventSchema),
  })
  .strict()
  .superRefine((simulation, ctx) => {
    assertUnique(simulation.agents.map((agent) => agent.agentId), ['agents'], ctx, 'agentId');
    assertUnique(simulation.visualEvents.map((event) => event.id), ['visualEvents'], ctx, 'event id');
  });

export type WorldSimulation = z.infer<typeof worldSimulationSchema>;

const worldSourceSchema = z
  .object({
    chainId: z.union([z.literal(56), z.literal(97)]),
    blockNumber: decimalStringSchema,
    blockHash: chainHashSchema,
    blockTimestamp: z.string().datetime(),
    /** Configured confirmation depth — an engineering policy, not finality. */
    confirmedDepth: z.number().int().min(0),
    sync: z.enum(WORLD_SYNC_STATES),
    provenance: z.literal('CHAIN_CONFIRMED'),
  })
  .strict();

export const worldFrameV1Schema = z
  .object({
    schemaVersion: z.literal('1.1'),
    frameId: chainHashSchema,
    generatedAt: z.string().datetime(),
    source: worldSourceSchema,
    epochId: z.number().int().min(0),
    facts: worldFactsSchema,
    society: worldSocietySchema,
    simulation: worldSimulationSchema,
  })
  .strict();

export type WorldFrameV1 = z.infer<typeof worldFrameV1Schema>;

const agentSelfSchema = z
  .object({
    owner: evmAddressSchema,
    hasAgentId: z.boolean(),
    registered: z.boolean(),
    build: decimalStringSchema,
    rep: decimalStringSchema,
  })
  .strict();

export const agentObservationV1Schema = z
  .object({
    worldFrameId: chainHashSchema,
    sourceBlock: decimalStringSchema,
    epochId: z.number().int().min(0),
    facts: worldFactsSchema,
    self: agentSelfSchema,
    /** Private perception for the isolated café playtest. Never projected into WorldFrameV1. */
    cafeDemo: z.object({
      place: z.enum(['counter', 'bench', 'pier']),
      energy: z.number().int().min(0).max(100),
      nearbyFriend: z.boolean(),
      available: z.array(z.enum(['work', 'rest', 'invite', 'visitPier', 'fish'])),
      finishedWork: z.boolean(),
      lastMeeting: z.enum(['none', 'declined', 'chatted']),
      preference: z.enum(['social', 'quiet']),
      requestedActivity: z.literal('fish').optional(),
    }).strict().optional(),
    approvedPublicMessages: z.array(publicMessageSchema).max(MAX_PUBLIC_MESSAGES),
    /** Public names for addressing an invitation. These carry no location or wallet authority. */
    publicContacts: z.array(agentSummarySchema.pick({ agentId: true, displayName: true })).max(MAX_VISIBLE_AGENTS).optional(),
    /** Ids of confirmed chain events the agent may cite as evidence. */
    chainRecentEventIds: z.array(z.string().min(1).max(96)).max(200),
  })
  .strict();

export type AgentObservationV1 = z.infer<typeof agentObservationV1Schema>;

function assertUnique(
  ids: readonly string[],
  path: (string | number)[],
  ctx: z.RefinementCtx,
  label: string,
): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message: `duplicate ${label} "${id}"`,
      });
    }
    seen.add(id);
  });
}
