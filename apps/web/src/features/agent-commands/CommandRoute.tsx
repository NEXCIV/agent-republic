import { commandTravelRoute } from '@agent-republic/agent-engine';
import { DISTRICT_01, DISTRICT_01_EDGES, DISTRICT_01_WAYPOINTS, type CommandRecord } from '@agent-republic/domain';
import { LANDMARK_LABELS } from '../world-3d/webgl';
import styles from './commands.module.css';

/** Show one private journey at a time, using the same route as the task runner. */
export function CommandRoute({ entry }: { entry: CommandRecord }) {
  const visits = entry.steps.flatMap((step, index) => step.kind === 'VISIT' ? [{ step, index }] : []);
  const visit = visits.filter(({ index }) => index <= entry.results.length).at(-1) ?? visits[0];
  if (!visit) return null;
  const from = visit.step.from ?? 'PLAZA';
  const to = visit.step.location;
  const route = commandTravelRoute(from, to);
  if (!route.length) return null;
  const path = route.map((id, i) => {
    const [x, , z] = DISTRICT_01_WAYPOINTS[id];
    return `${i === 0 ? 'M' : 'L'} ${x} ${z}`;
  }).join(' ');
  const failed = entry.status === 'FAILED' && entry.results.length === visit.index + 1;
  const arrived = visit.index < entry.results.length && !failed;
  const moving = entry.status === 'RUNNING' && visit.index === entry.results.length && route.length > 1;
  const [x, , z] = DISTRICT_01_WAYPOINTS[route[arrived ? route.length - 1 : 0]!];
  const state = failed ? 'Stopped' : arrived ? 'Arrived' : moving ? 'Travelling' : 'Planned';
  return (
    <figure className={styles.route}>
      <svg viewBox="-15 -12 30 28" aria-hidden="true" focusable="false">
        {DISTRICT_01.landmarks.map((landmark) => {
          const [cx, , cz] = landmark.position;
          const [w, , d] = landmark.bounds;
          return <rect key={landmark.id} x={cx - w / 2} y={cz - d / 2} width={w} height={d}
            fill={landmark.id === to ? 'var(--teal-soft)' : 'var(--paper-sunk)'}/>;
        })}
        {DISTRICT_01_EDGES.map(([a, b]) => {
          const start = DISTRICT_01_WAYPOINTS[a], end = DISTRICT_01_WAYPOINTS[b];
          return <line key={a + b} x1={start[0]} y1={start[2]} x2={end[0]} y2={end[2]}
            stroke="var(--rule-strong)" strokeWidth=".18" />;
        })}
        <path d={path} fill="none" stroke="var(--teal)" strokeWidth=".44" />
        {moving && <circle className={styles.movingDot} r=".8" fill="var(--teal)">
          <animateMotion key={path} path={path} dur="1.4s" fill="freeze" />
        </circle>}
        <circle className={moving ? styles.stillDot : undefined} cx={x} cy={z} r=".8" fill="var(--teal)" />
      </svg>
      <figcaption>
        <span className="badge muted">Private route · AI SIMULATED</span>
        <strong>{LANDMARK_LABELS[from]}{from !== to && ` → ${LANDMARK_LABELS[to]}`}</strong>
        <span>{state} · {route.join(' → ')}</span>
      </figcaption>
    </figure>
  );
}
