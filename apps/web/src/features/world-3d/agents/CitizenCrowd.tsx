'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { MAX_VISIBLE_AGENTS } from '@agent-republic/domain';
import { agentIdHash, type AgentMarker } from './toAgentMarkers';
import { shouldSnapAgent, stepAgentPosition } from './motion';

/**
 * P0+ — instanced low-poly citizens built from agent-citizen.glb.
 *
 * One InstancedMesh per body part keeps the whole crowd at about eight draw
 * calls. Each citizen has a stable hair colour and fringe shape. Legs and
 * arms swing procedurally around the pivots baked into the GLB origins, and
 * the naming matches a future Armature upgrade (design doc §9). This
 * component still only renders validated markers and lerps locally at a
 * capped speed — it never computes world rules.
 */

// Older versions of the citizen asset have a visor in place of the haircut.
const PART_NAMES = ['body', 'head', 'armL', 'armR', 'legL', 'legR', 'badge', 'hair', 'visor'] as const;
const HAIRSTYLES = [
  { colour: '#573931', sweep: 0 },
  { colour: '#f2a0bd', sweep: 1 },
  { colour: '#efeaf7', sweep: 0.3 },
] as const;
type PartName = (typeof PART_NAMES)[number];

/** Leg swing amplitude (radians) and stride frequency while moving. */
const SWING_AMPLITUDE = 0.55;
const STRIDE_HERTZ = 2.4;
/** Idle breathing bob amplitude in metres. */
const IDLE_BOB = 0.02;

type PartGeometry = { geometry: THREE.BufferGeometry; offset: THREE.Vector3; material: THREE.Material };

function extractParts(scene: THREE.Group): Partial<Record<PartName, PartGeometry>> {
  const parts: Partial<Record<PartName, PartGeometry>> = {};
  for (const name of PART_NAMES) {
    const node = scene.getObjectByName(name);
    if (node instanceof THREE.Mesh && node.material instanceof THREE.Material) {
      parts[name] = { geometry: node.geometry, offset: node.position.clone(), material: node.material };
    }
  }
  return parts;
}

