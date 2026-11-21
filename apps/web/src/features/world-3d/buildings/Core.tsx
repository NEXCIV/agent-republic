import { LANDMARK } from './palette';

/**
 * Agent Core — a circular data-centre silhouette: low drum, central stack,
 * radial fins and three gold rings. It is the only round building, so the
 * skyline differentiates it from the three box-based landmarks.
 */
export function Core({ bounds }: { bounds: readonly [number, number, number] }) {
  const [width, height, depth] = bounds;
  const radius = Math.min(width, depth) / 2;
  const coreHeight = height * 0.62;
  const coreTop = 0.9 + coreHeight;
  const rings = [3.2, 5.0, 6.8];
  const fins = Array.from({ length: 8 }, (_, index) => (index * Math.PI) / 4);

  return (
    <group>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[radius * 0.94, radius * 0.94, 0.9, 40]} />
        <meshStandardMaterial color={LANDMARK.plinth} metalness={0.4} roughness={0.65} />
      </mesh>
      <mesh position={[0, 0.9 + coreHeight / 2, 0]}>
        <cylinderGeometry args={[radius * 0.44, radius * 0.5, coreHeight, 28]} />
        <meshStandardMaterial color={LANDMARK.charcoal} metalness={0.6} roughness={0.45} />
      </mesh>
      <mesh position={[0, coreTop + 0.25, 0]}>
        <cylinderGeometry args={[radius * 0.58, radius * 0.58, 0.5, 32]} />
        <meshStandardMaterial color={LANDMARK.graphite} metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, coreTop + 1.1, 0]}>
        <cylinderGeometry args={[0.22, 0.34, 1.2, 12]} />
        <meshStandardMaterial
          color={LANDMARK.gold}
          emissive={LANDMARK.gold}
          emissiveIntensity={1.3}
          metalness={0.2}
          roughness={0.3}
        />
      </mesh>

      {rings.map((y) => (
        <mesh key={`ring-${y}`} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius * (0.86 - (y - 3.2) * 0.09), 0.07, 8, 48]} />
          <meshStandardMaterial
            color={LANDMARK.gold}
            emissive={LANDMARK.gold}
            emissiveIntensity={0.85}
            metalness={0.3}
            roughness={0.4}
          />
        </mesh>
      ))}

      {fins.map((angle, index) => (
        <mesh
          key={`fin-${index}`}
          position={[Math.cos(angle) * radius * 0.66, 2.6, Math.sin(angle) * radius * 0.66]}
          rotation={[0, Math.PI / 2 - angle, 0]}
        >
          <boxGeometry args={[0.16, 3.4, 0.9]} />
          <meshStandardMaterial color={LANDMARK.graphite} metalness={0.65} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}
