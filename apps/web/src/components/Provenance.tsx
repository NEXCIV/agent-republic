import { formatDateTime } from '@/lib/format';
import type { SyncView } from '@/lib/types';

/**
 * Provenance strip (docs/AGENTS.md §4: every surface must state where the
 * number came from). Rendered on every data page.
 */
export function Provenance({ source, sync }: { source: string; sync: SyncView }) {
  const stateLabel =
    sync.state === 'SYNCED' ? 'ON-CHAIN CONFIRMED' : sync.state === 'DELAYED' ? 'SYNC DELAYED' : 'SYNC UNKNOWN';
  const tone = sync.state === 'SYNCED' ? 'confirmed' : sync.state === 'DELAYED' ? 'pending' : 'muted';

  return (
    <div className="row" style={{ marginBottom: 16 }}>
      <span className={`badge ${tone}`}>{stateLabel}</span>
      <span className="hint">
        source: {source} · finalized block {sync.finalizedBlock ?? '—'} · synced{' '}
        {sync.syncedAt === null ? 'never' : formatDateTime(sync.syncedAt)}
      </span>
    </div>
  );
}
