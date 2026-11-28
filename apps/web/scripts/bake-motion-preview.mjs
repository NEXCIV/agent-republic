import console from 'node:console';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import * as THREE from 'three';
import { bakeCityJog, bakePreviewLocomotion, cityLocomotion, motionSources, walkPath } from './preview-locomotion.mjs';
import { bakeServiceApron } from './bake-service-apron.mjs';

const sourceDir = process.argv[2];
if (!sourceDir) throw new Error('Pass the directory containing the KayKit Rig_Medium GLBs.');
const assets = new URL('../public/nexciv-walk/', import.meta.url);
const output = new URL('../public/nexciv-motion/', import.meta.url);
const fps = 30;
const clipNames = {
  General: ['Idle_A'],
  Simulation: ['Sit_Chair_Down', 'Sit_Chair_Idle', 'Sit_Chair_StandUp'],
};

function readGlb(path) {
  const data = readFileSync(path);
  const jsonEnd = 20 + data.readUInt32LE(12);
  const json = JSON.parse(data.toString('utf8', 20, jsonEnd));
  const content = new DataView(data.buffer, data.byteOffset + jsonEnd + 8, data.byteLength - jsonEnd - 8);
  function accessor(index) {
    const spec = json.accessors[index];
    const view = json.bufferViews[spec.bufferView];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[spec.type];
    const [method, size] = {
      5121: ['getUint8', 1], 5123: ['getUint16', 2], 5126: ['getFloat32', 4],
    }[spec.componentType];
    const start = (view.byteOffset ?? 0) + (spec.byteOffset ?? 0);
    const stride = view.byteStride ?? width * size;
    const scale = spec.normalized ? 2 ** (size * 8) - 1 : 1;
    return {
      count: spec.count,
      get: (row, column) => content[method](start + row * stride + column * size, true) / scale,
      values: () => Float32Array.from({ length: spec.count * width }, (_, i) =>
        content[method](start + Math.floor(i / width) * stride + i % width * size, true) / scale),
    };
  }
  const bufferView = (index) => {
    const { byteOffset = 0, byteLength } = json.bufferViews[index];
    return data.subarray(jsonEnd + 8 + byteOffset, jsonEnd + 8 + byteOffset + byteLength);
  };
  return { json, accessor, bufferView, hash: createHash('sha256').update(data).digest('hex') };
}

function rig({ json }) {
  const nodes = json.nodes.map((node) => {
    const object = new THREE.Object3D();
    object.name = node.name;
    object.position.fromArray(node.translation ?? [0, 0, 0]);
    object.quaternion.fromArray(node.rotation ?? [0, 0, 0, 1]).normalize();
    object.scale.fromArray(node.scale ?? [1, 1, 1]);
    return object;
  });
  for (const [index, node] of json.nodes.entries()) {
    for (const child of node.children ?? []) nodes[index].add(nodes[child]);
  }
  const root = new THREE.Group();
  for (const index of json.scenes[json.scene ?? 0].nodes) root.add(nodes[index]);
  root.updateMatrixWorld(true);
  const byName = Object.fromEntries(nodes.map((node) => [node.name, node]));
  const bind = Object.fromEntries(nodes.map((node) => [node.name, {
    position: node.getWorldPosition(new THREE.Vector3()),
    rotation: node.getWorldQuaternion(new THREE.Quaternion()),
    localRotation: node.quaternion.clone(),
    localPosition: node.position.clone(),
  }]));
  return { root, nodes, byName, bind };
}

const mapping = [
  ['Hips', 'hips'], ['Spine', 'spine'], ['Chest', 'chest'], ['Head', 'head'],
  ...['L', 'R'].flatMap((side) => {
    const s = side.toLowerCase();
    return [
      [`UpperArm.${side}`, `upperarm.${s}`, `Forearm.${side}`, `lowerarm.${s}`],
      [`Forearm.${side}`, `lowerarm.${s}`, `Hand.${side}`, `wrist.${s}`],
      [`Hand.${side}`, `wrist.${s}`],
      [`Thigh.${side}`, `upperleg.${s}`, `Shin.${side}`, `lowerleg.${s}`],
      [`Shin.${side}`, `lowerleg.${s}`, `Foot.${side}`, `foot.${s}`],
      [`Foot.${side}`, `foot.${s}`],
    ];
  }),
];

function correctionFor(name, sourceName, child, sourceChild, target, source) {
  const correction = new THREE.Quaternion();
  if (name.startsWith('Hand.')) {
    const forearm = name.replace('Hand', 'Forearm');
    const sourceForearm = sourceName.replace('wrist', 'lowerarm');
    correction.setFromUnitVectors(
      target.bind[name].position.clone().sub(target.bind[forearm].position).normalize(),
      source.bind[sourceName].position.clone().sub(source.bind[sourceForearm].position).normalize(),
    );
  } else if (child && sourceChild) {
    correction.setFromUnitVectors(
      target.bind[child].position.clone().sub(target.bind[name].position).normalize(),
      source.bind[sourceChild].position.clone().sub(source.bind[sourceName].position).normalize(),
    );
  }
  return source.bind[sourceName].rotation.clone().invert().multiply(correction).multiply(target.bind[name].rotation);
}

