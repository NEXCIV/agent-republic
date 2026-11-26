import * as THREE from 'three';

import { FISHING_SPOT } from '../../lib/cafe-geometry';
export { FISHING_SPOT };
const FLOAT_TARGET = new THREE.Vector3(76.75, -1.31, -190);
const UP = new THREE.Vector3(0, 1, 0);
type Gesture = 'casting' | 'fishing' | 'reeling';

export function createFishingGear() {
  const group = new THREE.Group();
  group.visible = false;
  const rod = new THREE.Group();
  group.add(rod);
  const metal = new THREE.MeshStandardMaterial({ color: '#dab269', metalness: 0.47, roughness: 0.38 });
  const graphite = new THREE.MeshStandardMaterial({ color: '#262c34', roughness: 0.56 });
  const cork = new THREE.MeshStandardMaterial({ color: '#a68152', roughness: 0.88 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.028, 1.56, 8), graphite);
  shaft.position.y = 0.88;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.04, 0.31, 10), cork);
  handle.position.y = -0.043;
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.06, 12), metal);
  reel.rotation.z = Math.PI / 2;
  reel.position.set(0, -0.12, -0.086);
  const tipMarker = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.095, 8), metal);
  tipMarker.position.y = 1.63;
  rod.add(shaft, handle, reel, tipMarker);

  const float = new THREE.Mesh(new THREE.SphereGeometry(0.073, 10, 8),
    new THREE.MeshBasicMaterial({ color: '#ffc847' }));
  float.scale.set(0.78, 1.45, 0.78);
  const linePositions = new THREE.BufferAttribute(new Float32Array(9), 3).setUsage(THREE.DynamicDrawUsage);
  const lineGeometry = new THREE.BufferGeometry().setAttribute('position', linePositions);
  const line = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: '#e7dfc8', transparent: true, opacity: 0.65 }));
  line.frustumCulled = false;
  group.add(float, line);

  const armDirection = new THREE.Vector3();
  const forearmDirection = new THREE.Vector3();
  const rodDirection = new THREE.Vector3();
  const localDirection = new THREE.Vector3();
  const restDirection = new THREE.Vector3();
  const inverseParent = new THREE.Quaternion();
  const swing = new THREE.Quaternion();
  const tip = new THREE.Vector3();
  let actor: THREE.Object3D | undefined;
  let arm: THREE.Object3D | undefined;
  let forearm: THREE.Object3D | undefined;
  let hand: THREE.Object3D | undefined;
  const armRest = new THREE.Quaternion();
  const forearmRest = new THREE.Quaternion();

  function aim(bone: THREE.Object3D, rest: THREE.Quaternion, direction: THREE.Vector3, orientation: THREE.Quaternion) {
    if (!bone.parent) return;
    bone.parent.getWorldQuaternion(inverseParent).invert();
    localDirection.copy(direction).applyQuaternion(orientation).applyQuaternion(inverseParent).normalize();
    restDirection.copy(UP).applyQuaternion(rest);
    bone.quaternion.copy(rest).premultiply(swing.setFromUnitVectors(restDirection, localDirection));
  }

  return {
    group,
    update(resident: THREE.Object3D, phase: Gesture, progress: number, moving: boolean) {
      if (actor !== resident) {
        actor = resident;
        arm = resident.getObjectByName('UpperArmR');
        forearm = resident.getObjectByName('ForearmR');
        hand = resident.getObjectByName('HandR');
        if (arm) armRest.copy(arm.quaternion);
        if (forearm) forearmRest.copy(forearm.quaternion);
      }
      if (!arm || !forearm || !hand) return;
      group.visible = true;
      // Telegraph the cast, then move quickly through the forward swing and settle.
      const load = phase === 'casting' && moving
        ? THREE.MathUtils.smoothstep(progress, 0.02, 0.43) * (1 - THREE.MathUtils.smoothstep(progress, 0.43, 0.72))
        : 0;
      const lift = phase === 'reeling' && moving ? THREE.MathUtils.smoothstep(progress, 0.13, 0.92) : 0;
      const bob = phase === 'fishing' && moving ? 0.015 * Math.sin(progress * 19) : 0;
      armDirection.set(-0.3, -0.91 + load * 1.28 + lift * 0.58, 0.40 - load * 0.95);
      forearmDirection.set(0.03, 0.44 + load * 0.5 + lift * 0.29 + bob, 0.88 - load);
      aim(arm, armRest, armDirection, resident.quaternion);
      aim(forearm, forearmRest, forearmDirection, resident.quaternion);
      hand.getWorldPosition(rod.position);
      rod.position.addScaledVector(forearmDirection.applyQuaternion(resident.quaternion).normalize(), 0.048);
      rodDirection.set(0.09, 0.38 + load * 1.4 + lift * 1.35 + bob, 1 - load * 1.9 - lift * 0.38)
        .normalize().applyQuaternion(resident.quaternion);
      rod.quaternion.setFromUnitVectors(UP, rodDirection);
      tip.copy(rod.position).addScaledVector(rodDirection, 1.68);
      if (phase === 'casting' && moving) {
        const flight = THREE.MathUtils.smoothstep(progress, 0.59, 1);
        float.position.lerpVectors(tip, FLOAT_TARGET, flight);
        float.position.y += 1.18 * Math.sin(Math.PI * flight);
      } else if (phase === 'reeling' && moving) {
        float.position.lerpVectors(FLOAT_TARGET, tip, lift * 0.86);
      } else {
        float.position.copy(FLOAT_TARGET);
        float.position.y += bob;
      }
      linePositions.setXYZ(0, tip.x, tip.y, tip.z);
      linePositions.setXYZ(1, (tip.x + float.position.x) / 2, (tip.y + float.position.y) / 2 - 0.09, (tip.z + float.position.z) / 2);
      linePositions.setXYZ(2, float.position.x, float.position.y, float.position.z);
      linePositions.needsUpdate = true;
    },
    hide() {
      if (!group.visible) return;
      group.visible = false;
      arm?.quaternion.copy(armRest);
      forearm?.quaternion.copy(forearmRest);
    },
    dispose() {
      line.geometry.dispose();
      line.material.dispose();
    },
  };
}
