'use client';

import type { WorldFrameV1 } from '@agent-republic/domain';

/**
 * E6-06 — trust banner for the live world frame. DELAYED/OFFLINE says which
 * block was last verified; REORG_RECOVERY explicitly pauses milestone effects.
 */
export function WorldFrameStatus({ frame }: { frame: WorldFrameV1 | null }) {
  if (frame === null) return null;

  if (frame.source.sync === 'REORG_RECOVERY') {
    return (
      <div className="world-alert danger" role="status">
        Chain reconciliation in progress — confirmed event highlights are paused.
      </div>
    );
  }

  if (frame.source.sync !== 'LIVE') {
    return (
      <p className="world-alert warning" role="status">
        Chain data {frame.source.sync.toLowerCase()} · last verified block {frame.source.blockNumber}. Confirmed
        milestones wait for a consistent frame.
      </p>
    );
  }

  return (
    <p className="hint world-frame-line">
      World frame block {frame.source.blockNumber} · tick {frame.simulation.tick} · LIVE
    </p>
  );
}
