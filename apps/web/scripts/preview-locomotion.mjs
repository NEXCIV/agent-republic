import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';

const { clamp, lerp, smoothstep } = THREE.MathUtils;
const up = new THREE.Vector3(0, 1, 0);
const forward = new THREE.Vector3(0, 0, 1);
const pitchAxis = new THREE.Vector3(1, 0, 0);
const sides = ['L', 'R'];
const stepTime = 0.39;
const fps = 60;
export const walkPath = { speed: 1.25, start: 0.38, duration: 3.07, ramp: 0.43 };
const walkDuration = 4.1;
const turnDuration = 2.4;
const turnAngle = -Math.PI / 2;

const upperBody = [
  ['Hips', 'pelvis', 'Hips'], ['Spine', 'spine_01', 'Chest2'],
  ['Chest', 'spine_03', 'Chest4'], ['Head', 'Head', 'Head'],
  ...sides.flatMap((side) => {
    const letter = side.toLowerCase();
    const word = side === 'L' ? 'Left' : 'Right';
    return [
      [`UpperArm.${side}`, `upperarm_${letter}`, `${word}Shoulder`, `Forearm.${side}`, `lowerarm_${letter}`, `${word}Elbow`],
      [`Forearm.${side}`, `lowerarm_${letter}`, `${word}Elbow`, `Hand.${side}`, `hand_${letter}`, `${word}Wrist`],
    ];
  }),
];

function distanceAt(time) {
  const { speed, start, duration, ramp } = walkPath;
  const elapsed = clamp(time - start, 0, duration);
  if (elapsed < ramp) return speed * elapsed ** 2 / (2 * ramp);
  if (elapsed > duration - ramp) return speed * (duration - ramp - (duration - elapsed) ** 2 / (2 * ramp));
  return speed * (elapsed - ramp / 2);
}

const walkDistance = distanceAt(walkDuration);

function trackSource(byName, sample, human) {
  const driven = upperBody.map(([key, ual, bvh, child, ualChild, bvhChild]) => {
    const node = byName[human ? bvh : ual];
    return {
      key, node, child, sourceChild: child ? byName[human ? bvhChild : ualChild] : null,
      bind: node.getWorldQuaternion(new THREE.Quaternion()),
    };
  });
  const names = human ? [['LeftAnkle', 'LeftToe'], ['RightAnkle', 'RightToe']] :
    [['foot_l', 'ball_l'], ['foot_r', 'ball_r']];
  const hip = byName[human ? 'Hips' : 'pelvis'];
  const phaseStart = human ? 537 / 60 : 0.72;
  const cycle = human ? 80 / 60 : 4 / 3;
  const sourceScale = human ? 0.01 : 1;
  sample(phaseStart);
  const elevation = hip.getWorldPosition(new THREE.Vector3()).y;
  return {
    driven,
    sourceAxis: new THREE.Quaternion().setFromAxisAngle(up, human ? -0.146 : 0),
    sample(phase) {
      const time = phaseStart + ((phase + 1) % 1) * cycle;
      sample(human ? time : time % cycle);
    },
    hipBob() { return (hip.getWorldPosition(new THREE.Vector3()).y - elevation) * sourceScale; },
    foot(side) {
      const [ankle, toe] = names[side].map((name) => byName[name].getWorldPosition(new THREE.Vector3()));
      const ankleFloor = human ? 13 : 0.108;
      return {
        rise: clamp((ankle.y - ankleFloor) * sourceScale * 0.64, 0, 0.11),
        pitch: clamp(Math.atan2(ankle.y - toe.y, Math.hypot(toe.z - ankle.z, toe.x - ankle.x)) - 0.47, -0.27, 0.55),
      };
    },
  };
}