export function CitizenCrowd({
  scene,
  markers,
  selectedId = null,
  onSelect,
}: {
  scene: THREE.Group;
  markers: AgentMarker[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const parts = useMemo(() => extractParts(scene), [scene]);
  // Three reads morph weights from a standard Mesh when writing an instance.
  const hairPose = useMemo(() => parts.hair?.geometry.morphAttributes.position?.length
    ? new THREE.Mesh(parts.hair.geometry, parts.hair.material)
    : null, [parts]);
  const partRefs = useRef<Partial<Record<PartName, THREE.InstancedMesh | null>>>({});
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const pickRef = useRef<THREE.InstancedMesh>(null);
  const positionsRef = useRef(new Map<string, [number, number, number]>());
  const targetsRef = useRef(new Map<string, [number, number, number]>());
  const phaseRef = useRef(new Map<string, number>());
  const [reduced, setReduced] = useState(false);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colour = useMemo(() => new THREE.Color(), []);
  const offset = useMemo(() => new THREE.Vector3(), []);
  const invalidate = useThree((state) => state.invalidate);
  const clock = useThree((state) => state.clock);

  // Keep the painted vertices but replace the two base pigments per instance.
  // The original material is shared with the cached GLB and other views.
  const instanceMaterials = useMemo(() => {
    const materials: Partial<Record<PartName, THREE.MeshStandardMaterial>> = {};
    for (const name of ['badge', 'hair'] as const) {
      const source = parts[name]?.material;
      if (source instanceof THREE.MeshStandardMaterial) {
        const copy = source.clone();
        copy.color.set(0xffffff);
        materials[name] = copy;
      }
    }
    return materials;
  }, [parts]);
  useEffect(() => () => {
    for (const material of Object.values(instanceMaterials)) material.dispose();
  }, [instanceMaterials]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  /** Rotates a part pivot offset into world space for the given facing. */
  const writePart = (
    name: PartName,
    index: number,
    position: readonly [number, number, number],
    facing: number,
    scale: number,
    swing: number,
    bobY: number,
  ) => {
    const mesh = partRefs.current[name];
    const part = parts?.[name];
    if (mesh === null || mesh === undefined || part === undefined) return;

    const c = Math.cos(facing);
    const s = Math.sin(facing);
    offset.copy(part.offset).multiplyScalar(scale);
    dummy.position.set(
      position[0] + offset.x * c + offset.z * s,
      position[1] + offset.y + bobY,
      position[2] - offset.x * s + offset.z * c,
    );
    dummy.rotation.set(0, facing, 0);
    dummy.scale.setScalar(scale);
    if (name === 'legL') dummy.rotateX(swing);
    else if (name === 'legR') dummy.rotateX(-swing);
    else if (name === 'armL') dummy.rotateX(-swing * 0.7);
    else if (name === 'armR') dummy.rotateX(swing * 0.7);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  };

  useEffect(() => {
    const ring = ringRef.current;
    const pick = pickRef.current;
    if (ring === null || pick === null) return;

    const targets = new Map<string, [number, number, number]>();
    markers.forEach((marker) => targets.set(marker.id, [...marker.position]));
    targetsRef.current = targets;
    for (const id of [...positionsRef.current.keys()]) {
      if (!targets.has(id)) {
        positionsRef.current.delete(id);
        phaseRef.current.delete(id);
      }
    }
    // First appearance, reduced motion or a new frame after a long pause:
    // load the final pose instead of replaying every old step.
    markers.forEach((marker) => {
      if (reduced || !positionsRef.current.has(marker.id)) {
        positionsRef.current.set(marker.id, [...marker.position]);
      }
    });

    const count = markers.length;
    const hair = partRefs.current.hair;
    PART_NAMES.forEach((name) => {
      const mesh = partRefs.current[name];
      if (mesh !== null && mesh !== undefined) mesh.count = count;
    });
    ring.count = count;
    pick.count = count;

    markers.forEach((marker, index) => {
      const highlight = marker.id === selectedId;
      const position = positionsRef.current.get(marker.id) ?? marker.position;
      if (parts.hair) {
        const style = HAIRSTYLES[agentIdHash(marker.id) % HAIRSTYLES.length]!;
        partRefs.current.badge?.setColorAt(index, colour.set(hairPose ? '#43dcd0' : marker.color));
        hair?.setColorAt(index, colour.set(style.colour));
        if (hair && hairPose?.morphTargetInfluences) {
          hairPose.morphTargetInfluences[0] = style.sweep;
          hair.setMorphAt(index, hairPose);
        }
      } else {
        partRefs.current.body?.setColorAt(index, colour.set(marker.color));
        partRefs.current.head?.setColorAt(index, colour.set(marker.color));
      }
      const scale = highlight ? 1.35 : 1;
      PART_NAMES.forEach((name) =>
        writePart(name, index, position, marker.facingRadians, scale, 0, 0),
      );

      dummy.position.set(position[0], position[1] + 0.015, position[2]);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(highlight ? 1.2 : 1);
      dummy.updateMatrix();
      ring.setMatrixAt(index, dummy.matrix);

      // Generous invisible hit volume so touch picking is not limited to the
      // few pixels of the citizen silhouette.
      dummy.position.set(position[0], position[1] + 0.8, position[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      pick.setMatrixAt(index, dummy.matrix);
    });

    PART_NAMES.forEach((name) => {
      const mesh = partRefs.current[name];
      if (mesh !== null && mesh !== undefined) mesh.instanceMatrix.needsUpdate = true;
      if (mesh !== null && mesh !== undefined && mesh.instanceColor !== null) {
        mesh.instanceColor.needsUpdate = true;
      }
    });
    ring.instanceMatrix.needsUpdate = true;
    pick.instanceMatrix.needsUpdate = true;
    if (hair?.morphTexture) hair.morphTexture.needsUpdate = true;
    invalidate();
  }, [markers, selectedId, reduced, parts, hairPose, writePart, dummy, colour, offset, invalidate]);

  useFrame((_, delta) => {
    const ring = ringRef.current;
    const pick = pickRef.current;
    if (ring === null || pick === null || markers.length === 0) return;

    let moving = false;
    const now = clock.elapsedTime;
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

      const arrived = next === target;
      const phase = phaseRef.current.get(marker.id) ?? 0;
      const advanced = arrived ? phase : phase + delta * STRIDE_HERTZ * Math.PI * 2;
      phaseRef.current.set(marker.id, advanced);

      // Swing decays to zero when idle; bob keeps a subtle idle breath.
      const swing = arrived ? 0 : Math.sin(advanced) * SWING_AMPLITUDE;
      let bob = 0;
      if (arrived && !reduced) {
        bob = Math.sin(now * 1.6 + agentIdHash(marker.id)) * IDLE_BOB;
      }

      const highlight = marker.id === selectedId;
      const scale = highlight ? 1.35 : 1;
      PART_NAMES.forEach((name) =>
        writePart(name, index, next, marker.facingRadians, scale, swing, bob),
      );

      dummy.position.set(next[0], next[1] + 0.015, next[2]);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(highlight ? 1.2 : 1);
      dummy.updateMatrix();
      ring.setMatrixAt(index, dummy.matrix);

      dummy.position.set(next[0], next[1] + 0.8, next[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      pick.setMatrixAt(index, dummy.matrix);
    });

    PART_NAMES.forEach((name) => {
      const mesh = partRefs.current[name];
      if (mesh !== null && mesh !== undefined) mesh.instanceMatrix.needsUpdate = true;
    });
    ring.instanceMatrix.needsUpdate = true;
    pick.instanceMatrix.needsUpdate = true;
    // Invalidate only while someone is moving: the demand render loop must
    // go fully idle when the crowd settles (docs/3D_RENDERING.md §9). The
    // idle bob therefore only advances while other animations already
    // drive frames — a settled crowd is as static as the old cones.
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
      {PART_NAMES.map((name) => {
        const part = parts[name];
        if (!part) return null;
        return (
          <instancedMesh
            key={name}
            ref={(mesh) => {
              if (name === 'hair' && mesh && hairPose && !mesh.morphTexture) {
                // Allocate at full capacity before Three can draw the first frame.
                mesh.setMorphAt(0, hairPose);
                mesh.count = 0;
              }
              partRefs.current[name] = mesh;
            }}
            args={[part.geometry, instanceMaterials[name] ?? part.material, MAX_VISIBLE_AGENTS]}
            frustumCulled={false}
          />
        );
      })}
      <instancedMesh ref={pickRef} args={[undefined, undefined, MAX_VISIBLE_AGENTS]} frustumCulled={false}>
        <sphereGeometry args={[0.55, 8, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </instancedMesh>
      <instancedMesh ref={ringRef} args={[undefined, undefined, MAX_VISIBLE_AGENTS]} frustumCulled={false}>
        <ringGeometry args={[0.22, 0.34, 16]} />
        <meshBasicMaterial color="#f1c96d" transparent opacity={0.38} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
