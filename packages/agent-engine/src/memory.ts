import { agentMemoryEntrySchema, agentObservationV1Schema } from '@agent-republic/domain';
import type { AgentMemoryEntry, AgentObservationV1, MemoryKind } from '@agent-republic/domain';

/**
 * E3-06 — memory retrieval and epoch reflection.
 *
 * Reflections are AI-generated summaries grounded only in AgentObservationV1
 * plus intent outcomes. A CONFIRMED intent only counts if its event IDs exist
 * in the current observation; SUBMITTED/INCLUDED remain explicitly pending.
 * Pending transaction hashes never become sourceIds.
 */

export const MEMORY_RETRIEVAL_LIMITS: Readonly<Record<MemoryKind, number>> = {
  FACT: 20,
  SOCIAL: 10,
  PRIVATE_STRATEGY: 2,
  REFLECTION: 2,
};

export const MEMORY_INTENT_STATUSES = [
  'CREATED',
  'DRAFT',
  'PROPOSED',
  'VALIDATED',
  'APPROVED',
  'PREPARED',
  'AWAITING_OWNER',
  'SUBMITTED',
  'INCLUDED',
  'CONFIRMED',
  'FAILED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type MemoryIntentStatus = (typeof MEMORY_INTENT_STATUSES)[number];

const PENDING_STATUSES: ReadonlySet<MemoryIntentStatus> = new Set([
  'CREATED',
  'DRAFT',
  'PROPOSED',
  'VALIDATED',
  'APPROVED',
  'PREPARED',
  'AWAITING_OWNER',
  'SUBMITTED',
  'INCLUDED',
]);

const FAILED_STATUSES: ReadonlySet<MemoryIntentStatus> = new Set([
  'FAILED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
]);

const TX_HASH = /^0x[0-9a-f]{64}$/i;

export type MemoryIntentOutcome = {
  readonly id: string;
  readonly status: MemoryIntentStatus;
  readonly txHash?: string | null;
  /** Chain event IDs (`txHash:logIndex`) claimed for a CONFIRMED intent. */
  readonly confirmedEventIds?: readonly string[];
};

export type ReflectionInput = {
  readonly observation: AgentObservationV1;
  readonly agentId: string;
  readonly memoryId: string;
  readonly configVersion: number;
  readonly createdAt: string;
  readonly intents?: readonly MemoryIntentOutcome[];
};

export type ReflectionResult = {
  readonly memory: AgentMemoryEntry;
  readonly confirmedIntentIds: string[];
  readonly pendingIntentIds: string[];
  readonly failedIntentIds: string[];
  readonly unverifiedIntentIds: string[];
};

export type MemoryErrorCode = 'INVALID_INPUT' | 'INVALID_MEMORY';

export class MemoryError extends Error {
  readonly code: MemoryErrorCode;

  constructor(code: MemoryErrorCode, message: string) {
    super(`[agent-memory] ${message}`);
    this.name = 'MemoryError';
    this.code = code;
  }
}

function truncateUnicode(value: string, max: number): string {
  const chars = [...value];
  if (chars.length <= max) return value;
  return `${chars.slice(0, max - 1).join('')}…`;
}

function listIds(ids: readonly string[], max = 3): string {
  const unique = [...new Set(ids)];
  const shown = unique.slice(0, max);
  const rest = unique.length - shown.length;
  return `${shown.join(', ')}${rest > 0 ? ` +${rest} more` : ''}`;
}

type ValidatedReflection = {
  readonly observation: AgentObservationV1;
  readonly intents: readonly MemoryIntentOutcome[];
};

function validateReflectionInput(input: ReflectionInput): ValidatedReflection {
  const observation = agentObservationV1Schema.safeParse(input.observation);
  if (!observation.success) throw new MemoryError('INVALID_INPUT', 'observation is invalid');

  if (typeof input.agentId !== 'string' || input.agentId.length === 0 || input.agentId.length > 64) {
    throw new MemoryError('INVALID_INPUT', 'agentId must be 1..64 characters');
  }
  if (typeof input.memoryId !== 'string' || input.memoryId.length === 0 || input.memoryId.length > 96) {
    throw new MemoryError('INVALID_INPUT', 'memoryId must be 1..96 characters');
  }
  if (!Number.isInteger(input.configVersion) || input.configVersion < 1) {
    throw new MemoryError('INVALID_INPUT', 'configVersion must be a positive integer');
  }
  if (typeof input.createdAt !== 'string' || Number.isNaN(Date.parse(input.createdAt))) {
    throw new MemoryError('INVALID_INPUT', 'createdAt must be an ISO datetime');
  }

  const intents = input.intents ?? [];
  if (!Array.isArray(intents)) throw new MemoryError('INVALID_INPUT', 'intents must be an array');
  for (const intent of intents) {
    if (typeof intent.id !== 'string' || intent.id.length === 0 || intent.id.length > 96) {
      throw new MemoryError('INVALID_INPUT', 'intent id is invalid');
    }
    if (!(MEMORY_INTENT_STATUSES as readonly string[]).includes(intent.status)) {
      throw new MemoryError('INVALID_INPUT', `unknown intent status ${String(intent.status)}`);
    }
    if (intent.txHash != null && !TX_HASH.test(intent.txHash)) {
      throw new MemoryError('INVALID_INPUT', `intent ${intent.id} has an invalid txHash`);
    }
    if (
      intent.confirmedEventIds !== undefined &&
      (!Array.isArray(intent.confirmedEventIds) ||
        intent.confirmedEventIds.some(
          (eventId: unknown) =>
            typeof eventId !== 'string' || eventId.length === 0 || eventId.length > 96,
        ))
    ) {
      throw new MemoryError('INVALID_INPUT', `intent ${intent.id} has invalid confirmedEventIds`);
    }
  }

  return { observation: observation.data, intents };
}

/**
 * Builds an AI_REFLECTION memory. Confirmed intents must be backed by event
 * IDs present in this observation; otherwise they are listed as unverified and
 * never reported as success.
 */
export function buildEpochReflection(input: ReflectionInput): ReflectionResult {
  const { observation, intents } = validateReflectionInput(input);
  const observedEvents = new Set(observation.chainRecentEventIds.map((id) => id.toLowerCase()));

  const confirmedIntentIds: string[] = [];
  const pendingIntentIds: string[] = [];
  const failedIntentIds: string[] = [];
  const unverifiedIntentIds: string[] = [];

  for (const intent of intents) {
    if (PENDING_STATUSES.has(intent.status)) {
      pendingIntentIds.push(intent.id);
      continue;
    }
    if (FAILED_STATUSES.has(intent.status)) {
      failedIntentIds.push(intent.id);
      continue;
    }
    // CONFIRMED: require at least one event that exists in this observation and,
    // when a tx hash is supplied, belongs to that transaction.
    const txPrefix = intent.txHash == null ? null : `${intent.txHash.toLowerCase()}:`;
    const matched = (intent.confirmedEventIds ?? []).some(
      (eventId) =>
        observedEvents.has(eventId.toLowerCase()) &&
        (txPrefix === null || eventId.toLowerCase().startsWith(txPrefix)),
    );
    if (matched) confirmedIntentIds.push(intent.id);
    else unverifiedIntentIds.push(intent.id);
  }

  const project = observation.facts.projects.find((entry) => entry.status === 'FUNDING');
  const projectLine =
    project === undefined
      ? 'No FUNDING project in this observation.'
      : `Project #${project.id}: ${project.fundedBuild}/${project.goalBuild} BUILD confirmed (${(
          BigInt(project.goalBuild) - BigInt(project.fundedBuild)
        ).toString()} remaining).`;

  const parts = [
    `Epoch ${observation.epochId}, block ${observation.sourceBlock}.`,
    projectLine,
    `Self: ${observation.self.build} BUILD, ${observation.self.rep} REP, Agent ID ${
      observation.self.hasAgentId ? 'present' : 'absent'
    }, ${observation.self.registered ? 'registered' : 'not registered'}.`,
  ];

  if (confirmedIntentIds.length > 0) {
    parts.push(`Confirmed actions: ${listIds(confirmedIntentIds)} — backed by observed chain events.`);
  }
  if (pendingIntentIds.length > 0) {
    parts.push(
      `Pending actions: ${listIds(pendingIntentIds)} — awaiting owner/chain confirmation, not counted as success.`,
    );
  }
  if (unverifiedIntentIds.length > 0) {
    parts.push(
      `Excluded CONFIRMED claims: ${listIds(unverifiedIntentIds)} — events are missing from this observation.`,
    );
  }
  if (failedIntentIds.length > 0) {
    parts.push(`Failed actions: ${listIds(failedIntentIds)}.`);
  }

  const sourceIds = [...new Set(observation.chainRecentEventIds)].slice(0, 200);
  const candidate = {
    id: input.memoryId,
    agentId: input.agentId,
    kind: 'REFLECTION' as const,
    text: truncateUnicode(parts.join(' '), 500),
    sourceIds,
    createdAt: input.createdAt,
    agentConfigVersion: input.configVersion,
    confidenceLabel: 'AI_REFLECTION' as const,
  };
  const memory = agentMemoryEntrySchema.safeParse(candidate);
  if (!memory.success) {
    throw new MemoryError(
      'INVALID_MEMORY',
      memory.error.issues.map((issue) => issue.message).join('; '),
    );
  }

  return {
    memory: memory.data,
    confirmedIntentIds,
    pendingIntentIds,
    failedIntentIds,
    unverifiedIntentIds,
  };
}

export type MemoryRetrievalOptions = {
  readonly agentId: string;
};

function byNewest(a: AgentMemoryEntry, b: AgentMemoryEntry): number {
  const timeA = Date.parse(a.createdAt);
  const timeB = Date.parse(b.createdAt);
  if (timeA !== timeB) return timeB - timeA;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Retrieval budget: 20 FACT, 10 SOCIAL, 2 PRIVATE_STRATEGY (plus 2 reflections).
 * Memories are strictly scoped by agentId; invalid entries fail closed.
 */
export function retrieveMemories(
  memories: readonly AgentMemoryEntry[],
  options: MemoryRetrievalOptions,
): AgentMemoryEntry[] {
  if (!Array.isArray(memories)) throw new MemoryError('INVALID_INPUT', 'memories must be an array');
  if (
    typeof options.agentId !== 'string' ||
    options.agentId.length === 0 ||
    options.agentId.length > 64
  ) {
    throw new MemoryError('INVALID_INPUT', 'agentId is invalid');
  }

  const validated: AgentMemoryEntry[] = [];
  for (const memory of memories) {
    const parsed = agentMemoryEntrySchema.safeParse(memory);
    if (!parsed.success) {
      throw new MemoryError(
        'INVALID_MEMORY',
        `memory ${String((memory as { id?: unknown }).id)} is invalid`,
      );
    }
    validated.push(parsed.data);
  }

  const scoped = validated.filter((memory) => memory.agentId === options.agentId);
  const result: AgentMemoryEntry[] = [];
  for (const kind of ['FACT', 'SOCIAL', 'PRIVATE_STRATEGY', 'REFLECTION'] as const) {
    const limit = MEMORY_RETRIEVAL_LIMITS[kind];
    const bucket = scoped
      .filter((memory) => memory.kind === kind)
      .sort(byNewest)
      .slice(0, limit);
    result.push(...bucket);
  }
  return result;
}
