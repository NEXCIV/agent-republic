import {
  agentObservationV1Schema,
  MAX_VISIBLE_AGENTS,
  chainHashSchema,
  decimalStringSchema,
  evmAddressSchema,
} from '@agent-republic/domain';
import type { AgentObservationV1, WorldFrameV1 } from '@agent-republic/domain';

/**
 * E3-02 — WorldFrameV1 → AgentObservationV1.
 *
 * Fail-closed rules (docs/AGENT_ENGINE.md §4):
 * - self balances/identity must be read at the frame's block number (and hash
 *   when supplied), otherwise the observation is rejected;
 * - the frame must be LIVE and no more than `maxStalenessBlocks` behind the
 *   provided network head;
 * - only confirmed facts, APPROVED public messages and chain event references
 *   enter the observation. Simulation positions are never included.
 */

export type OwnerChainState = {
  readonly owner: string;
  /** Block tag used to read this owner state. */
  readonly blockNumber: string;
  /** Optional block hash when the RPC can provide it. */
  readonly blockHash?: string;
  readonly hasAgentId: boolean;
  readonly registered: boolean;
  readonly build: string;
  readonly rep: string;
};

export type ObservationOptions = {
  /** Current network head used for the staleness check. */
  readonly networkBlockNumber: string;
  readonly maxStalenessBlocks?: number;
};

export type AgentObservationErrorCode =
  | 'INVALID_SELF'
  | 'INVALID_OPTIONS'
  | 'BLOCK_MISMATCH'
  | 'STALE_FRAME'
  | 'SYNC_NOT_LIVE'
  | 'INVALID_OBSERVATION';

export class AgentObservationError extends Error {
  readonly code: AgentObservationErrorCode;
  readonly issues: readonly string[];

  constructor(code: AgentObservationErrorCode, message: string, issues: readonly string[] = []) {
    super(`[agent-observation] ${message}`);
    this.name = 'AgentObservationError';
    this.code = code;
    this.issues = issues;
  }
}

const DEFAULT_MAX_STALENESS_BLOCKS = 50;
const CHAIN_SOURCE = /^0x[0-9a-f]{64}:\d+$/i;

type ValidatedSelf = {
  readonly owner: string;
  readonly blockNumber: string;
  readonly blockHash: string | undefined;
  readonly hasAgentId: boolean;
  readonly registered: boolean;
  readonly build: string;
  readonly rep: string;
};

function validateSelf(self: OwnerChainState): ValidatedSelf {
  const issues: string[] = [];
  const owner = evmAddressSchema.safeParse(self.owner);
  if (!owner.success) issues.push('owner must be a valid EVM address');
  if (!decimalStringSchema.safeParse(self.blockNumber).success) {
    issues.push('blockNumber must be a decimal integer string');
  }
  if (self.blockHash !== undefined && !chainHashSchema.safeParse(self.blockHash).success) {
    issues.push('blockHash must be a lowercase 0x-prefixed 32-byte hash');
  }
  if (!decimalStringSchema.safeParse(self.build).success) {
    issues.push('build must be a decimal integer string');
  }
  if (!decimalStringSchema.safeParse(self.rep).success) {
    issues.push('rep must be a decimal integer string');
  }
  if (typeof self.hasAgentId !== 'boolean' || typeof self.registered !== 'boolean') {
    issues.push('hasAgentId and registered must be booleans');
  } else if (self.registered && !self.hasAgentId) {
    issues.push('registered citizen must hold an Agent ID');
  }

  if (issues.length > 0) {
    throw new AgentObservationError('INVALID_SELF', 'owner chain state is invalid', issues);
  }

  return {
    owner: owner.success ? owner.data : '',
    blockNumber: self.blockNumber,
    blockHash: self.blockHash,
    hasAgentId: self.hasAgentId,
    registered: self.registered,
    build: self.build,
    rep: self.rep,
  };
}

