import { z } from 'zod';
import { AGENT_LOCATIONS, chainHashSchema, decimalStringSchema } from './world-v1.js';

export const COMMAND_MODES = ['SUGGEST', 'EXECUTE', 'INTERRUPT'] as const;
export const COMMAND_STATUSES = ['RUNNING', 'PAUSED', 'DECLINED', 'COMPLETED', 'FAILED'] as const;
export type CommandMode = (typeof COMMAND_MODES)[number];
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

// Reject common forms of credentials before the request is persisted for retries.
const credential = /(?:private[\s_-]*key|seed[\s_-]*phrase|mnemonic|pairing[\s_-]*code|session[\s_-]*token|api[\s_-]*key|助记词|私钥|配对码|会话令牌|(?:0x)?[\da-f]{64}|\bsk-[a-z\d_-]{16,})/i;
export const commandRequestSchema = z.object({
  requestId: z.string().uuid(),
  mode: z.enum(COMMAND_MODES),
  text: z.string().trim().min(1).max(500).refine((text) => !credential.test(text.normalize('NFKC')), 'Remove wallet or session credentials.'),
}).strict();
export type CommandRequest = z.infer<typeof commandRequestSchema>;

const subjects = z.enum(['PROJECTS', 'PROPOSALS', 'DISTRICT']);
export const commandStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('VISIT'), location: z.enum(AGENT_LOCATIONS), from: z.enum(AGENT_LOCATIONS).optional() }).strict(),
  z.object({
    kind: z.literal('DISCUSS'), targetAgentId: z.string().min(1).max(64),
    subject: z.enum(['PROJECTS', 'PROPOSALS']).optional(), itemId: decimalStringSchema.optional(),
  }).strict(),
  z.object({ kind: z.literal('REVIEW'), subject: subjects, itemId: decimalStringSchema.optional() }).strict(),
  z.object({ kind: z.literal('REPORT') }).strict(),
]);
export type CommandStep = z.infer<typeof commandStepSchema>;

/** An LLM may suggest activities and text, never identity, timing or state. */
export const commandModelPlanSchema = z.object({ steps: z.array(commandStepSchema).min(1).max(6) }).strict();
export const commandModelReplySchema = z.object({
  decision: z.enum(['ACCEPT', 'DECLINE', 'COUNTER']),
  opinion: z.string().trim().min(1).max(350),
}).strict();

/** Private command journal. Each result belongs to the step at the same index. */
export const commandRecordSchema = commandRequestSchema.extend({
  id: z.string().uuid(), revision: z.number().int().positive(),
  status: z.enum(COMMAND_STATUSES), configVersion: z.number().int().positive(),
  steps: z.array(commandStepSchema).max(12), results: z.array(z.string()).max(12),
  report: z.string().nullable(), sourceBlock: decimalStringSchema, worldFrameId: chainHashSchema,
  sourceBlockHash: chainHashSchema.nullish(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type CommandRecord = z.infer<typeof commandRecordSchema>;