function solveSourcePose(file, model, name) {
  const animation = file.json.animations.find((clip) => clip.name === name);
  const tracks = animation.channels.map(({ sampler, target }) => {
    const { input, output, interpolation } = animation.samplers[sampler];
    if (interpolation && interpolation !== 'LINEAR') throw new Error(`Unsupported interpolation for ${name}`);
    const property = { translation: 'position', rotation: 'quaternion', scale: 'scale' }[target.path];
    const Track = property === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    const track = new Track(`${model.nodes[target.node].name}.${property}`, file.accessor(input).values(), file.accessor(output).values());
    return { object: model.nodes[target.node], property, sample: track.createInterpolant(), end: track.times.at(-1) };
  });
  return {
    duration: Math.max(...tracks.map((track) => track.end)),
    sample(time) {
      for (const { object, property, sample } of tracks) object[property].fromArray(sample.evaluate(time));
      model.root.updateMatrixWorld(true);
    },
  };
}

function solePoints(file, model) {
  const soles = ['Foot.L', 'Foot.R'].map((name) => ({
    foot: model.byName[name], points: [], ground: Infinity,
  }));
  for (const mesh of file.json.nodes.filter((node) => node.skin !== undefined)) {
    const skin = file.json.skins[mesh.skin];
    for (const primitive of file.json.meshes[mesh.mesh].primitives) {
      const { POSITION, JOINTS_0, WEIGHTS_0 } = primitive.attributes;
      const positions = file.accessor(POSITION);
      const joints = file.accessor(JOINTS_0);
      const weights = file.accessor(WEIGHTS_0);
      const indices = soles.map(({ foot }) => skin.joints.findIndex((i) => model.nodes[i] === foot));
      for (let i = 0; i < positions.count; i += 1) {
        for (let column = 0; column < 4; column += 1) {
          const sole = soles[indices.indexOf(joints.get(i, column))];
          if (!sole || weights.get(i, column) < 0.8) continue;
          const vertex = new THREE.Vector3(positions.get(i, 0), positions.get(i, 1), positions.get(i, 2));
          sole.ground = Math.min(sole.ground, vertex.y);
          sole.points.push(vertex);
        }
      }
    }
  }
  for (const sole of soles) {
    sole.points = sole.points.filter((point) => point.y <= sole.ground + 0.018)
      .map((point) => sole.foot.worldToLocal(point));
    if (!sole.points.length) throw new Error(`Missing ground contact points for ${sole.foot.name}`);
  }
  return soles;
}

function contact({ foot, points }) {
  const hull = new THREE.Box3().setFromPoints(points.map((point) => foot.localToWorld(point.clone())));
  return hull.getCenter(new THREE.Vector3()).setY(hull.min.y);
}

function bake(file, source, target, soles, name) {
  const motion = solveSourcePose(file, source, name);
  const steps = Math.ceil(motion.duration * fps);
  const times = Array.from({ length: steps + 1 }, (_, i) => i * motion.duration / steps);
  const links = mapping.map(([key, sourceKey, child, sourceChild]) => ({
    bone: target.byName[key], sourceBone: source.byName[sourceKey],
    basis: correctionFor(key, sourceKey, child, sourceChild, target, source),
    keys: [],
  }));
  const rotation = new THREE.Quaternion();
  const parentRotation = new THREE.Quaternion();
  const direction = new THREE.Vector3();
  const upright = new THREE.Quaternion();
  const hips = target.byName.Hips;
  const hipKeys = [];
  const legScale = (target.byName['Shin.L'].position.length() + target.byName['Foot.L'].position.length()) /
    (source.byName['lowerleg.l'].position.length() + source.byName['foot.l'].position.length());
  for (const time of times) {
    motion.sample(time);
    hips.position.copy(source.byName.hips.position).sub(source.bind.hips.localPosition)
      .multiplyScalar(legScale).add(target.bind.Hips.localPosition);
    const progress = time / motion.duration;
    const sitting = name === 'Sit_Chair_Idle' ? 1 :
      name === 'Sit_Chair_Down' ? THREE.MathUtils.smoothstep(progress, 0.35, 0.91) :
      name === 'Sit_Chair_StandUp' ? 1 - THREE.MathUtils.smoothstep(progress, 0.12, 0.65) : 0;
    for (const { bone, sourceBone, basis } of links) {
      sourceBone.getWorldQuaternion(rotation).multiply(basis);
      if (sitting && bone.name.startsWith('Foot.')) {
        rotation.slerp(target.bind[bone.name].rotation, sitting);
      }
      if (sitting && bone.name.startsWith('Shin.')) {
        direction.set(0, 1, 0).applyQuaternion(rotation);
        const down = new THREE.Vector3(Math.sign(direction.x) * 0.05, -1, 0.10).normalize();
        upright.setFromUnitVectors(direction, down).multiply(rotation);
        rotation.slerp(upright, sitting);
      }
      bone.parent.getWorldQuaternion(parentRotation).invert();
      bone.quaternion.copy(parentRotation.multiply(rotation)).normalize();
    }
    target.root.updateMatrixWorld(true);
    const frameFeet = soles.map(contact);
    const lift = -Math.min(...frameFeet.map(({ y }) => y));
    hips.position.y += lift;
    hipKeys.push(...hips.position.toArray());
    for (const { bone, keys } of links) keys.push(...bone.quaternion.toArray());
  }
  const tracks = links.map(({ bone, keys }) => new THREE.QuaternionKeyframeTrack(
    `${THREE.PropertyBinding.sanitizeNodeName(bone.name)}.quaternion`, times, keys,
  ));
  tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hipKeys));
  const worldPose = Object.fromEntries(links.map(({ bone }) => [bone.name, bone.getWorldQuaternion(new THREE.Quaternion())]));
  return { clip: new THREE.AnimationClip(name, motion.duration, tracks), hipKeys, worldPose };
}