export function motionSources(sourceDir, readGlb, rig, solveSourcePose) {
  const ual = readGlb(resolve(sourceDir, 'Universal Animation Library[Standard]', 'Unreal-Godot', 'UAL1_Standard_RM.glb'));
  const ualRig = rig(ual);
  const walk = solveSourcePose(ual, ualRig, 'Walk_Loop');
  const ualSource = trackSource(ualRig.byName, walk.sample, false);

  const { skeleton, clip } = new BVHLoader().parse(readFileSync(resolve(sourceDir, 'Neutral_FW.bvh'), 'utf8'));
  const bones = Object.fromEntries(skeleton.bones.map((bone) => [bone.name, bone]));
  const root = skeleton.bones[0];
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip).play();
  action.paused = true;
  const captured = trackSource(bones, (time) => {
    action.time = time;
    mixer.update(0);
    root.updateMatrixWorld(true);
  }, true);

  return [['Quaternius', ualSource], ['100STYLE', captured]];
}

function setWorldRotation(bone, rotation) {
  const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parent.multiply(rotation)).normalize();
}

function bindFeet(target, soles) {
  return soles.map(({ foot, points }, index) => {
    const side = sides[index];
    const box = new THREE.Box3().setFromPoints(points.map((point) =>
      point.clone().applyQuaternion(target.bind[foot.name].rotation)));
    const center = box.getCenter(new THREE.Vector3()).setY(box.min.y);
    const position = target.bind[foot.name].position.clone().add(center).setY(0);
    return {
      foot, points, position, center,
      thigh: target.byName[`Thigh.${side}`], knee: target.byName[`Shin.${side}`],
      neutral: target.bind[foot.name].rotation,
    };
  });
}

function stepPlan(feet, turning) {
  const placements = feet.map(({ position }) => position.clone());
  const headings = [0, 0];
  if (turning) {
    const pivots = [[1, 0.28, 0.66, 0.54], [0, 0.69, 1.07, 1], [1, 1.11, 1.43, 1]];
    return pivots.map(([side, start, end, amount]) => {
      const from = placements[side];
      const fromYaw = headings[side];
      const yaw = turnAngle * amount;
      const to = feet[side].position.clone().applyAxisAngle(up, yaw);
      placements[side] = to;
      headings[side] = yaw;
      return { side, start, end, from, to, fromYaw, yaw };
    });
  }
  return Array.from({ length: 8 }, (_, index) => {
    const side = index % 2;
    const from = placements[side];
    const start = 0.39 + stepTime * index;
    const end = start + stepTime - 0.035;
    const to = feet[side].position.clone();
    // Place each foot under the body's midpoint over the coming stance.
    to.z += index >= 6 ? walkDistance : distanceAt(end + (stepTime + 0.035) / 2);
    placements[side] = to;
    return { side, start, end, from, to, fromYaw: 0, yaw: 0 };
  });
}

function placeFoot(steps, source, time, foot, index, turning) {
  const step = steps.findLast(({ side, start }) => side === index && time >= start);
  if (!step) return { sole: foot.position.clone(), yaw: 0, pitch: 0, planted: true };
  const phase = clamp((time - step.start) / (step.end - step.start), 0, 1);
  const ease = 0.17;
  const eased = phase < ease ? phase ** 2 / (2 * ease) :
    phase > 1 - ease ? 1 - ease - (1 - phase) ** 2 / (2 * ease) : phase - ease / 2;
  const amount = phase === 1 ? 1 : eased / (1 - ease);
  const sole = step.from.clone().lerp(step.to, amount);
  if (phase === 1) return { sole, yaw: step.yaw, pitch: 0, planted: true };
  const measured = source.foot(index);
  const pulse = Math.sin(Math.PI * phase);
  const reach = lerp(0.52, 1, smoothstep(step.from.distanceTo(step.to), 0.18, 0.84));
  sole.y = pulse * (turning ? 0.038 : clamp(measured.rise, 0.040, 0.084) * reach);
  return {
    sole, yaw: lerp(step.fromYaw, step.yaw, amount),
    pitch: pulse * (turning ? measured.pitch * 0.24 : clamp(measured.pitch, -0.25, 0.36)), planted: false,
  };
}

