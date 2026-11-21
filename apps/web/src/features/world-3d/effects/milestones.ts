import type { LandmarkId, WorldFrameV1 } from '@agent-republic/domain';

/**
 * E6-06 — audit/milestone event selection for the 3D layer.
 *
 * Animation de-duplication key = (chainId, txHash:logIndex, sceneVersion), as
 * required by docs/3D_RENDERING.md §7. Only CHAIN + MILESTONE events may pulse
 * a building; AI text, simulated movement and pending transactions never do.
 * During REORG_RECOVERY no new pulse is produced and only the current frame's
 * events remain in the seen set, so a withdrawn event can never keep glowing.
 */

export type ChainMilestone = WorldFrameV1['simulation']['visualEvents'][number];

export function milestoneKey(chainId: number, sourceId: string, sceneVersion: string): string {
  return `${chainId}:${sourceId.toLowerCase()}:${sceneVersion}`;
}

/** Returns the tx hash from a `txHash:logIndex` chain source, or null. */
export function chainSourceTxHash(sourceId: string): string | null {
  const hash = sourceId.split(':')[0] ?? '';
  const normalized = hash.toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

/** Maps a visual-event target to the landmark that should react. */
export function milestoneTarget(targetId: string): LandmarkId | null {
  if (targetId === 'IDENTITY') return 'IDENTITY';
  if (targetId.startsWith('project:')) return 'PROJECT';
  if (targetId.startsWith('proposal:')) return 'COUNCIL';
  return null;
}

export function chainMilestones(frame: WorldFrameV1): ChainMilestone[] {
  return frame.simulation.visualEvents.filter(
    (event) => event.sourceType === 'CHAIN' && event.kind === 'MILESTONE',
  );
}

export type MilestoneSelection = {
  /** Keys present in the current frame only; removed (reorged) keys drop out. */
  readonly keys: Set<string>;
  /** Event to animate once, or null for the initial frame / reorg / no news. */
  readonly event: ChainMilestone | null;
};

export function selectMilestonePulse(input: {
  readonly frame: WorldFrameV1;
  readonly seen: ReadonlySet<string>;
  readonly seeded: boolean;
}): MilestoneSelection {
  const events = chainMilestones(input.frame);
  const keys = new Set(
    events.map((event) =>
      milestoneKey(input.frame.source.chainId, event.sourceId, input.frame.simulation.sceneVersion),
    ),
  );

  // The first frame after a page load is the final pose, never a replay.
  if (!input.seeded) return { keys, event: null };
  if (input.frame.source.sync === 'REORG_RECOVERY') return { keys, event: null };

  let latest: ChainMilestone | null = null;
  for (const event of events) {
    const key = milestoneKey(input.frame.source.chainId, event.sourceId, input.frame.simulation.sceneVersion);
    if (!input.seen.has(key)) latest = event;
  }
  return { keys, event: latest };
}