const { walkSources, jog } = motionSources(sourceDir, readGlb, rig, solveSourcePose);
function clipJson(clip) {
  // Keep sub-millimetre precision and avoid serializing the random runtime UUID.
  const json = THREE.AnimationClip.toJSON(clip.optimize());
  delete json.uuid;
  for (const track of json.tracks) {
    track.times = track.times.map((time) => +time.toFixed(5));
    track.values = track.values.map((value) => +value.toFixed(5));
  }
  return json;
}

mkdirSync(output, { recursive: true });
for (const id of ['02', '06']) {
  const file = readGlb(new URL(`agent-${id}.glb`, assets));
  const target = rig(file);
  const soles = solePoints(file, target);
  const clips = [];
  let seat;
  let standing;
  for (const [pack, names] of Object.entries(clipNames)) {
    const input = readGlb(resolve(sourceDir, `Rig_Medium_${pack}.glb`));
    for (const name of names) {
      const source = rig(input);
      const motion = bake(input, source, target, soles, name);
      clips.push(motion.clip);
      if (name === 'Idle_A') standing = motion.worldPose;
      if (name === 'Sit_Chair_Idle') {
        seat = {
          y: motion.hipKeys[1] - 0.105,
          z: motion.hipKeys[2] + 0.065,
        };
      }
    }
  }
  for (const [label, source] of walkSources) {
    for (const turning of [false, true]) {
      const { clip, error, lift, maxHipStep } = bakePreviewLocomotion(label, source, target, soles, standing, turning);
      clips.push(clip);
      console.log(id, clip.name, 'maximum planted ankle error (mm)', (error * 1000).toFixed(2),
        'maximum sole lift (cm)', (lift * 100).toFixed(1), 'largest hip frame step (mm)', (maxHipStep * 1000).toFixed(1));
    }
  }
  const gait = cityLocomotion(clips.find((clip) => clip.name === 'Quaternius_Walk'),
    clips.find((clip) => clip.name === 'Quaternius_Turn'));
  const jogging = bakeCityJog(target, soles, jog);
  const apron = id === '06' ? await bakeServiceApron(file) : undefined;
  const shoeContacts = soles.map(({ foot, points }) => {
    // The lowest part of the original boot supplies reference points for the terrain solver.
    const location = target.bind[foot.name];
    const bounds = new THREE.Box3().setFromPoints(points.map((point) => point.clone().applyQuaternion(location.rotation)));
    const local = location.rotation.clone().invert();
    const { x } = bounds.getCenter(new THREE.Vector3());
    const inset = 0.012;
    return [bounds.min.z + inset, bounds.max.z - inset].map((z) =>
      new THREE.Vector3(x, bounds.min.y, z).applyQuaternion(local).toArray().map((value) => +value.toFixed(5)),
    );
  });
  const sidecar = { modelHash: file.hash, seat, walkPath, clips: clips.map(clipJson) };
  writeFileSync(new URL(`agent-${id}.json`, output), JSON.stringify(sidecar));
  writeFileSync(new URL(`agent-${id}-city-v1.json`, output),
    JSON.stringify({ modelHash: file.hash, stride: gait.stride, jogStride: jogging.stride, shoeContacts, apron,
      clips: [...gait.clips, jogging.clip].map(clipJson) }));
  console.log(id, 'seat', seat, 'clips', clips.map((clip) => clip.name));
}