function desiredAnkle(foot, { sole, yaw, pitch }) {
  const pivot = new THREE.Quaternion().setFromAxisAngle(up, yaw)
    .multiply(new THREE.Quaternion().setFromAxisAngle(pitchAxis, pitch));
  const rotation = pivot.clone().multiply(foot.neutral);
  const offset = foot.center.clone().applyQuaternion(pivot);
  offset.y = Math.min(...foot.points.map((point) => point.clone().applyQuaternion(rotation).y));
  return { position: sole.clone().sub(offset), rotation };
}

function solveLeg(foot, ankle, yaw) {
  const hip = foot.thigh.getWorldPosition(new THREE.Vector3());
  const line = ankle.position.clone().sub(hip);
  const thigh = foot.knee.position.length();
  const shin = foot.foot.position.length();
  const reach = clamp(line.length(), Math.abs(thigh - shin) + 0.001, thigh + shin - 0.001);
  line.normalize();
  const kneeDirection = forward.clone().applyAxisAngle(up, yaw);
  kneeDirection.addScaledVector(line, -kneeDirection.dot(line)).normalize();
  const along = (thigh * thigh - shin * shin + reach * reach) / (2 * reach);
  const knee = hip.clone().addScaledVector(line, along)
    .addScaledVector(kneeDirection, Math.sqrt(thigh * thigh - along * along));
  for (const [bone, start, end] of [
    [foot.thigh, hip, knee], [foot.knee, knee, ankle.position],
  ]) {
    const orientation = bone.getWorldQuaternion(new THREE.Quaternion());
    const oldDirection = up.clone().applyQuaternion(orientation);
    const desired = end.clone().sub(start).normalize();
    setWorldRotation(bone, new THREE.Quaternion().setFromUnitVectors(oldDirection, desired).multiply(orientation));
  }
  setWorldRotation(foot.foot, ankle.rotation);
  return foot.foot.getWorldPosition(new THREE.Vector3()).distanceTo(ankle.position);
}

