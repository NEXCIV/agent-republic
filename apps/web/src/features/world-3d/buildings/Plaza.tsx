import { PALETTE } from './palette';

/**
 * Central Plaza — a flat public space with a single teal inlay. It has no
 * route in the manifest, so it is rendered but never navigable.
 */
export function Plaza({ bounds }: { bounds: readonly [number, number, number] }) {
  const [width, , depth] = bounds;
  const radius = Math.min(width, depth) / 2;

  return (
    <group>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[radius * 0.95, radius * 0.95, 0.1, 48]} />
        <meshStandardMaterial color={PALETTE.dark} metalness={0.2} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius * 0.86, 0.08, 8, 48]} />
        <meshStandardMaterial
          color={PALETTE.teal}
          emissive={PALETTE.teal}
          emissiveIntensity={1.1}
          metalness={0.3}
          roughness={0.4}
        />
      </mesh>
    </group>
  );
}
