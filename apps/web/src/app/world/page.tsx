import Link from 'next/link';
import { DISTRICT_01, worldFrameV1Schema } from '@agent-republic/domain';
import { getProject, getWorldFrame } from '@/lib/api';
import { Provenance } from '@/components/Provenance';
import { EmptyState, Unavailable } from '@/components/States';
import { WorldCanvas } from '@/features/world-3d/WorldCanvas';
import { WorldDirectory } from '@/features/world-3d/WorldDirectory';
import { toAgentMarkers } from '@/features/world-3d/agents/toAgentMarkers';
import { commandLink } from '@/features/agent-commands/world-command';
import { PROJECT_STAGE_LABELS, toProjectStageView } from '@/features/world-3d/adapters/projectStage';

export const dynamic = 'force-dynamic';

const GENESIS_PROJECT_ID = '1';

/**
 * E6-01/E6-03 — District 01 overview.
 *
 * The 3D canvas is a progressive enhancement. The directory below it is the
 * accessible, server-rendered equivalent and links into the same PRD routes,
 * so a missing WebGL context never blocks navigation or trading pages.
 *
 * The tower's construction stage is derived only from the projection of
 * confirmed project amounts; an unavailable API never produces a fake stage.
 */
export default async function WorldPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const no3d = params.no3d === '1';
  const [project, frameResult] = await Promise.all([getProject(GENESIS_PROJECT_ID), getWorldFrame()]);
  const parsedFrame = frameResult.ok ? worldFrameV1Schema.safeParse(frameResult.body) : null;
  const worldFrame = parsedFrame?.success === true ? parsedFrame.data : null;
  const agents = worldFrame === null ? [] : toAgentMarkers(worldFrame.simulation.agents);
  const confirmed = project.ok ? project.body.data : null;
  const stageView = toProjectStageView(
    confirmed === null
      ? null
      : { fundedBuild: confirmed.fundedBuild, goalBuild: confirmed.goalBuild, state: confirmed.state },
  );
  const percent =
    stageView.progressBasisPoints === null ? null : Math.floor(stageView.progressBasisPoints / 100);
  const stageLabel = stageView.stage === null ? 'SYNC ISSUE' : PROJECT_STAGE_LABELS[stageView.stage];

  return (
    <>
      <p className="eyebrow">Plan 01 · District 01 · Fixed orthographic view</p>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 24 }}>
        <div>
          <h1>District 01</h1>
          <p className="lede">
            An orthographic model of the capital district. The camera is fixed; buildings and the plaza are placed
            by the published scene manifest, not by hand-written page coordinates.
          </p>
        </div>
        <Link className="button" href={no3d ? '/world' : '/world?no3d=1'}>
          {no3d ? 'Try the 3D view' : 'Text-only view'}
        </Link>
      </div>

      {project.ok ? <Provenance source={project.body.source} sync={project.body.sync} /> : null}

      <div className="plate-head" style={{ marginTop: 22 }}>
        <span>District 01 / live model</span>
        <span>{stageLabel}</span>
      </div>
      <WorldCanvas forceFallback={no3d} projectStage={stageView.stage} initialFrame={worldFrame} />
      <div className="plate-legend" style={{ marginTop: 10 }}>
        <span>
          <i className="swatch swatch--project" /> Public works
        </span>
        <span>
          <i className="swatch swatch--civic" /> Civic buildings
        </span>
        <span>Click a building or agent · Esc clears</span>
      </div>

      <p className="hint">
        {DISTRICT_01.sceneVersion} · ground {DISTRICT_01.ground.width}×{DISTRICT_01.ground.depth} m · rendered
        locally. 3D movement and lighting are presentation only; BUILD, REP, votes and permissions always come from
        confirmed chain events.
      </p>

      <div className="section-head reveal">
        <span className="section-index">01</span>
        <h2>Construction status</h2>
      </div>
      {!project.ok ? (
        <>
          <Unavailable resource="Project #1 confirmed data" />
          <p className="hint">
            The tower is rendered as an empty construction site. No stage or progress is shown until confirmed
            on-chain data is reachable.
          </p>
        </>
      ) : !stageView.available ? (
        <div className="error-banner">
          Project amounts could not be interpreted. Stage and completion visuals are withheld.
        </div>
      ) : (
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="badge muted">
              {confirmed?.name ?? 'Golden Toilet Tower'} · Project #{GENESIS_PROJECT_ID}
            </span>
            <span
              data-testid="world-stage-badge"
              className={`badge ${
                stageView.inconsistent ? 'pending' : stageView.complete ? 'confirmed' : 'muted'
              }`}
            >
              {stageView.inconsistent ? 'SYNC ISSUE' : stageLabel}
            </span>
          </div>

          <div
            className="progress"
            role="progressbar"
            aria-valuenow={percent ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Project #${GENESIS_PROJECT_ID} confirmed funding progress`}
          >
            <span style={{ width: `${percent ?? 0}%` }} />
          </div>

          <p className="hint">
            {stageView.fundedBuild} / {stageView.goalBuild} BUILD confirmed
            {percent === null ? '' : ` · ${percent}%`} · stage changes only when confirmed events cross 25%, 60% or
            100%. Submitted or pending transactions never move the model.
          </p>
          {stageView.inconsistent ? (
            <p className="hint" style={{ color: 'var(--warning)', marginBottom: 0 }}>
              Contract status and confirmed amount disagree. The completed model is withheld until both agree.
            </p>
          ) : (
            <p className="hint" style={{ marginBottom: 0 }}>
              <Link href={`/projects/${GENESIS_PROJECT_ID}`}>Open project #{GENESIS_PROJECT_ID}</Link>
            </p>
          )}
        </div>
      )}

      <div className="section-head reveal">
        <span className="section-index">02</span>
        <h2>Simulated agents</h2>
      </div>
      <p className="hint">
        <span className="badge muted">AI SIMULATED</span> Agent positions are deterministic presentation state from
        the world tick, never chain facts or a real user count. The 3D view interpolates new positions at no more
        than 1.4 m/s; this table lists the frame captured when the page rendered.
      </p>
      {worldFrame === null ? (
        <Unavailable resource="World simulation frame" />
      ) : agents.length === 0 ? (
        <EmptyState
          title="No renderable agents in this frame"
          detail="A frame with zero agents, or only invalid positions, renders no markers. The world never invents citizens."
        />
      ) : (
        <>
          <p className="hint">
            frame {worldFrame.frameId.slice(0, 16)}… · tick {worldFrame.simulation.tick} · sync{' '}
            {worldFrame.source.sync}
            {agents.length < worldFrame.simulation.agents.length
              ? ` · ${worldFrame.simulation.agents.length - agents.length} invalid position(s) excluded`
              : ''}
          </p>
          <div className="table-wrap">
            <table data-testid="world-agents-table">
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Action</th>
                  <th scope="col">Location</th>
                  <th scope="col">Position</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id}>
                    <td className="hash">
                      <Link href={commandLink('meet', agent.id)} prefetch={false} aria-label={`Draft a conversation command for ${agent.id}`}>
                        {agent.id}
                      </Link>
                    </td>
                    <td>{agent.action}</td>
                    <td>{agent.locationId}</td>
                    <td className="hash">
                      x {agent.position[0].toFixed(1)} · z {agent.position[2].toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="section-head reveal">
        <span className="section-index">03</span>
        <h2>District directory</h2>
      </div>
      <WorldDirectory />
    </>
  );
}
