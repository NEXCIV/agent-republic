import { notFound } from 'next/navigation';
import { getTxStatus } from '@/lib/api';
import { explorerTxUrl, formatEventName } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { Unavailable } from '@/components/States';

export const dynamic = 'force-dynamic';

const TONE: Record<string, string> = {
  CONFIRMED: 'confirmed',
  INCLUDED: 'pending',
  PENDING: 'pending',
  FAILED: 'failed',
  UNKNOWN: 'muted',
};

const EXPLANATION: Record<string, string> = {
  CONFIRMED: 'A finalized on-chain event was indexed. This is the only status that counts as success.',
  INCLUDED: 'Included in a block but not yet finalized. Do not treat this as complete.',
  PENDING: 'Recorded, but no receipt or event yet. PENDING is not confirmation.',
  FAILED: 'The transaction reverted on chain.',
  UNKNOWN: 'No transaction, intent or receipt is known for this hash.',
};

export default async function TxPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) notFound();

  const result = await getTxStatus(hash.toLowerCase());
  if (!result.ok) {
    return (
      <>
        <PageHeader eyebrow="Evidence · BNB Smart Chain" title="Transaction" back={{ href: '/activity', label: 'Activity' }} />
        <Unavailable resource="Transaction status" />
      </>
    );
  }

  const data = result.body;
  const explorer = explorerTxUrl(data.chainId, data.txHash);

  return (
    <>
      <PageHeader
        eyebrow="Evidence · BNB Smart Chain"
        title={
          <>
            Transaction <em>status</em>
          </>
        }
        back={{ href: '/activity', label: 'Activity' }}
        meta={[`Chain ${data.chainId} / Read-only`, 'PENDING is not confirmation']}
      />
      <div className="panel">
        <div className="row">
          <span className={`badge ${TONE[data.status] ?? 'muted'}`}>{data.status}</span>
          <span className="hint">source: {data.source}</span>
          {data.receiptBlockNumber !== null ? (
            <span className="hint">receipt block: {data.receiptBlockNumber}</span>
          ) : null}
        </div>
        <p className="hash" style={{ marginBottom: 8 }}>
          {data.txHash}
        </p>
        <p className="hint" style={{ marginTop: 0 }}>
          {EXPLANATION[data.status]}
        </p>
        {data.note !== undefined ? <p className="hint">{data.note}</p> : null}
        {explorer !== null ? (
          <p style={{ marginBottom: 0 }}>
            <a href={explorer} rel="noreferrer noopener" target="_blank">
              View on BscScan →
            </a>
          </p>
        ) : null}
      </div>

      <h2>Indexed events</h2>
      {data.events.length === 0 ? (
        <p className="hint">No confirmed events indexed for this transaction.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Block</th>
                <th scope="col">Finalized</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((event, index) => (
                <tr key={`${event.eventName}:${index}`}>
                  <td>{formatEventName(event.eventName)}</td>
                  <td className="hash">{event.blockNumber}</td>
                  <td>{event.confirmed ? 'YES' : 'NO'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
