'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { DISTRICT_01 } from '@agent-republic/domain';
import { PALETTE } from '../buildings/palette';

type LightPool = {
  x: number;
  z: number;
  size: number;
  color: string;
};

/** Static, purely decorative light pools; no gameplay or chain state is encoded. */
const LIGHT_POOLS: LightPool[] = [
  ...DISTRICT_01.landmarks
    .filter((landmark) => landmark.id !== 'PLAZA')
    .map((landmark) => ({
      x: landmark.position[0],
      z: landmark.position[2],
      size: Math.max(landmark.bounds[0], landmark.bounds[2]) * 1.35,
      color: landmark.id === 'COUNCIL' || landmark.id === 'PROJECT' ? PALETTE.gold : PALETTE.teal,
    })),
  { x: 0, z: 0, size: 8.5, color: PALETTE.teal },
  { x: -4.5, z: 0.5, size: 2.5, color: PALETTE.teal },
  { x: 3.5, z: 0.5, size: 2.5, color: PALETTE.teal },
  { x: -0.5, z: -3.5, size: 2.5, color: PALETTE.gold },
  { x: -0.5, z: 4.5, size: 2.5, color: PALETTE.gold },
];

function createGlowTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,0.62)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.34)');
  gradient.addColorStop(0.72, 'rgba(255,255,255,0.10)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * One instanced draw call for soft light pools plus two thin plaza rings.
 * These are static and demand-rendered; low quality keeps only the GLB lights.
 */
export function GroundLightEffects({ enabled = true }: { enabled?: boolean }) {
  const poolRef = useRef<THREE.InstancedMesh>(null);
  const texture = useMemo(() => createGlowTexture(), []);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => () => texture?.dispose(), [texture]);

  useEffect(() => {
    const pool = poolRef.current;
    if (!enabled || pool === null) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    LIGHT_POOLS.forEach((light, index) => {
      dummy.position.set(light.x, 0.072, light.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(light.size, light.size, 1);
      dummy.updateMatrix();
      pool.setMatrixAt(index, dummy.matrix);
      pool.setColorAt(index, color.set(light.color));
    });
    pool.count = LIGHT_POOLS.length;
    pool.instanceMatrix.needsUpdate = true;
    if (pool.instanceColor !== null) pool.instanceColor.needsUpdate = true;
    invalidate();
  }, [enabled, invalidate]);

  if (!enabled || texture === null) return null;

  return (
    <group>
      <instancedMesh
        ref={poolRef}
        args={[undefined, undefined, LIGHT_POOLS.length]}
        frustumCulled={false}
        raycast={() => {}}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={texture}
          color="#ffffff"
          transparent
          opacity={0.46}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </instancedMesh>
      <mesh position={[0, 0.082, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
        <ringGeometry args={[3.04, 3.11, 64]} />
        <meshBasicMaterial
          color={PALETTE.teal}
          transparent
          opacity={0.58}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0.084, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
        <ringGeometry args={[2.22, 2.29, 64]} />
        <meshBasicMaterial
          color={PALETTE.gold}
          transparent
          opacity={0.48}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
