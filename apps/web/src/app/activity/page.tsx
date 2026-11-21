import Link from 'next/link';
import { getActivity } from '@/lib/api';
import { formatEventName, shortHash } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { Provenance } from '@/components/Provenance';
import { EmptyState, Unavailable } from '@/components/States';

export const dynamic = 'force-dynamic';

const LIMITS = [50, 100] as const;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string }>;
}) {
  const { limit: rawLimit } = await searchParams;
  const limit =
    rawLimit !== undefined && (LIMITS as readonly number[]).includes(Number(rawLimit)) ? Number(rawLimit) : 50;
  const result = await getActivity(limit);

  return (
    <>
      <PageHeader
        eyebrow="Chain activity · District 01"
        title={
          <>
            Chain <em>activity</em>
          </>
        }
        lede="Confirmed on-chain events only. Pending and reorged transactions are deliberately absent — a reorg removes
        an entry instead of leaving a false milestone."
        meta={['Chain 56 / Read-only', 'Finalized events only']}
      >
        {result.ok ? <Provenance source={result.body.source} sync={result.body.sync} /> : null}
      </PageHeader>

      <div className="filters">
        {LIMITS.map((value) => (
          <Link
            key={value}
            href={value === 50 ? '/activity' : `/activity?limit=${value}`}
            aria-current={limit === value ? 'page' : undefined}
          >
            Latest {value}
          </Link>
        ))}
      </div>

      {!result.ok ? (
        <Unavailable resource="Activity feed" />
      ) : (
        <>
          {result.body.data.length === 0 ? (
            <EmptyState
              title="No confirmed events yet"
              detail="Nothing is displayed until the indexer has finalized on-chain events."
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Block</th>
                    <th scope="col">Event</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {result.body.data.map((item) => (
                    <tr key={`${item.txHash}:${item.logIndex}`}>
                      <td className="hash">{item.blockNumber}</td>
                      <td>{formatEventName(item.eventName)}</td>
                      <td className="hash">{item.owner === null ? '—' : shortHash(item.owner)}</td>
                      <td className="hash">
                        <Link href={`/tx/${item.txHash}`}>{shortHash(item.txHash)}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.body.data.length > 0 ? (
            <p className="hint" style={{ marginTop: 14 }}>
              Showing the latest {result.body.data.length} confirmed event
              {result.body.data.length === 1 ? '' : 's'}. The feed is capped by the indexer&apos;s maximum page size;
              older events remain queryable on BscScan.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
