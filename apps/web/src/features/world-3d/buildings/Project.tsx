import type { ProjectStage } from '@agent-republic/world-engine';
import { LANDMARK } from './palette';

/**
 * E6-03 — Golden Toilet Tower construction stages.
 *
 * `stage` comes exclusively from confirmed project amounts through
 * `adapters/projectStage.ts`; this file never computes progress. Each stage is
 * a distinct silhouette:
 *   null        no confirmed data → empty site, no progress claim
 *   FOUNDATION  slab, column stubs, crane and the planning wireframe
 *   FRAME       exposed slabs/columns and an engineering arm
 *   FACADE      full shaft and bowl shell, scaffolding and equipment lights
 *   COMPLETE    full tower, completion plaque and stable gold beacon
 *
 * Cross-stage animation and event de-duplication are E6-06; a reload simply
 * shows the final pose for the current stage.
 */

type ProjectMetrics = {
  width: number;
  depth: number;
  plinthWidth: number;
  plinthDepth: number;
  shaftWidth: number;
  shaftDepth: number;
  shaftHeight: number;
  shaftTop: number;
  rimRadius: number;
};

function metricsOf(bounds: readonly [number, number, number]): ProjectMetrics {
  const [width, height, depth] = bounds;
  const shaftWidth = width * 0.56;
  const shaftDepth = depth * 0.56;
  const shaftHeight = height * 0.58;

  return {
    width,
    depth,
    plinthWidth: width * 0.92,
    plinthDepth: depth * 0.92,
    shaftWidth,
    shaftDepth,
    shaftHeight,
    shaftTop: 0.9 + shaftHeight,
    rimRadius: width * 0.38,
  };
}

function Plinth({ m }: { m: ProjectMetrics }) {
  return (
    <mesh position={[0, 0.45, 0]}>
      <boxGeometry args={[m.plinthWidth, 0.9, m.plinthDepth]} />
      <meshStandardMaterial color={LANDMARK.plinth} metalness={0.4} roughness={0.65} />
    </mesh>
  );
}

function Slab({ m }: { m: ProjectMetrics }) {
  return (
    <mesh position={[0, 0.99, 0]}>
      <boxGeometry args={[m.shaftWidth * 1.16, 0.18, m.shaftDepth * 1.16]} />
      <meshStandardMaterial color={LANDMARK.graphite} metalness={0.35} roughness={0.7} />
    </mesh>
  );
}

/** Completed shaft body with gold corner fins and two lit bands. */
function Shaft({ m }: { m: ProjectMetrics }) {
  return (
    <group>
      <mesh position={[0, 0.9 + m.shaftHeight / 2, 0]}>
        <boxGeometry args={[m.shaftWidth, m.shaftHeight, m.shaftDepth]} />
        <meshStandardMaterial color={LANDMARK.graphite} metalness={0.6} roughness={0.42} />
      </mesh>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`fin-${sx}-${sz}`}
            position={[sx * (m.shaftWidth / 2), 0.9 + m.shaftHeight / 2, sz * (m.shaftDepth / 2)]}
          >
            <boxGeometry args={[0.16, m.shaftHeight, 0.16]} />
            <meshStandardMaterial color={LANDMARK.gold} metalness={0.8} roughness={0.35} />
          </mesh>
        )),
      )}
      {[3.2, 6.1].map((y) => (
        <mesh key={`band-${y}`} position={[0, y, m.shaftDepth / 2 + 0.02]}>
          <boxGeometry args={[m.shaftWidth * 0.82, 0.08, 0.06]} />
          <meshStandardMaterial
            color={LANDMARK.gold}
            emissive={LANDMARK.gold}
            emissiveIntensity={0.35}
            metalness={0.7}
            roughness={0.35}
          />
        </mesh>
      ))}
    </group>
  );
}

