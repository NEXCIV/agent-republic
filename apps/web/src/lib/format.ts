export function buildPercent(funded: string, goal: string): number {
  try {
    const goalValue = BigInt(goal);
    if (goalValue === 0n) return 0;
    const fundedValue = BigInt(funded);
    return Math.min(100, Number((fundedValue * 1000n) / goalValue) / 10);
  } catch {
    return 0;
  }
}

export function shortHash(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function explorerTxUrl(chainId: number, txHash: string): string | null {
  if (chainId === 56) return `https://bscscan.com/tx/${txHash}`;
  if (chainId === 97) return `https://testnet.bscscan.com/tx/${txHash}`;
  return null;
}

export function formatEventName(eventName: string): string {
  return eventName.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * Deterministic UTC timestamp "YYYY-MM-DD HH:mm UTC". Pure string math on the
 * UTC getters so server and client renders always agree (no locale drift).
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}

/** Compact remaining-time label for countdowns ("3d 04h", "12m", "closed"). */
export function formatRemaining(deadline: string, now: number): string {
  const target = new Date(deadline).getTime();
  if (Number.isNaN(target)) return '—';
  const ms = target - now;
  if (ms <= 0) return 'closed';
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}h left`;
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m left`;
  return `${minutes}m left`;
}
