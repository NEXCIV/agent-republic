'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { MAX_VISIBLE_AGENTS } from '@agent-republic/domain';
import type { AgentMarker } from './toAgentMarkers';
import { shouldSnapAgent, stepAgentPosition } from './motion';

/**
 * E6-04 — one InstancedMesh for all simulated agents.
 * Fallback while agent-citizen.glb is unavailable.
 *
 * The component never computes world rules. It receives validated markers,
 * lerps locally at a capped speed, writes only instance matrices and asks R3F
 * for another frame while someone is moving. When everything has arrived the
 * demand loop goes idle, so the scene can stop completely.
 */

const BODY_HEIGHT = 0.72;

export function ConeCrowd({
  markers,
  selectedId = null,
  onSelect,
}: {
  markers: AgentMarker[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const pickRef = useRef<THREE.InstancedMesh>(null);
  const positionsRef = useRef(new Map<string, [number, number, number]>());
  const targetsRef = useRef(new Map<string, [number, number, number]>());
  const [reduced, setReduced] = useState(false);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colour = useMemo(() => new THREE.Color(), []);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    const ring = ringRef.current;
    const pick = pickRef.current;
    if (body === null || ring === null || pick === null) return;

    const targets = new Map<string, [number, number, number]>();
    markers.forEach((marker) => targets.set(marker.id, [...marker.position]));
    targetsRef.current = targets;

    for (const id of [...positionsRef.current.keys()]) {
      if (!targets.has(id)) positionsRef.current.delete(id);
    }
    // First appearance, reduced motion or a new frame after a long pause:
    // load the final pose instead of replaying every old step.
    markers.forEach((marker) => {
      if (reduced || !positionsRef.current.has(marker.id)) {
        positionsRef.current.set(marker.id, [...marker.position]);
      }
    });

    body.count = markers.length;
    ring.count = markers.length;
    pick.count = markers.length;
    markers.forEach((marker, index) => {
      const highlight = marker.id === selectedId;
      body.setColorAt(index, colour.set(marker.color));
      const position = positionsRef.current.get(marker.id) ?? marker.position;
      dummy.position.set(position[0], position[1] + BODY_HEIGHT / 2, position[2]);
      dummy.rotation.set(0, marker.facingRadians, 0);
      dummy.scale.setScalar(highlight ? 1.35 : 1);
      dummy.updateMatrix();
      body.setMatrixAt(index, dummy.matrix);

      dummy.position.set(position[0], position[1] + 0.015, position[2]);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(highlight ? 1.2 : 1);
      dummy.updateMatrix();
      ring.setMatrixAt(index, dummy.matrix);

      // Generous invisible hit volume so touch picking is not limited to the
      // few pixels of the cone silhouette.
      dummy.position.set(position[0], position[1] + 0.55, position[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      pick.setMatrixAt(index, dummy.matrix);
    });

    body.instanceMatrix.needsUpdate = true;
    ring.instanceMatrix.needsUpdate = true;
    pick.instanceMatrix.needsUpdate = true;
    if (body.instanceColor !== null) body.instanceColor.needsUpdate = true;
    invalidate();
  }, [markers, selectedId, reduced, dummy, colour, invalidate]);

  useFrame((_, delta) => {
    const body = bodyRef.current;
    const ring = ringRef.current;
    const pick = pickRef.current;
    if (body === null || ring === null || pick === null || markers.length === 0) return;

    let moving = false;
    markers.forEach((marker, index) => {
      const current = positionsRef.current.get(marker.id) ?? marker.position;
      const target = targetsRef.current.get(marker.id) ?? marker.position;
      const next = reduced
        ? target
        : shouldSnapAgent(current, target)
          ? target
          : stepAgentPosition(current, target, delta);

      if (next !== current) {
        positionsRef.current.set(marker.id, [...next]);
        moving = true;
      }

      const highlight = marker.id === selectedId;
      dummy.position.set(next[0], next[1] + BODY_HEIGHT / 2, next[2]);
      dummy.rotation.set(0, marker.facingRadians, 0);
      dummy.scale.setScalar(highlight ? 1.35 : 1);
      dummy.updateMatrix();
      body.setMatrixAt(index, dummy.matrix);

      dummy.position.set(next[0], next[1] + 0.015, next[2]);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(highlight ? 1.2 : 1);
      dummy.updateMatrix();
      ring.setMatrixAt(index, dummy.matrix);

      dummy.position.set(next[0], next[1] + 0.55, next[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      pick.setMatrixAt(index, dummy.matrix);
    });

    body.instanceMatrix.needsUpdate = true;
    ring.instanceMatrix.needsUpdate = true;
    pick.instanceMatrix.needsUpdate = true;
    if (moving) invalidate();
  });

  return (
    <group
      onClick={(event) => {
        if (event.instanceId === undefined) return;
        const marker = markers[event.instanceId];
        if (marker === undefined) return;
        event.stopPropagation();
        onSelect?.(marker.id);
      }}
    >
      <instancedMesh ref={bodyRef} args={[undefined, undefined, MAX_VISIBLE_AGENTS]} frustumCulled={false}>
        <coneGeometry args={[0.26, BODY_HEIGHT, 6]} />
        <meshStandardMaterial color="#ffffff" metalness={0.45} roughness={0.45} />
      </instancedMesh>
      <instancedMesh ref={pickRef} args={[undefined, undefined, MAX_VISIBLE_AGENTS]} frustumCulled={false}>
        <sphereGeometry args={[0.55, 8, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </instancedMesh>
      <instancedMesh ref={ringRef} args={[undefined, undefined, MAX_VISIBLE_AGENTS]} frustumCulled={false}>
        <ringGeometry args={[0.22, 0.34, 16]} />
        <meshBasicMaterial color="#fbe052" transparent opacity={0.45} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
