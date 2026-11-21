'use client';

import { useEffect, useRef, useState } from 'react';
import type { LandmarkId, WorldFrameV1 } from '@agent-republic/domain';
import { milestoneKey, milestoneTarget, selectMilestonePulse } from './milestones';

export type ActiveMilestone = {
  readonly key: string;
  readonly targetId: LandmarkId;
};

/**
 * E6-06 — de-duplicated milestone pulse state.
 *
 * The initial frame only seeds the seen set. Later frames may produce one pulse
 * for the latest unseen CHAIN milestone. Reduced-motion users and reorg frames
 * never produce an animation, but their keys are still recorded so nothing is
 * replayed after the interruption.
 */
export function useMilestonePulse(frame: WorldFrameV1 | null, enabled: boolean) {
  const [pulse, setPulse] = useState<ActiveMilestone | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  const reduced = useRef(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced.current = query.matches;
    const onChange = (event: MediaQueryListEvent) => {
      reduced.current = event.matches;
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (frame === null) return;
    if (frame.source.sync === 'REORG_RECOVERY') setPulse(null);

    const selection = selectMilestonePulse({
      frame,
      seen: seen.current,
      seeded: seeded.current,
    });
    seen.current = selection.keys;
    seeded.current = true;

    if (!enabled || reduced.current || selection.event === null) return;
    const targetId = milestoneTarget(selection.event.targetId);
    if (targetId === null) return;

    setPulse({
      key: milestoneKey(frame.source.chainId, selection.event.sourceId, frame.simulation.sceneVersion),
      targetId,
    });
  }, [frame, enabled]);

  return { pulse, complete: () => setPulse(null) };
}
