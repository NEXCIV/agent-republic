import Link from 'next/link';
import { getProjects } from '@/lib/api';
import { buildPercent } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { Provenance } from '@/components/Provenance';
import { EmptyState, Unavailable } from '@/components/States';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const result = await getProjects();

  return (
    <>
      <PageHeader
        eyebrow="Public works · District 01"
        title={
          <>
            Public <em>works</em>
          </>
        }
        lede="BUILD spent on a project is consumed, not invested. Progress is derived only from confirmed contributions;
        pending transactions never advance the bar."
        meta={['Chain 56 / Read-only', 'Confirmed contributions only']}
      >
        {result.ok ? <Provenance source={result.body.source} sync={result.body.sync} /> : null}
      </PageHeader>

      {!result.ok ? (
        <Unavailable resource="Project data" />
      ) : (
        <>
          {result.body.data.length === 0 ? (
            <EmptyState
              title="No projects indexed yet"
              detail="A project appears here once its ProjectCreated event is confirmed."
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">Name</th>
                    <th scope="col">Funding</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.body.data.map((project) => {
                    const percent = buildPercent(project.fundedBuild, project.goalBuild);
                    return (
                      <tr key={project.chainProjectId}>
                        <td>
                          <Link href={`/projects/${project.chainProjectId}`}>#{project.chainProjectId}</Link>
                        </td>
                        <td>{project.name}</td>
                        <td>
                          <div
                            className="progress"
                            role="progressbar"
                            aria-valuenow={percent}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${project.name} funding progress`}
                          >
                            <span style={{ width: `${percent}%` }} />
                          </div>
                          <span className="hint">
                            {project.fundedBuild} / {project.goalBuild} BUILD ({percent}%)
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${project.state === 'COMPLETED' ? 'confirmed' : 'muted'}`}>
                            {project.state}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
