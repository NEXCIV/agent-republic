import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

export type RoutePoint = [number, number, number];
export type AgentPhase = 'outbound' | 'arrived' | 'inbound' | 'atNexus';
export type PatrolCue = {
  hold?: 'start' | 'end';
  face?: THREE.Vector3;
  gesture?: 'wave' | 'nod';
};

const SPEED = 1.25;
const STOP_SECONDS = 4;
const UP = new THREE.Vector3(0, 1, 0);
const PITCH_AXIS = new THREE.Vector3(1, 0, 0);

function createNod(asset: GLTF, mixer: THREE.AnimationMixer) {
  const head = asset.scene.getObjectByName('Head');
  if (!head) return undefined;
  const angles = [0, 0.19, 0.13, 0];
  const times = [0, 0.24, 0.40, 0.76];
  const rotation = new THREE.Quaternion();
  const track = new THREE.QuaternionKeyframeTrack(`${head.uuid}.quaternion`, times,
    angles.flatMap((angle) => rotation.setFromAxisAngle(PITCH_AXIS, angle).toArray()),
  );
  const clip = new THREE.AnimationClip('Acknowledge', times.at(-1)!, [track], THREE.AdditiveAnimationBlendMode);
  return mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
}

function measuredRoute(points: RoutePoint[]) {
  let length = 0;
  let previous: THREE.Vector3 | undefined;
  const route = points.map((point) => {
    const position = new THREE.Vector3(...point);
    if (previous) length += position.distanceTo(previous);
    previous = position;
    return { position, distance: length };
  });
  if (!Number.isFinite(length) || length <= 0) throw new Error('Invalid Agent route');
  return { route, length };
}

export function createAgentPatrol(asset: GLTF, points: RoutePoint[], initialDestination: [number, number]) {
  let { route, length } = measuredRoute(points);
  let destination = initialDestination;
  const idleClip = THREE.AnimationClip.findByName(asset.animations, 'Idle');
  const walkClip = THREE.AnimationClip.findByName(asset.animations, 'Walk');
  const stride = Number(asset.scene.children.find((object) => object.userData.walk_stride_m)?.userData.walk_stride_m);
  if (!idleClip || !walkClip || !Number.isFinite(stride) || stride <= 0) {
    throw new Error('Invalid Agent motion clips or stride');
  }

  const root = new THREE.Group();
  root.add(asset.scene);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.72), new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `varying vec2 p; void main() { p = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 p; void main() { gl_FragColor = vec4(0.04, 0.04, 0.05, 0.30 * (1.0 - smoothstep(0.12, 1.0, length(p)))); }`,
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.023;
  root.add(shadow);

  const mixer = new THREE.AnimationMixer(asset.scene);
  const idle = mixer.clipAction(idleClip).play();
  const walk = mixer.clipAction(walkClip);
  walk.setEffectiveTimeScale(SPEED * walkClip.duration / stride);
  const waveClip = THREE.AnimationClip.findByName(asset.animations, 'Wave');
  const wave = waveClip ? mixer.clipAction(waveClip).setLoop(THREE.LoopOnce, 1) : undefined;
  if (wave) wave.clampWhenFinished = true;
  let nod: THREE.AnimationAction | undefined;
  let nodding = false;
  let action = idle;
  let distance = 0;
  let direction = 1;
  let dwell = 0;
  let phase: AgentPhase = 'outbound';
  const ahead = new THREE.Vector3();
  const behind = new THREE.Vector3();
  const heading = new THREE.Quaternion();

  function positionAt(distance: number, target: THREE.Vector3) {
    if (distance <= 0) return target.copy(route[0]!.position);
    if (distance >= length) return target.copy(route.at(-1)!.position);
    const next = route.findIndex((waypoint) => waypoint.distance > distance);
    const from = route[next - 1]!;
    const to = route[next]!;
    return target.lerpVectors(from.position, to.position, (distance - from.distance) / (to.distance - from.distance));
  }

  function updatePose(dt: number, cue?: PatrolCue, heldAtStart = false) {
    positionAt(distance, root.position);
    const tangent = positionAt(distance + 0.45, ahead).sub(positionAt(distance - 0.45, behind));
    const alongRoute = Math.atan2(tangent.x * direction, tangent.z * direction);
    let yaw = alongRoute;
    if (phase === 'arrived') yaw = Math.atan2(destination[0] - root.position.x, destination[1] - root.position.z);
    if (dwell > STOP_SECONDS - 1.1) yaw = alongRoute + Math.PI;
    if (cue?.face) yaw = Math.atan2(cue.face.x - root.position.x, cue.face.z - root.position.z);
    heading.setFromAxisAngle(UP, yaw);
    if (dt > 0) root.quaternion.rotateTowards(heading, dt * 3.2);
    else root.quaternion.copy(heading);

    const moving = !heldAtStart && (phase === 'outbound' || phase === 'inbound');
    const next = moving ? walk : (cue?.gesture === 'wave' && wave) || idle;
    if (dt > 0 && next !== action) {
      next.reset().setEffectiveWeight(1).play();
      next.crossFadeFrom(action, 0.18, false);
      action = next;
    }
    const shouldNod = cue?.gesture === 'nod';
    if (shouldNod && !nodding) {
      nod ??= createNod(asset, mixer);
      nod?.reset().play();
    }
    nodding = shouldNod;
    mixer.update(dt);
  }

  updatePose(0);
  return {
    root,
    get phase() { return phase; },
    get progress() { return Math.round(100 * distance / length); },
    get metresRemaining() { return length - distance; },
    get dwelledSeconds() { return dwell; },
    plan(nextPoints: RoutePoint[], nextDestination: [number, number]) {
      ({ route, length } = measuredRoute(nextPoints));
      destination = nextDestination;
      distance = dwell = 0;
      direction = 1;
      phase = 'outbound';
    },
    advance(dt: number, cue?: PatrolCue) {
      if (dt <= 0) return;
      const heldAtStart = cue?.hold === 'start' && distance === 0;
      const heldAtEnd = cue?.hold === 'end' && phase === 'arrived';
      if (phase === 'arrived' || phase === 'atNexus') {
        dwell += dt;
        if (dwell >= STOP_SECONDS && !heldAtStart && !heldAtEnd) {
          dwell = 0;
          direction *= -1;
          phase = direction > 0 ? 'outbound' : 'inbound';
        }
      } else if (!heldAtStart) {
        distance = THREE.MathUtils.clamp(distance + direction * SPEED * dt, 0, length);
        if (distance === length) phase = 'arrived';
        if (distance === 0) phase = 'atNexus';
      }
      updatePose(dt, cue, heldAtStart);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(asset.scene);
      shadow.geometry.dispose();
      shadow.material.dispose();
    },
  };
}