export function bakePreviewLocomotion(label, source, target, soles, baseline, turning) {
  const duration = turning ? turnDuration : walkDuration;
  const count = Math.round(duration * fps);
  const times = Array.from({ length: count + 1 }, (_, i) => i * duration / count);
  for (const [key, bone] of Object.entries(target.byName)) {
    bone.quaternion.copy(target.bind[key].localRotation);
    bone.position.copy(target.bind[key].localPosition);
  }
  target.root.updateMatrixWorld(true);
  const feet = bindFeet(target, soles);
  const plans = stepPlan(feet, turning);
  const root = target.byName.Root;
  const hips = target.byName.Hips;
  const tracks = new Map(Object.entries(target.byName).filter(([name]) => name === 'Root' ||
    /^(Hips|Spine|Chest|Head|UpperArm|Forearm|Thigh|Shin|Foot)/.test(name))
    .map(([name, bone]) => [bone, { name: THREE.PropertyBinding.sanitizeNodeName(name), values: [] }]));
  const fromRotation = new THREE.Quaternion();
  const orientations = source.driven.map(({ key, node, bind, child, sourceChild }) => {
    fromRotation.identity();
    if (child) {
      const rest = target.bind[child].position.clone().sub(target.bind[key].position).normalize();
      // Each skeleton has its own relaxed A/T pose and bone roll.
      const sourceAxis = sourceChild.position.clone().normalize().applyQuaternion(bind);
      fromRotation.setFromUnitVectors(rest, sourceAxis);
    }
    return { key, node, basis: bind.clone().invert().multiply(fromRotation).multiply(target.bind[key].rotation) };
  });
  const rootKeys = [];
  const hipKeys = [];
  let error = 0;
  let lift = 0;
  const frames = times.map((time) => {
    const phase = (turning ? (time - 0.28) / 0.8 + 0.5 : (time - 0.39) / (stepTime * 2)) % 1;
    source.sample(phase);
    const moving = smoothstep(time, 0.38, 0.62) * (1 - smoothstep(time, 3.02, 3.48));
    const stepping = turning ? smoothstep(time, 0.28, 0.48) * (1 - smoothstep(time, 1.18, 1.49)) : moving;
    const yaw = turning ? turnAngle * smoothstep(time, 0.30, 1.36) : 0;
    const depth = turning ? 0 : distanceAt(time);
    root.position.set(0, 0, depth);
    root.quaternion.setFromAxisAngle(up, yaw);
    hips.position.copy(target.bind.Hips.localPosition);
    hips.position.x -= Math.sin(phase * Math.PI * 2) * 0.015 * stepping;
    hips.position.y += -0.005 + (-0.007 + clamp(source.hipBob() * 0.4, -0.012, 0.012)) * stepping;
    for (const { key, node, basis } of orientations) {
      const arm = /^(UpperArm|Forearm)/.test(key);
      const pose = node.getWorldQuaternion(new THREE.Quaternion()).multiply(basis);
      pose.premultiply(source.sourceAxis);
      const amount = stepping * (arm ? (turning ? 0.32 : 0.64) : 0.64);
      pose.copy(baseline[key].clone().slerp(pose, amount)).premultiply(root.quaternion);
      setWorldRotation(target.byName[key], pose);
    }
    const samples = feet.map((foot, index) => placeFoot(plans, source, time, foot, index, turning));
    const ankles = feet.map((foot, index) => desiredAnkle(foot, samples[index]));
    let maxHipDrop = 0;
    for (const [index, foot] of feet.entries()) {
      const delta = foot.thigh.getWorldPosition(new THREE.Vector3()).sub(ankles[index].position);
      const limit = foot.knee.position.length() + foot.foot.position.length() - 0.004;
      const limitY = Math.sqrt(Math.max(0, limit ** 2 - delta.x ** 2 - delta.z ** 2));
      maxHipDrop = Math.max(delta.y - limitY, maxHipDrop);
    }
    return {
      depth, yaw, samples, ankles,
      hipPosition: hips.position.clone(),
      rotations: orientations.map(({ key }) => target.byName[key].quaternion.clone()),
      ceiling: hips.position.y - maxHipDrop,
    };
  });
  for (const [index, frame] of frames.entries()) {
    const { depth, yaw, samples, ankles, hipPosition, rotations } = frame;
    root.position.set(0, 0, depth);
    root.quaternion.setFromAxisAngle(up, yaw);
    hips.position.copy(hipPosition);
    for (const [i, { key }] of orientations.entries()) target.byName[key].quaternion.copy(rotations[i]);
    // Lower into the next support step gradually, while staying within leg reach.
    for (const [nearby, neighbor] of frames.entries()) {
      const allowance = ((index - nearby) / 18) ** 2 * 0.055;
      hips.position.y = Math.min(hips.position.y, neighbor.ceiling + allowance);
    }
    for (const [index, foot] of feet.entries()) {
      // Start from the target bind roll every frame to avoid accumulated knee twist.
      for (const bone of [foot.thigh, foot.knee]) bone.quaternion.copy(target.bind[bone.name].localRotation);
      const difference = solveLeg(foot, ankles[index], yaw);
      if (samples[index].planted) error = Math.max(error, difference);
      lift = Math.max(lift, samples[index].sole.y);
    }
    for (const [bone, { values }] of tracks) values.push(...bone.quaternion.toArray());
    rootKeys.push(0, 0, depth - (turning ? 0 : walkDistance / 2));
    hipKeys.push(...hips.position.toArray());
  }
  const baked = Array.from(tracks.values(), ({ name, values }) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values));
  baked.push(new THREE.VectorKeyframeTrack('Root.position', times, rootKeys));
  baked.push(new THREE.VectorKeyframeTrack('Hips.position', times, hipKeys));
  if (error > 0.003) throw new Error(`${label}: planted ankle error ${error.toFixed(4)}m`);
  let maxHipStep = 0;
  for (let i = 4; i < hipKeys.length; i += 3) maxHipStep = Math.max(maxHipStep, Math.abs(hipKeys[i] - hipKeys[i - 3]));
  if (maxHipStep > 0.013) throw new Error(`${label}: hip moves ${maxHipStep.toFixed(4)}m in one frame`);
  return { clip: new THREE.AnimationClip(`${label}_${turning ? 'Turn' : 'Walk'}`, duration, baked), error, lift, maxHipStep };
}
