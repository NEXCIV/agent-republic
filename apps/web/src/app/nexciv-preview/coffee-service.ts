import * as THREE from 'three';
import type { SharedPilotResidentId } from '@agent-republic/domain';
import { CAFE_COUNTER, CAFE_HOST } from '../../lib/cafe-geometry';
import { COFFEE_CARRY_MS, COFFEE_HANDOFF_MS, COFFEE_RELEASE_MS, type CafeOrders } from '../../lib/shared-pilot-cafe';

type Order = ReturnType<CafeOrders['view']>['orders'][number];
type Resident = SharedPilotResidentId;
type Arm = NonNullable<ReturnType<typeof rigArm>>;
type Guest = { file: string; patrol: { root: THREE.Object3D } };
const { clamp, smoothstep } = THREE.MathUtils;
const vendorHome = new THREE.Vector3(...CAFE_HOST);
const vendorCounter = new THREE.Vector3(11.83, CAFE_COUNTER[1], 72.22);
const handoff = new THREE.Vector3(12.23, CAFE_COUNTER[1] + 1.045, 72.23);
const cupRim = 0.058;
const cupTop = 0.074;
const up = new THREE.Vector3(0, 1, 0);
const pitch = new THREE.Vector3(1, 0, 0);
// Lip height and depth from the Head bone, measured on the shipped models.
const lip: Partial<Record<string, [number, number]>> = {
  'agent-01.glb': [0.083, 0.155], 'agent-02.glb': [0.027, 0.160],
  'agent-03.glb': [0.026, 0.156], 'agent-04.glb': [0.067, 0.127],
  'agent-05.glb': [0.067, 0.150], 'agent-06.glb': [0.050, 0.125],
  'agent-07.glb': [0.038, 0.185], 'agent-08.glb': [0.075, 0.119],
};

export function coffeeVendorPose(order: Order | undefined, now: number, position: THREE.Vector3, reduced: boolean) {
  position.copy(vendorHome);
  if (order?.counterAt == null || order.readyAt == null) return false;
  const stepIn = clamp((now - order.counterAt) / 950, 0, 1);
  const stepOut = clamp((now - order.readyAt - COFFEE_RELEASE_MS) / 950, 0, 1);
  position.lerp(vendorCounter, stepIn * (1 - stepOut));
  return !reduced && ((stepIn > 0 && stepIn < 1) || (stepOut > 0 && stepOut < 1));
}

function rigArm(actor: THREE.Object3D) {
  const shoulder = actor.getObjectByName('UpperArmR');
  const elbow = actor.getObjectByName('ForearmR');
  const hand = actor.getObjectByName('HandR');
  const head = actor.getObjectByName('Head');
  if (!shoulder?.parent || !elbow?.parent || !hand?.parent || !head) return;
  return { actor, shoulder, elbow, hand, head, bones: [shoulder, elbow, hand],
    pose: [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()] };
}

