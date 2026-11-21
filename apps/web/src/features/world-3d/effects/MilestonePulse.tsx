'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Landmark } from '@agent-republic/domain';
import { PALETTE } from '../buildings/palette';

/**
 * E6-06 — one-shot gold milestone ring (800–1600ms) for a newly confirmed
 * chain event. The component is keyed by the event key, so dedupe is handled
 * by the caller; it never repeats on its own and is unmounted on reorg.
 */

const DURATION_SECONDS = 1.4;

export function MilestonePulse({
  landmark,
  onComplete,
}: {
  landmark: Landmark;
  onComplete: () => void;
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const elapsed = useRef(0);
  const done = useRef(false);
  const invalidate = useThree((state) => state.invalidate);
  const radius = Math.max(landmark.bounds[0], landmark.bounds[2]) / 2 + 0.8;

  useEffect(() => {
    elapsed.current = 0;
    done.current = false;
    invalidate();
  }, [invalidate]);

  useFrame((_, delta) => {
    if (done.current) return;
    elapsed.current = Math.min(DURATION_SECONDS, elapsed.current + delta);
    const progress = elapsed.current / DURATION_SECONDS;

    if (ringRef.current !== null) {
      ringRef.current.scale.setScalar(1 + progress * 0.8);
    }
    if (materialRef.current !== null) {
      materialRef.current.opacity = 0.7 * (1 - progress);
    }

    if (elapsed.current >= DURATION_SECONDS) {
      done.current = true;
      onComplete();
      return;
    }
    invalidate();
  });

  return (
    <group position={[landmark.position[0], landmark.position[1] + 0.05, landmark.position[2]]}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius, radius + 0.4, 56]} />
        <meshBasicMaterial
          ref={materialRef}
          color={PALETTE.gold}
          transparent
          opacity={0.7}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
