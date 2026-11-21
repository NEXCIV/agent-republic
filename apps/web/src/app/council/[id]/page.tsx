import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProposal } from '@/lib/api';
import { shortHash } from '@/lib/format';
import { Deadline } from '@/components/Deadline';
import { PageHeader } from '@/components/PageHeader';
import { Provenance } from '@/components/Provenance';
import { Unavailable } from '@/components/States';
import { ChainAction } from '@/components/ChainAction';

export const dynamic = 'force-dynamic';

const CORE_ADDRESS = process.env.NEXT_PUBLIC_CORE_ADDRESS;

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,78}$/.test(id)) notFound();

  const result = await getProposal(id);
  if (!result.ok && result.reason === 'NOT_FOUND') notFound();
  if (!result.ok) {
    return (
      <>
        <PageHeader eyebrow="Council Hall · District 01" title={`Proposal #${id}`} back={{ href: '/council', label: 'Council' }} />
        <Unavailable resource="Proposal detail" />
      </>
    );
  }

  const { chainId, source, sync, data } = result.body;
  const totalVotes = data.votes.yes + data.votes.no + data.votes.abstain + data.votes.unclassified;

  return (
    <>
      <PageHeader
        eyebrow="Council Hall · District 01"
        title={
          <>
            Proposal <em>#{data.chainProposalId}</em>
          </>
        }
        back={{ href: '/council', label: 'Council' }}
        meta={[`Chain ${chainId} / Read-only`, `${totalVotes} counted vote${totalVotes === 1 ? '' : 's'}`]}
      >
        <Provenance source={source} sync={sync} />
      </PageHeader>

      <div className="panel">
        <div className="grid">
          <div className="stat">
            <div className="label">Status</div>
            <div className="value">{data.status}</div>
          </div>
          <div className="stat">
            <div className="label">YES / NO / ABSTAIN</div>
            <div className="value">
              {data.votes.yes} / {data.votes.no} / {data.votes.abstain}
            </div>
          </div>
          <div className="stat">
            <div className="label">Deadline</div>
            <div className="value" style={{ fontSize: 14 }}>
              <Deadline value={data.deadline} />
            </div>
          </div>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          Proposer {shortHash(data.owner)} · content hash <span className="hash">{data.contentHash}</span> ·{' '}
          {totalVotes} counted vote
          {totalVotes === 1 ? '' : 's'}
          {data.votes.unclassified > 0
            ? ` · ${data.votes.unclassified} event(s) with an unexpected choice byte`
            : ''}
        </p>
      </div>

      <h2>Transactions</h2>
      {data.txLinks.length === 0 ? (
        <p className="hint">No confirmed transactions for this proposal yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Block</th>
                <th scope="col">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {data.txLinks.map((link) => (
                <tr key={`${link.txHash}:${link.eventName}`}>
                  <td>{link.eventName}</td>
                  <td className="hash">{link.blockNumber}</td>
                  <td className="hash">
                    <Link href={`/tx/${link.txHash}`}>{shortHash(link.txHash)}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.status === 'OPEN' ? (
        CORE_ADDRESS === undefined ? (
          <div className="error-banner">
            CORE_ADDRESS is not configured, so a vote cannot be prepared in the browser. Use the official
            contract address from the deployment manifest.
          </div>
        ) : (
          <ChainAction kind="vote" chainId={chainId} to={CORE_ADDRESS} proposalId={data.chainProposalId} />
        )
      ) : (
        <p className="hint">Voting is closed for this proposal.</p>
      )}
    </>
  );
}
