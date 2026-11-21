import { LANDMARK } from './palette';

/**
 * Council Hall — a low, wide civic silhouette: stepped podium, horizontal
 * chamber and a regular roof grid. Deliberately the shortest of the four
 * buildings so the skyline reads without colour.
 */
export function Council({ bounds }: { bounds: readonly [number, number, number] }) {
  const [width, , depth] = bounds;
  const hallWidth = width * 0.77;
  const hallDepth = depth * 0.6;
  const roofWidth = width * 0.83;
  const roofDepth = depth * 0.66;

  const xMullions = [-2, -1, 0, 1, 2];
  const zMullions = [-1.5, -0.5, 0.5, 1.5];

  return (
    <group>
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[width, 0.9, depth]} />
        <meshStandardMaterial color={LANDMARK.plinth} metalness={0.35} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.35, 0]}>
        <boxGeometry args={[width * 0.88, 0.9, depth * 0.88]} />
        <meshStandardMaterial color={LANDMARK.graphite} metalness={0.45} roughness={0.6} />
      </mesh>
      <mesh position={[0, 3.2, 0]}>
        <boxGeometry args={[hallWidth, 2.8, hallDepth]} />
        <meshStandardMaterial color={LANDMARK.charcoal} metalness={0.55} roughness={0.5} />
      </mesh>
      <mesh position={[0, 4.75, 0]}>
        <boxGeometry args={[roofWidth, 0.3, roofDepth]} />
        <meshStandardMaterial color={LANDMARK.graphite} metalness={0.5} roughness={0.55} />
      </mesh>

      {xMullions.map((offset) => (
        <mesh key={`x-${offset}`} position={[0, 4.96, offset * (roofDepth / 6)]}>
          <boxGeometry args={[roofWidth * 0.94, 0.12, 0.1]} />
          <meshStandardMaterial color={LANDMARK.brass} metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      {zMullions.map((offset) => (
        <mesh key={`z-${offset}`} position={[offset * (roofWidth / 7), 4.96, 0]}>
          <boxGeometry args={[0.1, 0.12, roofDepth * 0.94]} />
          <meshStandardMaterial color={LANDMARK.brass} metalness={0.6} roughness={0.4} />
        </mesh>
      ))}

      <mesh position={[0, 2.1, depth * 0.3 + 0.02]}>
        <boxGeometry args={[width * 0.34, 0.22, 0.12]} />
        <meshStandardMaterial
          color={LANDMARK.gold}
          emissive={LANDMARK.gold}
          emissiveIntensity={1.1}
          metalness={0.2}
          roughness={0.4}
        />
      </mesh>
    </group>
  );
}
