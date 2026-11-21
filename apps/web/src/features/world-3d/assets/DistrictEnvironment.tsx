'use client';

import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import type { Group, Object3D } from 'three';

/**
 * P0+ — static environment set (plaza paving, streets, lights, greenery)
 * plus the 'airship' node drifting gently. The drift never calls
 * invalidate(), so the demand render loop stays idle when nothing else
 * moves; the airship only advances while other animations already drive
 * frames (docs/3D_RENDERING.md §9).
 */
export function DistrictEnvironment({ scene, plaza, reducedMotion, onSelectPlaza, onClear }: {
  scene: Group;
  plaza?: Object3D;
  reducedMotion: boolean;
  onSelectPlaza: () => void;
  onClear?: () => void;
}) {
  const airship = useMemo(() => {
    const node = scene.getObjectByName('airship');
    return node && { node, origin: node.position.clone(), heading: node.rotation.y };
  }, [scene]);

  useFrame(({ clock }) => {
    if (!airship) return;
    const t = reducedMotion ? 0 : clock.elapsedTime;
    airship.node.position.set(
      airship.origin.x + Math.sin(t * 0.08) * 1.3,
      airship.origin.y + Math.sin(t * 0.32) * 0.22,
      airship.origin.z + Math.sin(t * 0.12) * 0.55,
    );
    airship.node.rotation.y = airship.heading + Math.sin(t * 0.08) * 0.14;
  });

  return (
    <primitive
      object={scene}
      onClick={plaza && ((event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        if (plaza.getObjectById(event.object.id)) onSelectPlaza();
        else onClear?.();
      })}
    />
  );
}