function validateOptions(options: ObservationOptions): {
  readonly networkBlockNumber: bigint;
  readonly maxStalenessBlocks: number;
} {
  const issues: string[] = [];
  if (!decimalStringSchema.safeParse(options.networkBlockNumber).success) {
    issues.push('networkBlockNumber must be a decimal integer string');
  }
  const max = options.maxStalenessBlocks ?? DEFAULT_MAX_STALENESS_BLOCKS;
  if (!Number.isInteger(max) || max < 0) {
    issues.push('maxStalenessBlocks must be a non-negative integer');
  }

  if (issues.length > 0) {
    throw new AgentObservationError('INVALID_OPTIONS', 'observation options are invalid', issues);
  }
  return { networkBlockNumber: BigInt(options.networkBlockNumber), maxStalenessBlocks: max };
}

/**
 * Chain event IDs the agent may cite: confirmed visual-event sources in
 * `txHash:logIndex` form. Off-chain discussion and simulated movement are
 * excluded, and duplicates are removed.
 */
function recentChainEventIds(frame: WorldFrameV1): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const event of frame.simulation.visualEvents) {
    if (event.sourceType !== 'CHAIN') continue;
    if (!CHAIN_SOURCE.test(event.sourceId)) continue;
    const id = event.sourceId.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 200) break;
  }
  return ids;
}

export function buildAgentObservation(
  frame: WorldFrameV1,
  self: OwnerChainState,
  options: ObservationOptions,
): AgentObservationV1 {
  const trustedSelf = validateSelf(self);
  const { networkBlockNumber, maxStalenessBlocks } = validateOptions(options);

  let frameBlock: bigint;
  try {
    frameBlock = BigInt(frame.source.blockNumber);
  } catch {
    throw new AgentObservationError(
      'INVALID_OBSERVATION',
      'frame block number is not a decimal integer string',
    );
  }
  if (frame.source.sync !== 'LIVE') {
    throw new AgentObservationError(
      'SYNC_NOT_LIVE',
      `frame sync is ${frame.source.sync}; actionable observations require LIVE`,
    );
  }
  if (networkBlockNumber < frameBlock) {
    throw new AgentObservationError(
      'STALE_FRAME',
      'network head is behind the frame block',
    );
  }
  if (networkBlockNumber - frameBlock > BigInt(maxStalenessBlocks)) {
    throw new AgentObservationError(
      'STALE_FRAME',
      `frame is ${networkBlockNumber - frameBlock} blocks behind, limit is ${maxStalenessBlocks}`,
    );
  }

  if (trustedSelf.blockNumber !== frame.source.blockNumber) {
    throw new AgentObservationError(
      'BLOCK_MISMATCH',
      `owner state was read at block ${trustedSelf.blockNumber}, frame is at ${frame.source.blockNumber}`,
    );
  }
  if (trustedSelf.blockHash !== undefined && trustedSelf.blockHash !== frame.source.blockHash) {
    throw new AgentObservationError(
      'BLOCK_MISMATCH',
      'owner state block hash does not match the frame block hash',
    );
  }

  const publicContacts = frame.society.agentSummaries
    .filter((summary) => summary.active && summary.owner.toLowerCase() !== trustedSelf.owner)
    .slice(0, MAX_VISIBLE_AGENTS)
    .map(({ agentId, displayName }) => ({ agentId, displayName }));
  const candidate: AgentObservationV1 = {
    worldFrameId: frame.frameId,
    sourceBlock: frame.source.blockNumber,
    epochId: frame.epochId,
    facts: frame.facts,
    self: {
      owner: trustedSelf.owner,
      hasAgentId: trustedSelf.hasAgentId,
      registered: trustedSelf.registered,
      build: trustedSelf.build,
      rep: trustedSelf.rep,
    },
    approvedPublicMessages: frame.society.publicMessages.filter(
      (message) => message.moderation === 'APPROVED',
    ),
    chainRecentEventIds: recentChainEventIds(frame),
    ...(publicContacts.length ? { publicContacts } : {}),
  };

  const parsed = agentObservationV1Schema.safeParse(candidate);
  if (!parsed.success) {
    throw new AgentObservationError(
      'INVALID_OBSERVATION',
      'constructed observation failed schema validation',
      parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    );
  }
  return parsed.data;
}
