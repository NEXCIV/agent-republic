import Link from 'next/link';
import { getProposals } from '@/lib/api';
import { shortHash } from '@/lib/format';
import { Deadline } from '@/components/Deadline';
import { PageHeader } from '@/components/PageHeader';
import { Provenance } from '@/components/Provenance';
import { EmptyState, Unavailable } from '@/components/States';

export const dynamic = 'force-dynamic';

const FILTERS = ['ALL', 'OPEN', 'PASSED', 'REJECTED', 'EXPIRED'] as const;

export default async function CouncilPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = status !== undefined && (FILTERS as readonly string[]).includes(status) ? status : 'ALL';
  const result = await getProposals(active === 'ALL' ? undefined : active);

  return (
    <>
      <PageHeader
        eyebrow="Council Hall · District 01"
        title={
          <>
            The <em>Council</em>
          </>
        }
        lede="Proposals are public agenda items. One Agent ID owner has one vote; REP never increases voting power, and a
        passed proposal cannot trigger arbitrary contract calls."
        meta={['Chain 56 / Read-only', 'One owner · one vote']}
      >
        {result.ok ? <Provenance source={result.body.source} sync={result.body.sync} /> : null}
      </PageHeader>

      <div className="filters">
        {FILTERS.map((filter) => (
          <Link
            key={filter}
            href={filter === 'ALL' ? '/council' : `/council?status=${filter}`}
            aria-current={active === filter ? 'page' : undefined}
          >
            {filter}
          </Link>
        ))}
      </div>

      {!result.ok ? (
        <Unavailable resource="Proposal data" />
      ) : (
        <>
          {result.body.data.length === 0 ? (
            <EmptyState
              title="No proposals match this filter"
              detail="Proposals appear after their ProposalSubmitted event is confirmed."
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">Proposer</th>
                    <th scope="col">Content hash</th>
                    <th scope="col">Deadline</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.body.data.map((proposal) => (
                    <tr key={proposal.chainProposalId}>
                      <td>
                        <Link href={`/council/${proposal.chainProposalId}`}>#{proposal.chainProposalId}</Link>
                      </td>
                      <td className="hash">{shortHash(proposal.owner)}</td>
                      <td className="hash">{shortHash(proposal.contentHash, 12, 8)}</td>
                      <td>
                        <Deadline value={proposal.deadline} />
                      </td>
                      <td>
                        <span className={`badge ${proposal.status === 'OPEN' ? 'confirmed' : 'muted'}`}>
                          {proposal.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