export function createCoffeeService() {
  const group = new THREE.Group();
  group.name = 'Coffee cups and handoff';
  const paper = new THREE.MeshStandardMaterial({ color: '#f3ddae', roughness: 0.75 });
  const band = new THREE.MeshStandardMaterial({ color: '#8b5b32', roughness: 0.87 });
  const cork = new THREE.MeshStandardMaterial({ color: '#30251f', roughness: 0.63 });
  const body = new THREE.CylinderGeometry(0.054, 0.042, 0.132, 20);
  const lid = new THREE.CylinderGeometry(cupRim, 0.055, 0.017, 20);
  const sleeve = new THREE.CylinderGeometry(0.0515, 0.0468, 0.061, 20);
  const cups = Object.fromEntries((['01', '02'] as const).map((id) => {
    const cup = new THREE.Group();
    cup.name = `Coffee cup ${id}`;
    const top = new THREE.Mesh(lid, cork);
    const wrap = new THREE.Mesh(sleeve, band);
    top.position.y = cupTop - 0.0085;
    wrap.position.y = -0.012;
    cup.add(new THREE.Mesh(body, paper), wrap, top);
    cup.visible = false;
    group.add(cup);
    return [id, cup];
  })) as Record<Resident, THREE.Group>;
  const rigs = new WeakMap<THREE.Object3D, Arm | undefined>();
  const posed = new Set<Arm>();
  const center = new THREE.Vector3();
  const carry = new THREE.Vector3();
  const shoulder = new THREE.Vector3();
  const wrist = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const elbow = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const inward = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const local = new THREE.Quaternion();
  const delta = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  const basis = new THREE.Matrix4();

  function getArm(actor: THREE.Object3D | undefined) {
    if (!actor) return;
    if (!rigs.has(actor)) rigs.set(actor, rigArm(actor));
    return rigs.get(actor);
  }

  function carryPoint(arm: Arm, target: THREE.Vector3) {
    arm.shoulder.getWorldPosition(target);
    return target.add(scratch.set(0.035, -0.255, 0.259).applyQuaternion(arm.actor.quaternion));
  }

  function setRotation(bone: THREE.Object3D, world: THREE.Quaternion, weight: number) {
    bone.parent!.getWorldQuaternion(local).invert().multiply(world);
    bone.quaternion.slerp(local, weight);
  }

  function grip(arm: Arm, cup: THREE.Vector3, tip: THREE.Quaternion, weight: number) {
    if (weight <= 0) return;
    if (!posed.has(arm)) {
      arm.bones.forEach((bone, index) => arm.pose[index]!.copy(bone.quaternion));
      posed.add(arm);
    }
    const yaw = arm.actor.quaternion;
    arm.shoulder.getWorldPosition(shoulder);
    const upper = arm.elbow.position.length();
    const lower = arm.hand.position.length();
    scratch.set(-0.073, -0.011, -0.055).applyQuaternion(tip).applyQuaternion(yaw);
    wrist.copy(cup).add(scratch);
    axis.subVectors(wrist, shoulder);
    const reach = clamp(axis.length(), Math.abs(upper - lower) + 0.003, upper + lower - 0.004);
    axis.normalize();
    wrist.copy(shoulder).addScaledVector(axis, reach);
    pole.set(-0.62, -1, -0.22).applyQuaternion(yaw);
    pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    const along = (upper * upper - lower * lower + reach * reach) / (2 * reach);
    elbow.copy(shoulder).addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, upper * upper - along * along)));
    for (const [bone, from, to] of [[arm.shoulder, shoulder, elbow], [arm.elbow, elbow, wrist]] as const) {
      bone.getWorldQuaternion(rotation);
      scratch.copy(up).applyQuaternion(rotation);
      forward.subVectors(to, from).normalize();
      setRotation(bone, delta.setFromUnitVectors(scratch, forward).multiply(rotation), weight);
    }
    forward.set(0.13, 0.18, 1).applyQuaternion(tip).applyQuaternion(yaw).normalize();
    inward.set(1, 0, 0).applyQuaternion(yaw);
    inward.addScaledVector(forward, -inward.dot(forward)).normalize();
    normal.crossVectors(inward, forward);
    setRotation(arm.hand, rotation.setFromRotationMatrix(basis.makeBasis(inward, forward, normal)), weight);
  }

  function pose(id: Resident, order: Order | undefined, character: Guest, vendor: THREE.Object3D | undefined,
    now: number, reduced: boolean) {
    const actor = character.patrol.root;
    const cup = cups[id];
    cup.visible = false;
    if (order?.readyAt == null || order.finishedAt == null || !actor.visible ||
      now < order.readyAt - COFFEE_HANDOFF_MS || now >= Math.max(order.finishedAt + COFFEE_CARRY_MS, order.sip?.endsAt ?? 0)) return;
    const guest = getArm(actor);
    if (!guest) return;
    const server = getArm(vendor);
    const since = now - order.readyAt;
    const receive = smoothstep(since, -COFFEE_HANDOFF_MS, 0);
    const lower = smoothstep(since, 0, COFFEE_RELEASE_MS);
    tilt.identity();
    carryPoint(guest, carry);
    if (since < 0) {
      if (server) carryPoint(server, center);
      else center.copy(handoff);
      center.lerp(handoff, reduced ? 1 : receive);
    } else {
      center.copy(handoff).lerp(carry, reduced ? 1 : lower);
    }
    if (order.sip && now >= order.sip.startedAt && now < order.sip.endsAt && !reduced) {
      const progress = (now - order.sip.startedAt) / (order.sip.endsAt - order.sip.startedAt);
      const lift = smoothstep(progress, 0, 0.34) * (1 - smoothstep(progress, 0.67, 1));
      tilt.setFromAxisAngle(pitch, -0.36 * lift);
      const [height, depth] = lip[character.file] ?? lip['agent-01.glb']!;
      guest.head.localToWorld(scratch.set(0, height, depth + 0.003));
      scratch.sub(pole.set(0, cupTop, -cupRim).applyQuaternion(tilt).applyQuaternion(actor.quaternion));
      center.lerp(scratch, lift);
    }
    if (server && since < COFFEE_RELEASE_MS) grip(server, center, tilt, 1 - lower);
    grip(guest, center, tilt, since < 0 ? smoothstep(receive, 0.28, 0.94) : 1);
    cup.position.copy(center);
    cup.quaternion.copy(actor.quaternion).multiply(tilt);
    cup.visible = true;
  }

  return {
    group,
    pose,
    reset() {
      for (const arm of posed) arm.bones.forEach((bone, index) => bone.quaternion.copy(arm.pose[index]!));
      posed.clear();
      cups['01'].visible = cups['02'].visible = false;
    },
    dispose() {
      body.dispose(); lid.dispose(); sleeve.dispose();
      paper.dispose(); band.dispose(); cork.dispose();
    },
  };
}
