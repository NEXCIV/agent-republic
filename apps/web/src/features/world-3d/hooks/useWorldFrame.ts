'use client';

import { useEffect, useState } from 'react';
import { worldFrameV1Schema } from '@agent-republic/domain';
import type { WorldFrameV1 } from '@agent-republic/domain';

/**
 * E6-04/E6-06 — initial frame from the server plus a coarse 60s refresh.
 *
 * The simulation world tick is 60 seconds, so polling once per tick is enough.
 * Every payload is re-validated against WorldFrameV1; an invalid or failed
 * response keeps the last verified frame. This hook only reads public world
 * state and never writes to the API. SSE integration is tracked separately.
 */

export const WORLD_FRAME_POLL_MS = 60_000;

const CHECK_INTERVAL_MS = 10_000;

export function useWorldFrame(
  initialFrame: WorldFrameV1 | null,
  enabled: boolean,
): WorldFrameV1 | null {
  const [frame, setFrame] = useState<WorldFrameV1 | null>(initialFrame);

  useEffect(() => {
    setFrame(initialFrame);
  }, [initialFrame]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let lastSuccess = Date.now();

    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await fetch('/api/world-frame', { cache: 'no-store' });
        if (!response.ok) return;
        const parsed = worldFrameV1Schema.safeParse(await response.json());
        if (!parsed.success || cancelled) return;
        lastSuccess = Date.now();
        setFrame(parsed.data);
      } catch {
        // Keep the last verified frame; the next tick retries.
      }
    };

    const timer = window.setInterval(() => {
      if (Date.now() - lastSuccess >= WORLD_FRAME_POLL_MS) void load();
    }, CHECK_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSuccess >= WORLD_FRAME_POLL_MS) {
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);

  return frame;
}
