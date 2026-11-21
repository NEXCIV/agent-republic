'use client';

import Link from 'next/link';
import type { WorldFrameV1 } from '@agent-republic/domain';
import { shortHash } from '@/lib/format';
import { chainSourceTxHash } from './milestones';

/**
 * E6-06 — confirmed audit trail next to the 3D scene.
 *
 * Only `sourceType=CHAIN` visual events are listed and linked to their tx.
 * During REORG_RECOVERY the whole list is withdrawn instead of showing a
 * milestone that may have been rolled back.
 */
export function WorldAuditEvents({ frame }: { frame: WorldFrameV1 | null }) {
  const recent =
    frame === null
      ? []
      : frame.simulation.visualEvents
          .filter((event) => event.sourceType === 'CHAIN')
          .slice(-8)
          .reverse();

  return (
    <section className="world-audit reveal">
      <h2>Recent audit events</h2>
      {frame === null ? (
        <p className="hint">Audit events are unavailable until the world frame is reachable.</p>
      ) : frame.source.sync === 'REORG_RECOVERY' ? (
        <div className="world-alert danger" role="status">
          Chain reconciliation in progress. Confirmed event highlights are withdrawn until the projection is
          consistent.
        </div>
      ) : (
        <>
          <p className="hint">
            <span className="badge confirmed">ON-CHAIN CONFIRMED</span> Only confirmed chain events appear here.
            AI discussion, submitted transactions and simulated movement never count as audit entries.
          </p>
          {recent.length === 0 ? (
            <p className="hint">No confirmed audit events in this frame.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Target</th>
                    <th scope="col">Tick</th>
                    <th scope="col">Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((event) => {
                    const txHash = chainSourceTxHash(event.sourceId);
                    return (
                      <tr key={event.id}>
                        <td>{event.kind}</td>
                        <td className="hash">{event.targetId}</td>
                        <td className="hash">{event.happenedAtTick}</td>
                        <td className="hash">
                          {txHash === null ? (
                            event.sourceId
                          ) : (
                            <Link href={`/tx/${txHash}`}>{shortHash(txHash)}</Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">
            Frame tick {frame.simulation.tick} · sync {frame.source.sync} · reorged events disappear from this list.
          </p>
        </>
      )}
    </section>
  );
}
