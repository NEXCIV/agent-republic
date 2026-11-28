import * as THREE from 'three';
import type { GroundHeight } from './city-ground';

type Point = [number, number, number];
export type ShoeContacts = [[Point, Point], [Point, Point]];
const { clamp, lerp, smoothstep } = THREE.MathUtils;

function localRotation(bone: THREE.Object3D, world: THREE.Quaternion, scratch: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(scratch).invert();
  bone.quaternion.copy(scratch.multiply(world)).normalize();
}

export function createTerrainFeet(scene: THREE.Object3D, contacts: ShoeContacts | undefined, height?: GroundHeight) {
  if (!height || contacts?.length !== 2 ||
    contacts.some((foot) => foot.length !== 2 || foot.some((p) => p.length !== 3 || !p.every(Number.isFinite)))) return;
  const hips = scene.getObjectByName('Hips');
  const legs = ['L', 'R'].map((side, index) => {
    const thigh = scene.getObjectByName(`Thigh${side}`);
    const knee = scene.getObjectByName(`Shin${side}`);
    const foot = scene.getObjectByName(`Foot${side}`);
    if (!thigh || !knee || !foot || !thigh.parent || !knee.parent || !foot.parent) return undefined;
    const thighLength = knee.position.length();
    const shinLength = foot.position.length();
    if (Math.min(thighLength, shinLength) <= 0.01) return undefined;
    return {
      thigh, knee, foot, thighLength, shinLength,
      thighAxis: knee.position.clone().normalize(),
      shinAxis: foot.position.clone().normalize(),
      anchors: contacts[index]!.map((point) => new THREE.Vector3(...point)),
      saved: [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()],
      ankle: new THREE.Vector3(),
      target: new THREE.Vector3(),
      orientation: new THREE.Quaternion(),
      active: false,
    };
  });
  if (!hips || !hips.parent || legs.some((leg) => !leg)) return;
  const feet = legs as NonNullable<typeof legs[number]>[];
  const hipLocal = new THREE.Vector3();
  const start = new THREE.Vector3();
  const kneeWorld = new THREE.Vector3();
  const line = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const scratch2 = new THREE.Vector3();
  const world = new THREE.Quaternion();
  const inverse = new THREE.Quaternion();
  const delta = new THREE.Quaternion();
  const heel = new THREE.Vector3();
  const toe = new THREE.Vector3();
  let adjusted = false;

  function prepare(leg: typeof feet[number], floor: number) {
    leg.active = false;
    leg.foot.getWorldPosition(leg.ankle);
    leg.target.copy(leg.ankle);
    leg.foot.getWorldQuaternion(leg.orientation);
    heel.copy(leg.anchors[0]!).applyQuaternion(leg.orientation).add(leg.ankle);
    toe.copy(leg.anchors[1]!).applyQuaternion(leg.orientation).add(leg.ankle);
    const back = height!(heel.x, heel.z, floor);
    const front = height!(toe.x, toe.z, floor);
    if (back === undefined && front === undefined) return;
    const backGround = back ?? front!;
    const frontGround = front ?? back!;
    const groundDelta = frontGround - backGround;
    if (Math.max(Math.abs(backGround - floor), Math.abs(frontGround - floor)) < 0.012) return;
    const plant = 1 - smoothstep(Math.min(heel.y, toe.y) - floor, 0.021, 0.078);
    if (plant > 0 && back !== undefined && front !== undefined && Math.abs(groundDelta) < 0.086) {
      scratch.subVectors(toe, heel).normalize();
      scratch2.set(toe.x - heel.x, groundDelta, toe.z - heel.z).normalize();
      delta.identity().slerp(world.setFromUnitVectors(scratch, scratch2), plant);
      leg.orientation.premultiply(delta);
      heel.copy(leg.anchors[0]!).applyQuaternion(leg.orientation).add(leg.ankle);
      toe.copy(leg.anchors[1]!).applyQuaternion(leg.orientation).add(leg.ankle);
    }
    const penetration = Math.max(backGround - heel.y, frontGround - toe.y);
    const rise = Math.max(0, Math.max(frontGround, backGround) - floor) * 0.78;
    const correction = clamp(lerp(Math.max(penetration, rise), penetration, plant), -0.22, 0.23);
    leg.target.copy(leg.ankle).setY(leg.ankle.y + correction);
    leg.active = Math.abs(correction) > 0.003 || leg.foot.getWorldQuaternion(world).angleTo(leg.orientation) > 0.007;
  }

  function solve(leg: typeof feet[number]) {
    leg.thigh.getWorldPosition(start);
    leg.knee.getWorldPosition(kneeWorld);
    line.subVectors(leg.target, start);
    const sum = leg.thighLength + leg.shinLength;
    const reach = clamp(line.length(), Math.abs(leg.thighLength - leg.shinLength) + 0.001, sum - 0.001);
    line.normalize();
    // Preserve the knee bend plane from the underlying animation.
    bend.subVectors(kneeWorld, start);
    bend.addScaledVector(line, -bend.dot(line));
    if (bend.lengthSq() < 0.00001) {
      leg.thigh.parent!.getWorldQuaternion(world);
      bend.set(0, 0, 1).applyQuaternion(world);
      bend.addScaledVector(line, -bend.dot(line));
    }
    bend.normalize();
    const along = (leg.thighLength ** 2 - leg.shinLength ** 2 + reach ** 2) / (2 * reach);
    kneeWorld.copy(start).addScaledVector(line, along)
      .addScaledVector(bend, Math.sqrt(Math.max(0, leg.thighLength ** 2 - along ** 2)));
    leg.thigh.getWorldQuaternion(world);
    scratch.copy(leg.thighAxis).applyQuaternion(world);
    scratch2.subVectors(kneeWorld, start).normalize();
    localRotation(leg.thigh, delta.setFromUnitVectors(scratch, scratch2).multiply(world), inverse);
    leg.knee.getWorldQuaternion(world);
    scratch.copy(leg.shinAxis).applyQuaternion(world);
    scratch2.copy(start).addScaledVector(line, reach).sub(kneeWorld).normalize();
    localRotation(leg.knee, delta.setFromUnitVectors(scratch, scratch2).multiply(world), inverse);
    localRotation(leg.foot, leg.orientation, inverse);
  }

  return {
    restore() {
      if (!adjusted) return;
      hips.position.copy(hipLocal);
      for (const { thigh, knee, foot, saved } of feet) {
        thigh.quaternion.copy(saved[0]!);
        knee.quaternion.copy(saved[1]!);
        foot.quaternion.copy(saved[2]!);
      }
      adjusted = false;
    },
    apply(floor: number) {
      for (const foot of feet) prepare(foot, floor);
      if (!feet.some((leg) => leg.active)) return;
      hipLocal.copy(hips.position);
      let pelvisDrop = 0;
      for (const leg of feet) {
        leg.saved[0]!.copy(leg.thigh.quaternion);
        leg.saved[1]!.copy(leg.knee.quaternion);
        leg.saved[2]!.copy(leg.foot.quaternion);
        leg.thigh.getWorldPosition(start);
        scratch.subVectors(start, leg.target);
        const reach = leg.thighLength + leg.shinLength - 0.005;
        const vertical = Math.sqrt(Math.max(0, reach ** 2 - scratch.x ** 2 - scratch.z ** 2));
        if (leg.active) pelvisDrop = Math.max(pelvisDrop, scratch.y - vertical);
      }
      if (pelvisDrop > 0.001) {
        hips.getWorldPosition(scratch);
        scratch.y -= Math.min(pelvisDrop, 0.13);
        hips.position.copy(hips.parent!.worldToLocal(scratch));
      }
      for (const leg of feet) if (leg.active || pelvisDrop > 0.001) solve(leg);
      adjusted = true;
    },
  };
}
