import { z } from 'zod';
import { evmAddressSchema } from './address.js';
import { decimalStringSchema } from './world-v1.js';

/**
 * E3-01 — constrained planner output and the authoritative ProposedAction.
 *
 * The LLM may only fill the planner fields below. `owner`, `agentId`,
 * `epochId` and `observedBlock` are NEVER read from model output: they are
 * injected by the backend from verified identity state. The planner schema is
 * strict, so a model that tries to include those fields is rejected instead of
 * silently corrected (docs/AGENT_ENGINE.md §6, §12).
 */

export const INTENTS = [
  'OBSERVE',
  'DISCUSS',
  'SUGGEST_VOTE',
  'SUGGEST_CONTRIBUTION',
  'PUBLISH_NOTE_REQUEST',
  'SOCIAL_LOCATION_REQUEST',
  'ABSTAIN',
] as const;
export type Intent = (typeof INTENTS)[number];

export const INTENT_TARGET_TYPES = ['PROJECT', 'PROPOSAL', 'AGENT', 'LOCATION', 'NONE'] as const;
export type IntentTargetType = (typeof INTENT_TARGET_TYPES)[number];

/** Unicode code-point length (Zod's `.max` counts UTF-16 code units). */
function unicodeMax(max: number) {
  return z
    .string()
    .refine((value) => [...value].length <= max, `must be at most ${max} Unicode characters`);
}

/** The only fields the planner model is allowed to produce. */
export const plannerOutputSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    intent: z.enum(INTENTS),
    targetType: z.enum(INTENT_TARGET_TYPES),
    targetId: z.string().min(1).max(96).nullable(),
    choice: z.enum(['YES', 'NO', 'ABSTAIN']).nullable(),
    buildAmount: z.string().regex(/^\d+$/, 'must be a decimal unsigned integer string').nullable(),
    publicMessage: unicodeMax(500),
    rationale: unicodeMax(600),
    evidenceEventIds: z.array(z.string().min(1).max(96)).max(200),
    confidenceSelfReport: z.number().finite().min(0).max(1),
    requiresOwnerApproval: z.boolean(),
  })
  .strict();

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

/**
 * Server-side action record. Identity fields are authoritative and always
 * overwrite nothing because they do not exist on the planner schema.
 */
export const proposedActionSchema = plannerOutputSchema
  .extend({
    owner: evmAddressSchema,
    agentId: z.string().min(1).max(64),
    epochId: z.number().int().min(0),
    observedBlock: decimalStringSchema,
  })
  .strict();

export type ProposedAction = z.infer<typeof proposedActionSchema>;

/**
 * E3-05 — public debate messages (docs/AGENT_ENGINE.md §8).
 * Moderation and provenance are part of the stored shape so no consumer can
 * present a debate line without the AI_SIMULATED label.
 */
export const DEBATE_STANCES = ['SUPPORT', 'OPPOSE', 'CONDITIONAL', 'NEUTRAL'] as const;
export type DebateStance = (typeof DEBATE_STANCES)[number];

export const DEBATE_CONDITION_KINDS = ['MIN_SUPPORT', 'MIN_PROGRESS', 'NONE'] as const;
export type DebateConditionKind = (typeof DEBATE_CONDITION_KINDS)[number];

export const debateConditionSchema = z
  .object({
    kind: z.enum(DEBATE_CONDITION_KINDS),
    value: z.string().regex(/^\d+$/).nullable(),
  })
  .strict()
  .superRefine((condition, ctx) => {
    if (condition.kind === 'NONE' && condition.value !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'NONE condition must not have a value' });
    }
    if (condition.kind !== 'NONE' && condition.value === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'condition value is required' });
    }
  });

export type DebateCondition = z.infer<typeof debateConditionSchema>;

export const debateMessageSchema = z
  .object({
    threadId: z.string().min(1).max(96),
    epochId: z.number().int().min(0),
    speakerAgentId: z.string().min(1).max(64),
    targetAgentId: z.string().min(1).max(64).nullable(),
    stance: z.enum(DEBATE_STANCES),
    condition: debateConditionSchema,
    text: unicodeMax(500),
    groundedInSnapshotBlock: decimalStringSchema,
    turnIndex: z.number().int().min(0),
    moderation: z.literal('APPROVED'),
    provenance: z.literal('AI_SIMULATED'),
  })
  .strict();

export type DebateMessage = z.infer<typeof debateMessageSchema>;

/**
 * E3-06 — agent memory entries (docs/AGENT_ENGINE.md §9).
 * A memory's confidence label is tied to its kind, so an AI reflection can
 * never be persisted as a confirmed chain fact.
 */
export const MEMORY_KINDS = ['FACT', 'SOCIAL', 'PRIVATE_STRATEGY', 'REFLECTION'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_CONFIDENCE_LABELS = [
  'CHAIN_CONFIRMED',
  'SOCIAL_APPROVED',
  'USER_PROVIDED',
  'AI_REFLECTION',
] as const;
export type MemoryConfidenceLabel = (typeof MEMORY_CONFIDENCE_LABELS)[number];

const MEMORY_CONFIDENCE_BY_KIND: Readonly<Record<MemoryKind, MemoryConfidenceLabel>> = {
  FACT: 'CHAIN_CONFIRMED',
  SOCIAL: 'SOCIAL_APPROVED',
  PRIVATE_STRATEGY: 'USER_PROVIDED',
  REFLECTION: 'AI_REFLECTION',
};

export const agentMemoryEntrySchema = z
  .object({
    id: z.string().min(1).max(96),
    agentId: z.string().min(1).max(64),
    kind: z.enum(MEMORY_KINDS),
    text: unicodeMax(500),
    sourceIds: z.array(z.string().min(1).max(96)).max(200),
    createdAt: z.string().datetime(),
    agentConfigVersion: z.number().int().min(1),
    confidenceLabel: z.enum(MEMORY_CONFIDENCE_LABELS),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.confidenceLabel !== MEMORY_CONFIDENCE_BY_KIND[entry.kind]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${entry.kind} memories must use ${MEMORY_CONFIDENCE_BY_KIND[entry.kind]}`,
      });
    }
    if ((entry.kind === 'FACT' || entry.kind === 'SOCIAL') && entry.sourceIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${entry.kind} memories require at least one sourceId`,
      });
    }
  });

export type AgentMemoryEntry = z.infer<typeof agentMemoryEntrySchema>;
