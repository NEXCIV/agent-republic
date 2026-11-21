'use client';

import { useEffect, useState } from 'react';
import { formatDateTime, formatRemaining } from '@/lib/format';

/**
 * Deadline cell: a deterministic UTC timestamp from the server, plus a live
 * remaining-time label that only appears after mount (avoids hydration drift
 * and never shows a stale server-side "time left").
 */
export function Deadline({ value }: { value: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="hash">
      {formatDateTime(value)}
      {now !== null ? <span className="deadline-remaining"> · {formatRemaining(value, now)}</span> : null}
    </span>
  );
}