function BowlShell({ m }: { m: ProjectMetrics }) {
  return (
    <group>
      <mesh position={[0, m.shaftTop + 0.6, 0]}>
        <cylinderGeometry args={[m.rimRadius, m.shaftWidth * 0.46, 1.2, 32]} />
        <meshStandardMaterial color={LANDMARK.steel} metalness={0.65} roughness={0.4} />
      </mesh>
      <mesh position={[0, m.shaftTop + 1.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[m.rimRadius * 0.94, 0.16, 12, 40]} />
        <meshStandardMaterial color={LANDMARK.gold} metalness={0.85} roughness={0.3} />
      </mesh>
    </group>
  );
}

function Crane({ m }: { m: ProjectMetrics }) {
  const mastX = m.shaftWidth / 2 + 0.8;
  const mastZ = -m.shaftDepth / 2 - 0.6;
  const mastTop = 0.9 + 6.6;
  const jibLength = 5.4;

  return (
    <group>
      <mesh position={[mastX, 0.9 + 3.3, mastZ]}>
        <boxGeometry args={[0.24, 6.6, 0.24]} />
        <meshStandardMaterial color={LANDMARK.steel} metalness={0.6} roughness={0.45} />
      </mesh>
      <mesh position={[mastX - jibLength / 2, mastTop - 0.15, mastZ]}>
        <boxGeometry args={[jibLength, 0.14, 0.14]} />
        <meshStandardMaterial color={LANDMARK.steel} metalness={0.6} roughness={0.45} />
      </mesh>
      <mesh position={[mastX + 0.5, mastTop - 0.15, mastZ]}>
        <boxGeometry args={[1, 0.14, 0.14]} />
        <meshStandardMaterial color={LANDMARK.steel} metalness={0.6} roughness={0.45} />
      </mesh>
      <mesh position={[mastX - jibLength + 0.2, mastTop - 2.8, mastZ]}>
        <boxGeometry args={[0.04, 5.3, 0.04]} />
        <meshStandardMaterial color={LANDMARK.steel} metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[mastX - jibLength + 0.2, mastTop - 5.5, mastZ]}>
        <boxGeometry args={[0.24, 0.24, 0.24]} />
        <meshStandardMaterial color={LANDMARK.gold} metalness={0.7} roughness={0.4} />
      </mesh>
    </group>
  );
}

function FoundationStage({ m }: { m: ProjectMetrics }) {
  const columnPositions = [-1, 0, 1];

  return (
    <group>
      <Slab m={m} />
      {columnPositions.map((cx) =>
        columnPositions.map((cz) => (
          <mesh
            key={`stub-${cx}-${cz}`}
            position={[cx * m.shaftWidth * 0.36, 1.8, cz * m.shaftDepth * 0.36]}
          >
            <boxGeometry args={[0.28, 1.8, 0.28]} />
            <meshStandardMaterial color={LANDMARK.steel} metalness={0.6} roughness={0.45} />
          </mesh>
        )),
      )}
      <mesh position={[0, 0.9 + m.shaftHeight / 2, 0]}>
        <boxGeometry args={[m.shaftWidth, m.shaftHeight, m.shaftDepth]} />
        <meshBasicMaterial color={LANDMARK.brass} wireframe transparent opacity={0.16} />
      </mesh>
      <Crane m={m} />
    </group>
  );
}

function FrameStage({ m }: { m: ProjectMetrics }) {
  const halves = [0.2, 0.4, 0.6, 0.8, 1];
  const columnX = m.shaftWidth / 2 - 0.18;
  const columnZ = m.shaftDepth / 2 - 0.18;

  return (
    <group>
      <Slab m={m} />
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`column-${sx}-${sz}`} position={[sx * columnX, 0.9 + m.shaftHeight / 2, sz * columnZ]}>
            <boxGeometry args={[0.32, m.shaftHeight, 0.32]} />
            <meshStandardMaterial color={LANDMARK.steel} metalness={0.65} roughness={0.42} />
          </mesh>
        )),
      )}
      {halves.map((fraction) => (
        <mesh key={`floor-${fraction}`} position={[0, 0.9 + m.shaftHeight * fraction, 0]}>
          <boxGeometry args={[m.shaftWidth, 0.16, m.shaftDepth]} />
          <meshStandardMaterial color={LANDMARK.graphite} metalness={0.5} roughness={0.55} />
        </mesh>
      ))}
      <mesh position={[m.shaftWidth / 2 + 0.9, m.shaftTop + 0.35, 0]}>
        <boxGeometry args={[1.8, 0.14, 0.14]} />
        <meshStandardMaterial color={LANDMARK.gold} metalness={0.7} roughness={0.4} />
      </mesh>
    </group>
  );
}

