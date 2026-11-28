import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { CityAgentAsset } from './city-gait';

export type RoutePoint = [number, number, number];
export type AgentPhase = 'outbound' | 'arrived' | 'inbound' | 'atNexus';
export type PatrolCue = {
  hold?: 'start' | 'end';
  face?: THREE.Vector3;
  gesture?: 'wave' | 'nod' | 'install';
};

const SPEED = 1.25;
const JOG_SPEED = 2.4;
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

function createInstallationPose(asset: GLTF, mixer: THREE.AnimationMixer) {
  const times = [0, 0.54, 0.96, 1.48, 2.06, 2.6, 3.2];
  const axes = new THREE.Quaternion();
  const worldPitch = PITCH_AXIS.clone().applyQuaternion(asset.scene.getWorldQuaternion(axes));
  const tracks: THREE.QuaternionKeyframeTrack[] = [];
  const keyframes: Array<[string, number[]]> = [
    ['Head', [0.19, 0.27, 0.31, 0.24, 0.28, 0.23, 0.19]],
    ['UpperArm.L', [-0.20, -0.27, -0.28, -0.25, -0.28, -0.23, -0.20]],
    ['UpperArm.R', [-0.30, -0.41, -0.37, -0.41, -0.33, -0.31, -0.30]],
    ['Forearm.L', [-0.67, -0.83, -0.83, -0.76, -0.83, -0.72, -0.67]],
    ['Forearm.R', [-0.72, -0.92, -1.12, -0.77, -1.12, -0.82, -0.72]],
  ];
  for (const [name, angles] of keyframes) {
    const bone = asset.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
    if (!bone) continue;
    const pitch = worldPitch.clone().applyQuaternion(bone.getWorldQuaternion(axes).invert());
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${bone.name}.quaternion`, times, angles.flatMap((angle) => axes.setFromAxisAngle(pitch, angle).toArray()),
    ));
  }
  return mixer.clipAction(new THREE.AnimationClip('Install lighting', 3.2, tracks, THREE.AdditiveAnimationBlendMode));
}

function benchIdle(idle: THREE.AnimationClip) {
  const clip = idle.clone();
  clip.name = 'Bench rest';
  const delta = new THREE.Quaternion();
  const rotation = new THREE.Quaternion();
  for (const track of clip.tracks) {
    if (!/^(Thigh|Shin)[LR]\.quaternion$/.test(track.name)) continue;
    delta.setFromAxisAngle(PITCH_AXIS, track.name.startsWith('Thigh') ? -1.45 : 1.48);
    for (let offset = 0; offset < track.values.length; offset += 4) {
      rotation.fromArray(track.values, offset).multiply(delta).toArray(track.values, offset);
    }
  }
  return clip;
}

export function measuredRoute(points: RoutePoint[]) {
  let length = 0;
  let previous: THREE.Vector3 | undefined;
  const route = points.map((point) => {
    const position = new THREE.Vector3(...point);
    if (previous) length += position.distanceTo(previous);
    previous = position;
    return { position, distance: length };
  });
  if (!Number.isFinite(length) || length <= 0) throw new Error('Invalid Agent route');
  return {
    route,
    length,
    positionAt(distance: number, target: THREE.Vector3) {
      if (distance <= 0) return target.copy(route[0]!.position);
      if (distance >= length) return target.copy(route.at(-1)!.position);
      const next = route.findIndex(waypoint => waypoint.distance > distance);
      const from = route[next - 1]!;
      const to = route[next]!;
      return target.lerpVectors(from.position, to.position, (distance - from.distance) / (to.distance - from.distance));
    },
  };
}

export function createAgentPatrol(asset: CityAgentAsset, points: RoutePoint[], initialDestination: [number, number], moveSpeed = SPEED) {
  let { length, positionAt } = measuredRoute(points);
  let destination = initialDestination;
  const gait = asset.gait;
  const idleClip = THREE.AnimationClip.findByName(asset.animations, 'Idle');
  const walkClip = gait?.walk ?? THREE.AnimationClip.findByName(asset.animations, 'Walk');
  const stride = gait?.stride ?? Number(asset.scene.children.find((object) => object.userData.walk_stride_m)?.userData.walk_stride_m);
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
  walk.setEffectiveTimeScale(gait ? 0 : moveSpeed * walkClip.duration / stride);
  const jog = gait && mixer.clipAction(gait.jog).setEffectiveTimeScale(0);
  const pivot = gait && mixer.clipAction(gait.pivot).setLoop(THREE.LoopOnce, 1).setEffectiveTimeScale(0);
  const waveClip = THREE.AnimationClip.findByName(asset.animations, 'Wave');
  const wave = waveClip ? mixer.clipAction(waveClip).setLoop(THREE.LoopOnce, 1) : undefined;
  if (wave) wave.clampWhenFinished = true;
  let nod: THREE.AnimationAction | undefined;
  let nodding = false;
  let installing: THREE.AnimationAction | undefined;
  let working = false;
  let action = idle;
  let distance = 0;
  let direction = 1;
  let dwell = 0;
  let phase: AgentPhase = 'outbound';
  const ahead = new THREE.Vector3();
  const behind = new THREE.Vector3();
  const heading = new THREE.Quaternion();
  const relativeHeading = new THREE.Quaternion();
  const previousPosition = new THREE.Vector3();
  let turn: { from: THREE.Quaternion; to: THREE.Quaternion; elapsed: number; right: boolean } | undefined;

  let seatedPose: THREE.AnimationAction | undefined;
  const standingY = asset.scene.position.y;
  function updatePose(dt: number, cue?: PatrolCue, heldAtStart = false, observed?: THREE.Vector3, walking?: boolean,
    seated = false, routeSpeed = moveSpeed, journeyDistance?: number) {
    previousPosition.copy(root.position);
    if (observed) root.position.copy(observed);
    else positionAt(distance, root.position);
    const travel = Math.hypot(root.position.x - previousPosition.x, root.position.z - previousPosition.z);
    const tangent = positionAt(distance + 0.45, ahead).sub(positionAt(distance - 0.45, behind));
    const alongRoute = Math.atan2(tangent.x * direction, tangent.z * direction);
    let yaw = alongRoute;
    if (phase === 'arrived') yaw = Math.atan2(destination[0] - root.position.x, destination[1] - root.position.z);
    if (dwell > STOP_SECONDS - 1.1) yaw = alongRoute + Math.PI;
    if (cue?.face) yaw = Math.atan2(cue.face.x - root.position.x, cue.face.z - root.position.z);
    heading.setFromAxisAngle(UP, yaw);

    const moving = walking ?? (!heldAtStart && (phase === 'outbound' || phase === 'inbound'));
    if (pivot) {
      const canPivot = dt > 0 && !moving && !seated && !cue?.gesture && travel < 0.015;
      if (!canPivot || (turn && turn.to.angleTo(heading) > 0.22)) turn = undefined;
      const angle = root.quaternion.angleTo(heading);
      if (canPivot && !turn && angle >= 0.66 && angle <= 1.85) {
        relativeHeading.copy(root.quaternion).invert().multiply(heading);
        turn = { from: root.quaternion.clone(), to: heading.clone(), elapsed: 0,
          right: relativeHeading.y * relativeHeading.w < 0 };
      }
      if (turn) {
        turn.elapsed += dt;
        const duration = pivot.getClip().duration;
        if (turn.elapsed >= duration) {
          root.quaternion.copy(turn.to);
          turn = undefined;
        } else {
          // Match the actor's heading to the baked foot changes, in either direction.
          const time = turn.right ? turn.elapsed : duration - turn.elapsed;
          const amount = THREE.MathUtils.smoothstep(time, 0.05, 1.11);
          root.quaternion.copy(turn.from).slerp(turn.to, turn.right ? amount : 1 - amount);
        }
      }
    }
    if (!turn) {
      if (dt > 0) root.quaternion.rotateTowards(heading, dt * 3.2);
      else root.quaternion.copy(heading);
    }

    if (seated) seatedPose ??= mixer.clipAction(benchIdle(idleClip!));
    const locomotion = jog && routeSpeed >= JOG_SPEED ? jog : walk;
    const next = seated && seatedPose ? seatedPose : turn && pivot ? pivot
      : moving && (!gait || dt > 0) ? locomotion : (cue?.gesture === 'wave' && wave) || idle;
    if ((dt > 0 || observed || gait) && next !== action) {
      next.reset().setEffectiveWeight(1).play();
      if (dt > 0) next.crossFadeFrom(action, 0.18, false);
      else action.stop();
      action = next;
    }
    const stepLength = next === jog && gait ? gait.jogStride : stride;
    if (gait && dt > 0 && next === locomotion) {
      const duration = locomotion.getClip().duration;
      if (journeyDistance !== undefined) {
        // Network progress is authoritative along a planned path, including across dropped frames.
        locomotion.time = (journeyDistance % stepLength) / stepLength * duration;
      } else if (travel < Math.min(stepLength, 2)) {
        locomotion.time = (locomotion.time + travel * duration / stepLength) % duration;
      }
    }
    if (pivot && turn) {
      pivot.time = turn.right ? turn.elapsed : pivot.getClip().duration - turn.elapsed;
    }
    const shouldNod = cue?.gesture === 'nod';
    if (shouldNod && !nodding) {
      nod ??= createNod(asset, mixer);
      nod?.reset().play();
    }
    nodding = shouldNod;
    const shouldWork = dt > 0 && cue?.gesture === 'install';
    if (shouldWork && !working) {
      installing ??= createInstallationPose(asset, mixer);
      installing.reset().setEffectiveWeight(1).fadeIn(0.18).play();
    }
    if (!shouldWork && working) {
      if (dt > 0) installing?.fadeOut(0.18);
      else installing?.stop();
    }
    working = shouldWork;
    asset.scene.position.y = standingY - (seated ? 0.24 : 0);
    mixer.update(dt);
  }

  updatePose(0);
  return {
    root,
    observe(dt: number, position: THREE.Vector3, face: THREE.Vector3, moving = false, gesture?: PatrolCue['gesture'], seated = false) {
      if (moving && !gait) walk.setEffectiveTimeScale(moveSpeed * walkClip.duration / stride);
      updatePose(dt, { face, gesture }, false, position, moving, seated);
    },
    observeJourney(dt: number, progress: number, duration: number) {
      distance = progress * length;
      const routeSpeed = length / duration;
      if (!gait) walk.setEffectiveTimeScale(routeSpeed * walkClip.duration / stride);
      updatePose(dt, undefined, false, undefined, progress < 1, false, routeSpeed, distance);
    },
    get phase() { return phase; },
    get progress() { return Math.round(100 * distance / length); },
    get metresRemaining() { return length - distance; },
    get dwelledSeconds() { return dwell; },
    plan(nextPoints: RoutePoint[], nextDestination: [number, number]) {
      ({ length, positionAt } = measuredRoute(nextPoints));
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
        distance = THREE.MathUtils.clamp(distance + direction * moveSpeed * dt, 0, length);
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
