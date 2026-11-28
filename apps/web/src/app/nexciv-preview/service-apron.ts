import * as THREE from 'three';

export type ApronPatch = { count: number; jointCount: number; rows: number[] };
const clothNames = ['ServiceApronL', 'ServiceApronR'];
const clothSafety = 0.109;

export function installServiceApron(scene: THREE.Object3D, patch?: ApronPatch) {
  if (!patch || !Array.isArray(patch.rows) || patch.rows.length % 3 !== 0) return;
  const hips = scene.getObjectByName('Hips');
  const mesh = scene.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh | undefined;
  if (!hips || !mesh || mesh.skeleton.bones.length !== patch.jointCount) return;
  const geometry = mesh.geometry;
  const weights = geometry.getAttribute('skinWeight');
  const joints = geometry.getAttribute('skinIndex');
  if (!weights || !joints || weights.count !== patch.count || joints.count !== patch.count) return;
  if (patch.rows.some((value, i) => !Number.isInteger(value) || value < 0 ||
    (i % 3 === 0 ? value >= patch.count : value > 255))) return;
  if (scene.getObjectByName(clothNames[0]!)) return;

  const clothBones = clothNames.map((name, index) => {
    const bone = new THREE.Bone();
    bone.name = name;
    // Anchors sit below the waistband in the rest model's coordinate system.
    bone.position.copy(hips.worldToLocal(new THREE.Vector3(index === 0 ? 0.091 : -0.091, 0.836, 0.115)));
    hips.add(bone);
    return bone;
  });
  const packedJoints = new THREE.Uint16BufferAttribute(new Uint16Array(patch.count * 4), 4);
  const packedWeights = new THREE.Float32BufferAttribute(new Float32Array(patch.count * 4), 4);
  for (let index = 0; index < patch.count; index += 1) {
    packedWeights.setXYZW(index, weights.getX(index), weights.getY(index), weights.getZ(index), weights.getW(index));
    packedJoints.setXYZW(index, joints.getX(index), joints.getY(index), joints.getZ(index), joints.getW(index));
  }
  for (let row = 0; row < patch.rows.length; row += 3) {
    const vertex = patch.rows[row]!;
    const weight = patch.rows[row + 1]! / 255;
    const left = patch.rows[row + 2]! / 255;
    const values: [number, number][] = [
      [joints.getX(vertex), weights.getX(vertex) * (1 - weight)],
      [joints.getY(vertex), weights.getY(vertex) * (1 - weight)],
      [joints.getZ(vertex), weights.getZ(vertex) * (1 - weight)],
      [joints.getW(vertex), weights.getW(vertex) * (1 - weight)],
      [patch.jointCount, weight * left], [patch.jointCount + 1, weight * (1 - left)],
    ];
    const selected = values.sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = selected.reduce((sum, value) => sum + value[1], 0);
    const [a, b, c, d] = selected;
    packedWeights.setXYZW(vertex, a![1] / total, b![1] / total, c![1] / total, d![1] / total);
    packedJoints.setXYZW(vertex, a![0], b![0], c![0], d![0]);
  }
  geometry.setAttribute('skinIndex', packedJoints);
  geometry.setAttribute('skinWeight', packedWeights);
  scene.updateMatrixWorld(true);
  const previous = mesh.skeleton;
  mesh.bind(new THREE.Skeleton([...previous.bones, ...clothBones], [
    ...previous.boneInverses, ...clothBones.map((bone) => bone.matrixWorld.clone().invert()),
  ]), mesh.bindMatrix.clone());
  previous.dispose();
}

export function serviceApronPose(scene: THREE.Object3D) {
  const hips = scene.getObjectByName('Hips');
  const panels = clothNames.map((name, index) => {
    const side = index === 0 ? 'L' : 'R';
    const bone = scene.getObjectByName(name);
    const thigh = scene.getObjectByName(`Thigh${side}`);
    const knee = scene.getObjectByName(`Shin${side}`);
    return bone && thigh && knee ? { bone, thigh, knee, rest: bone.position.clone() } : undefined;
  });
  if (!hips || panels.some((panel) => !panel)) return undefined;
  const joint = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const angles = new Float32Array(2);
  const { clamp, lerp, smoothstep } = THREE.MathUtils;
  return (onBench = false) => {
    for (const [index, panel] of panels.entries()) {
      const { thigh, knee } = panel!;
      hips.worldToLocal(thigh.getWorldPosition(joint));
      hips.worldToLocal(knee.getWorldPosition(tip));
      tip.sub(joint);
      angles[index] = clamp(Math.atan2(tip.z, -tip.y), 0, 1.5);
    }
    const leading = Math.max(...angles);
    for (const [index, panel] of panels.entries()) {
      const { bone, rest } = panel!;
      // Share some motion across the front seam. Backward strides leave the cloth hanging.
      const bend = lerp(angles[index]!, leading, 0.4);
      const drape = onBench ? smoothstep(bend, 0.72, 1.28) : 0;
      bone.rotation.x = -lerp(Math.min(bend * 0.72, 0.89), Math.min(bend + 0.18, 1.48), drape);
      bone.position.y = rest.y + drape * 0.063;
      bone.position.z = rest.z + lerp(Math.max(0, bend - 0.13) * clothSafety, 0.025, drape);
    }
  };
}