function FacadeStage({ m }: { m: ProjectMetrics }) {
  const scaffoldHalf = m.rimRadius * 0.8;
  const scaffoldTop = m.shaftTop + 1.8;

  return (
    <group>
      <Shaft m={m} />
      <BowlShell m={m} />
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`post-${sx}-${sz}`} position={[sx * scaffoldHalf, m.shaftTop + 0.9, sz * scaffoldHalf]}>
            <boxGeometry args={[0.07, 1.8, 0.07]} />
            <meshStandardMaterial color={LANDMARK.steel} metalness={0.6} roughness={0.5} />
          </mesh>
        )),
      )}
      {[-1, 1].map((sign) => (
        <mesh key={`beam-x-${sign}`} position={[0, scaffoldTop, sign * scaffoldHalf]}>
          <boxGeometry args={[scaffoldHalf * 2, 0.07, 0.07]} />
          <meshStandardMaterial color={LANDMARK.steel} metalness={0.6} roughness={0.5} />
        </mesh>
      ))}
      {[-1, 1].map((sign) => (
        <mesh key={`beam-z-${sign}`} position={[sign * scaffoldHalf, scaffoldTop, 0]}>
          <boxGeometry args={[0.07, 0.07, scaffoldHalf * 2]} />
          <meshStandardMaterial color={LANDMARK.steel} metalness={0.6} roughness={0.5} />
        </mesh>
      ))}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`equipment-${sx}-${sz}`} position={[sx * m.shaftWidth * 0.36, m.shaftTop - 0.4, sz * (m.shaftDepth / 2 + 0.03)]}>
            <boxGeometry args={[0.24, 0.14, 0.08]} />
            <meshStandardMaterial
              color={LANDMARK.gold}
              emissive={LANDMARK.gold}
              emissiveIntensity={1.4}
              metalness={0.4}
              roughness={0.4}
            />
          </mesh>
        )),
      )}
    </group>
  );
}

function CompleteStage({ m }: { m: ProjectMetrics }) {
  const bowlTop = m.shaftTop + 1.2;

  return (
    <group>
      <Shaft m={m} />
      <BowlShell m={m} />
      <mesh position={[0, bowlTop + 0.08, 0]}>
        <cylinderGeometry args={[m.rimRadius * 0.8, m.rimRadius * 0.8, 0.16, 32]} />
        <meshStandardMaterial color={LANDMARK.plinth} metalness={0.5} roughness={0.55} />
      </mesh>
      <mesh position={[0, bowlTop - 0.35, -m.rimRadius * 0.62]}>
        <boxGeometry args={[2.4, 1.9, 1.1]} />
        <meshStandardMaterial color={LANDMARK.graphite} metalness={0.6} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.55, m.plinthDepth / 2 + 0.01]}>
        <boxGeometry args={[1.6, 0.5, 0.1]} />
        <meshStandardMaterial
          color={LANDMARK.gold}
          emissive={LANDMARK.gold}
          emissiveIntensity={0.55}
          metalness={0.85}
          roughness={0.3}
        />
      </mesh>
      <mesh position={[0, bowlTop + 0.5, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.6, 12]} />
        <meshStandardMaterial
          color={LANDMARK.gold}
          emissive={LANDMARK.gold}
          emissiveIntensity={1.3}
          metalness={0.7}
          roughness={0.3}
        />
      </mesh>
    </group>
  );
}

export function Project({
  bounds,
  stage = null,
}: {
  bounds: readonly [number, number, number];
  stage?: ProjectStage | null;
}) {
  const m = metricsOf(bounds);

  return (
    <group>
      <Plinth m={m} />
      {stage === 'FRAME' ? (
        <FrameStage m={m} />
      ) : stage === 'FACADE' ? (
        <FacadeStage m={m} />
      ) : stage === 'COMPLETE' ? (
        <CompleteStage m={m} />
      ) : (
        <FoundationStage m={m} />
      )}
    </group>
  );
}
