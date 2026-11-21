import Link from 'next/link';
import { buildBuildingLinks } from './webgl';

/**
 * E6-01 — accessible, always-available equivalent of the 3D district.
 *
 * Every landmark rendered in the canvas has an entry here with the same name,
 * position and route. This list is server-rendered and works with keyboards,
 * screen readers, disabled WebGL and the `?no3d=1` switch.
 */
export function WorldDirectory() {
  const buildings = buildBuildingLinks();

  return (
    <ul className="world-list grid reveal">
      {buildings.map((building) => (
        <li key={building.id} className="stat">
          <div className="label">{building.id}</div>
          <div className="value">{building.label}</div>
          <p className="hint">
            x {building.position[0]} · z {building.position[2]} · footprint {building.bounds[0]}×
            {building.bounds[2]} m
          </p>
          {building.route === null ? (
            <span className="badge muted">Public space</span>
          ) : (
            <Link href={building.route} className="badge confirmed" prefetch={false}>
              Open {building.route}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
