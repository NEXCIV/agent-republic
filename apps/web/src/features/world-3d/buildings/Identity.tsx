import { LANDMARK } from './palette';

/**
 * Identity Center — a slender archive tower inside a scanning frame with ice-blue
 * identity nodes. The frame and the mast give it the tallest thin silhouette,
 * in contrast to the wide council hall.
 */
export function Identity({ bounds }: { bounds: readonly [number, number, number] }) {
  const [width, height, depth] = bounds;
  const baseWidth = width * 0.8;
  const baseDepth = depth * 0.8;
  const towerWidth = width * 0.46;
  const towerDepth = depth * 0.46;
  const towerHeight = height * 0.6;
  const towerTop = 0.8 + towerHeight;
  const frameHalf = Math.min(width, depth) * 0.36;
  const frameTop = 0.8 + height * 0.5;

  return (
    <group>
      <mesh position={[0, 0.4, 0]}>
        <boxGeometry args={[baseWidth, 0.8, baseDepth]} />
        <meshStandardMaterial color={LANDMARK.plinth} metalness={0.35} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.8 + towerHeight / 2, 0]}>
        <boxGeometry args={[towerWidth, towerHeight, towerDepth]} />
        <meshStandardMaterial color={LANDMARK.brass} metalness={0.6} roughness={0.45} />
      </mesh>
      <mesh position={[0, towerTop + 0.75, 0]}>
        <boxGeometry args={[towerWidth * 0.74, 1.5, towerDepth * 0.74]} />
        <meshStandardMaterial color={LANDMARK.graphite} metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, towerTop + 2.1, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 1.6, 8]} />
        <meshStandardMaterial
          color={LANDMARK.ice}
          emissive={LANDMARK.ice}
          emissiveIntensity={1.2}
          metalness={0.2}
          roughness={0.3}
        />
      </mesh>

      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`post-${sx}-${sz}`} position={[sx * frameHalf, 0.8 + (frameTop - 0.8) / 2, sz * frameHalf]}>
            <boxGeometry args={[0.14, frameTop - 0.8, 0.14]} />
            <meshStandardMaterial color={LANDMARK.graphite} metalness={0.7} roughness={0.35} />
          </mesh>
        )),
      )}
      <mesh position={[0, frameTop, frameHalf]}>
        <boxGeometry args={[frameHalf * 2, 0.12, 0.12]} />
        <meshStandardMaterial color={LANDMARK.graphite} metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[0, frameTop, -frameHalf]}>
        <boxGeometry args={[frameHalf * 2, 0.12, 0.12]} />
        <meshStandardMaterial color={LANDMARK.graphite} metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[frameHalf, frameTop, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[frameHalf * 2, 0.12, 0.12]} />
        <meshStandardMaterial color={LANDMARK.graphite} metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[-frameHalf, frameTop, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[frameHalf * 2, 0.12, 0.12]} />
        <meshStandardMaterial color={LANDMARK.graphite} metalness={0.7} roughness={0.35} />
      </mesh>

      {[3.1, 4.3, 5.5].map((y) => (
        <mesh key={`seam-${y}`} position={[0, y, towerDepth / 2 + 0.02]}>
          <boxGeometry args={[towerWidth * 0.7, 0.07, 0.06]} />
          <meshStandardMaterial
            color={LANDMARK.ice}
            emissive={LANDMARK.ice}
            emissiveIntensity={0.9}
            metalness={0.2}
            roughness={0.4}
          />
        </mesh>
      ))}

      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`node-${sx}-${sz}`} position={[sx * towerWidth * 0.62, 6.4, sz * towerDepth * 0.62]}>
            <boxGeometry args={[0.22, 0.22, 0.22]} />
            <meshStandardMaterial
              color={LANDMARK.ice}
              emissive={LANDMARK.ice}
              emissiveIntensity={1.6}
              metalness={0.1}
              roughness={0.3}
            />
          </mesh>
        )),
      )}
    </group>
  );
}
