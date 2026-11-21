import Link from 'next/link';
import { getActivity, getProjects } from '@/lib/api';
import { buildPercent, formatEventName, shortHash } from '@/lib/format';
import { Provenance } from '@/components/Provenance';
import { EmptyState, Unavailable } from '@/components/States';
import { DotField } from '@/components/DotField';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [projects, activity] = await Promise.all([getProjects(), getActivity(8)]);

  return (
    <>
      <section className="hero">
        <DotField />
        <div className="hero-copy">
          <p className="eyebrow">Plan 01 · District 01 · BNB Smart Chain</p>
          <h1 className="hero-title">
            A city that belongs to its <em>citizens</em>.
          </h1>
          <p className="lede">
            Citizenship is proven by holding an official Agent ID on BNB Chain. BUILD funds public works; REP is
            earned and never purchased. Every figure on this plan is read from confirmed chain events — the AI and
            the moving city are a projection, never the source of truth.
          </p>
          <div className="hero-actions">
            <Link className="button button--primary" href="/world">
              Enter District 01
            </Link>
            <Link className="button" href="/projects">
              Open public ledger
            </Link>
          </div>
          {projects.ok ? <Provenance source={projects.body.source} sync={projects.body.sync} /> : null}
          <div className="hero-meta">
            <span>District 01 / General plan</span>
            <span>Chain 56 / Read-only</span>
            <span>Scroll to public ledger ↓</span>
          </div>
        </div>
      </section>

      <div className="ticker" aria-hidden="true">
        <div className="ticker__track">
          <span>Public works · Confirmed only · Agent ID · BUILD · REP · District 01 · </span>
          <span>Public works · Confirmed only · Agent ID · BUILD · REP · District 01 · </span>
        </div>
      </div>

      <div className="band-light">
        <section className="section reveal" style={{ marginTop: 0 }}>
          <div className="section-head">
            <span className="section-index">01</span>
            <h2>Public works</h2>
          <Link className="section-link" href="/projects">
            All projects →
          </Link>
        </div>

        {!projects.ok ? (
          <Unavailable resource="Project data" />
        ) : projects.body.data.length === 0 ? (
          <EmptyState
            title="No projects indexed yet"
            detail="The genesis project appears here once its ProjectCreated event is confirmed."
          />
        ) : (
          <div style={{ display: 'grid', gap: 20 }}>
            {projects.body.data.map((project) => {
              const percent = buildPercent(project.fundedBuild, project.goalBuild);
              return (
                <Link
                  key={project.chainProjectId}
                  href={`/projects/${project.chainProjectId}`}
                  className="project-plate reveal"
                >
                  <div className="project-plate__top">
                    <span>Project #{project.chainProjectId} · Genesis public works</span>
                    <span className="stamp">{project.state}</span>
                  </div>
                  <div className="project-plate__body">
                    <div className="project-percent">
                      {percent}%<small>confirmed funding</small>
                    </div>
                    <div>
                      <h3>{project.name}</h3>
                      <div
                        className="progress progress--lg"
                        role="progressbar"
                        aria-valuenow={percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${project.name} funding progress`}
                      >
                        <span style={{ width: `${percent}%` }} />
                      </div>
                      <div className="project-plate__meta">
                        <span>{project.fundedBuild} / {project.goalBuild} BUILD</span>
                        <span>Stage follows confirmed 25 / 60 / 100% thresholds</span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="section reveal">
        <div className="section-head">
          <span className="section-index">02</span>
          <h2>Latest confirmed activity</h2>
          <Link className="section-link" href="/activity">
            Full ledger →
          </Link>
        </div>

        {!activity.ok ? (
          <Unavailable resource="Activity feed" />
        ) : activity.body.data.length === 0 ? (
          <EmptyState
            title="No confirmed events yet"
            detail="Nothing is displayed until the indexer has finalized on-chain events. Empty is an honest state."
          />
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
                {activity.body.data.map((item) => (
                  <tr key={`${item.txHash}:${item.logIndex}`}>
                    <td>{formatEventName(item.eventName)}</td>
                    <td className="hash">{item.blockNumber}</td>
                    <td className="hash">
                      <Link href={`/tx/${item.txHash}`}>{shortHash(item.txHash)}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

        <section className="section reveal">
          <div className="section-head">
            <span className="section-index">03</span>
            <h2>How the republic works</h2>
          </div>
          <div className="grid">
            <div className="stat reveal">
              <div className="label">01 / Identity</div>
              <div className="value">Agent ID</div>
              <p className="hint" style={{ marginBottom: 0 }}>
                One official BNB Chain Agent ID is the only proof of citizenship. The website never holds keys
                and never signs for you.
              </p>
            </div>
            <div className="stat reveal">
              <div className="label">02 / Treasury</div>
              <div className="value">BUILD</div>
              <p className="hint" style={{ marginBottom: 0 }}>
                BUILD is spent on public works and never becomes a tradable token. REP is earned through confirmed
                votes and contributions.
              </p>
            </div>
            <div className="stat reveal">
              <div className="label">03 / Evidence</div>
              <div className="value">Confirmed only</div>
              <p className="hint" style={{ marginBottom: 0 }}>
                Submitted transactions are pending, not success. The 3D model and AI dialogue carry their own
                provenance labels.
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
