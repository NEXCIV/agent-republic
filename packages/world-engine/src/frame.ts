import {
  worldFrameV1Schema,
  type WorldFacts,
  type WorldFrameV1,
  type WorldSimulation,
  type WorldSociety,
  type WorldSyncState,
} from '@agent-republic/domain';
import { withFrameId } from './frame-id.js';

/**
 * E5-06 WorldFrameV1 assembly.
 *
 * Combines the three trust layers into the single protocol object:
 *   facts (confirmed chain) + society (moderated AI speech) + simulation (visual)
 * frameId covers the whole content except generatedAt (docs/WORLD_ENGINE.md §2.1).
 */

export type WorldFrameSourceInput = {
  readonly chainId: 56 | 97;
  /** Highest finalized block the facts were built from. */
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly blockTimestamp: string;
  readonly confirmedDepth: number;
  readonly sync: WorldSyncState;
};

export type BuildWorldFrameInput = {
  readonly source: WorldFrameSourceInput;
  readonly facts: WorldFacts;
  readonly society: WorldSociety;
  readonly simulation: WorldSimulation;
  readonly generatedAt: string;
};

export class WorldFrameBuildError extends Error {
  constructor(message: string) {
    super(`[world-frame-build] ${message}`);
    this.name = 'WorldFrameBuildError';
  }
}

/** epochId = UTC day of the confirmed block timestamp (not server time). */
export function epochIdFromTimestamp(iso: string): number {
  const milliseconds = Date.parse(iso);
  if (!Number.isFinite(milliseconds)) {
    throw new WorldFrameBuildError(`invalid block timestamp "${iso}"`);
  }
  return Math.floor(milliseconds / 86_400_000);
}

/**
 * Builds and validates a frame. Any schema violation throws — the API must
 * return an error rather than serve a malformed world.
 */
export function buildWorldFrame(input: BuildWorldFrameInput): WorldFrameV1 {
  const frame = withFrameId({
    schemaVersion: '1.1',
    generatedAt: input.generatedAt,
    source: { ...input.source, provenance: 'CHAIN_CONFIRMED' },
    epochId: epochIdFromTimestamp(input.source.blockTimestamp),
    facts: input.facts,
    society: input.society,
    simulation: input.simulation,
  });

  const parsed = worldFrameV1Schema.safeParse(frame);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new WorldFrameBuildError(
      `assembled frame is invalid at "${first?.path.join('.')}": ${first?.message}`,
    );
  }
  return parsed.data;
}
