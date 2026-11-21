import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProject } from '@/lib/api';
import { buildPercent, formatDateTime, shortHash } from '@/lib/format';
import { Provenance } from '@/components/Provenance';
import { Unavailable } from '@/components/States';
import { ChainAction } from '@/components/ChainAction';

export const dynamic = 'force-dynamic';

const CORE_ADDRESS = process.env.NEXT_PUBLIC_CORE_ADDRESS;

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,78}$/.test(id)) notFound();

  const result = await getProject(id);
  if (!result.ok && result.reason === 'NOT_FOUND') notFound();
  if (!result.ok) {
    return (
      <>
        <h1>Project #{id}</h1>
        <Unavailable resource="Project detail" />
      </>
    );
  }

  const { chainId, source, sync, data } = result.body;
  const percent = buildPercent(data.fundedBuild, data.goalBuild);
  // Contributions cannot exceed the remaining goal (AGENTS.md §3).
  const remainingBuild = (() => {
    try {
      const remaining = BigInt(data.goalBuild) - BigInt(data.fundedBuild);
      return remaining < 0n ? 0n : remaining;
    } catch {
      return 0n;
    }
  })();

  return (
    <>
      <p className="breadcrumb">
        <Link href="/projects">Projects</Link>
        <span>/</span>
        <span>Project #{data.chainProjectId}</span>
      </p>

      <section className="project-hero reveal">
        <div>
          <p className="eyebrow">Public works · Genesis district</p>
          <h1 className="display-xl">{data.name}</h1>
          <div className="row" style={{ marginBottom: 14 }}>
            <span className="stamp">{data.state}</span>
            <span className="hint">
              Project #{data.chainProjectId} · updated {formatDateTime(data.updatedAt)}
            </span>
          </div>
          <Provenance source={source} sync={sync} />
          <p className="hint" style={{ maxWidth: '56ch' }}>
            Progress counts confirmed contributions only. Submitted or pending transactions never move the funding
            line or the construction stage.
          </p>
        </div>

        <div className="project-metric">
          <div className="project-metric__value">
            {data.fundedBuild}
            <small>/ {data.goalBuild} BUILD</small>
          </div>
          <div
            className="progress progress--lg"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${data.name} funding progress`}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <div className="project-metric__meta">
            <span>{percent}% confirmed</span>
            <span>Goal {data.goalBuild} BUILD</span>
          </div>
        </div>
      </section>

      <div className="two-col reveal">
        <section>
          <div className="section-head">
            <span className="section-index">01</span>
            <h2>Contributors</h2>
          </div>
          {data.contributors.length === 0 ? (
            <p className="hint">No confirmed contributions yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Owner</th>
                    <th scope="col">BUILD contributed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.contributors.map((contributor) => (
                    <tr key={contributor.owner}>
                      <td className="hash">{shortHash(contributor.owner, 12, 8)}</td>
                      <td>{contributor.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <div className="section-head">
            <span className="section-index">02</span>
            <h2>Confirmed transactions</h2>
          </div>
          {data.txLinks.length === 0 ? (
            <p className="hint">No confirmed transactions for this project yet.</p>
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
        </section>
      </div>

      <div className="section reveal">
        <div className="section-head">
          <span className="section-index">03</span>
          <h2>Prepare a contribution</h2>
        </div>
        {data.state === 'FUNDING' ? (
          CORE_ADDRESS === undefined ? (
            <div className="error-banner">
              CORE_ADDRESS is not configured, so a contribution cannot be prepared in the browser. Use the official
              contract address from the deployment manifest.
            </div>
          ) : (
            <ChainAction
              kind="contribute"
              chainId={chainId}
              to={CORE_ADDRESS}
              projectId={data.chainProjectId}
              maxAmount={remainingBuild}
            />
          )
        ) : (
          <p className="hint">This project is complete; contributions are closed.</p>
        )}
      </div>
    </>
  );
}
