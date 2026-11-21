import { DISTRICT_01 } from '@agent-republic/domain';
import type { LandmarkId } from '@agent-republic/domain';

/**
 * E6-01 — static top-down plan used when WebGL is unavailable or disabled.
 * It is generated from the same manifest as the 3D scene, so it can never
 * disagree with the real district layout, and it shows no live economy data.
 */

const PREVIEW_FILL: Readonly<Record<LandmarkId, string>> = {
  COUNCIL: '#1b1c19',
  IDENTITY: '#1e2522',
  PROJECT: '#2c2a1c',
  CORE: '#1d2422',
  PLAZA: '#161714',
};

const GRID_LINES = [-20, -15, -10, -5, 0, 5, 10, 15, 20];

export function WorldPreview() {
  const half = DISTRICT_01.ground.width / 2;

  return (
    <svg
      className="world-preview"
      viewBox={`${-half - 2} ${-half - 2} ${DISTRICT_01.ground.width + 4} ${DISTRICT_01.ground.depth + 4}`}
      role="img"
      aria-label="Static top-down plan of District 01"
    >
      <rect
        x={-half}
        y={-half}
        width={DISTRICT_01.ground.width}
        height={DISTRICT_01.ground.depth}
        fill="#0b0c0b"
        stroke="#2f302a"
        strokeWidth={0.2}
      />
      {GRID_LINES.map((value) => (
        <g key={`grid-${value}`} stroke="#1e1f1c" strokeWidth={0.07}>
          <line x1={-half} y1={value} x2={half} y2={value} />
          <line x1={value} y1={-half} x2={value} y2={half} />
        </g>
      ))}
      {DISTRICT_01.landmarks.map((landmark) => {
        const [width, height, depth] = landmark.bounds;
        const [x, , z] = landmark.position;
        return (
          <g key={landmark.id}>
            <rect
              x={x - width / 2}
              y={z - depth / 2}
              width={width}
              height={depth}
              fill={PREVIEW_FILL[landmark.id]}
              stroke={landmark.id === 'PROJECT' ? '#fbe052' : '#5f6158'}
              strokeWidth={landmark.id === 'PROJECT' ? 0.24 : 0.16}
              opacity={height > 1 ? 0.95 : 0.8}
            />
            <text
              x={x}
              y={z + 0.6}
              textAnchor="middle"
              fontSize={1.25}
              letterSpacing={0.08}
              fill="#c9c9bd"
              fontFamily="ui-monospace, Consolas, monospace"
            >
              {landmark.id}
            </text>
          </g>
        );
      })}
      <g transform={`translate(${half - 3.5} ${half - 2.5})`} fill="#c9c9bd">
        <text fontSize={1.4} fontFamily="ui-monospace, Consolas, monospace" textAnchor="end">
          N ↑
        </text>
      </g>
    </svg>
  );
}
