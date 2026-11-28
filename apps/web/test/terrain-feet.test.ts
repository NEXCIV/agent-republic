import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { describe, expect, it } from 'vitest';
import { createCityGround } from '../src/app/nexciv-preview/city-ground';
import { createCafePaving } from '../src/app/nexciv-preview/cafe-corner';
import { createTerrainFeet, type ShoeContacts } from '../src/app/nexciv-preview/terrain-feet';
import { installServiceApron, serviceApronPose, type ApronPatch } from '../src/app/nexciv-preview/service-apron';

const contacts: ShoeContacts = [
  [[0, -0.04, -0.08], [0, -0.04, 0.16]],
  [[0, -0.04, -0.08], [0, -0.04, 0.16]],
];

function mockLegs() {
  const scene = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = 'Hips';
  hips.position.y = 0.665;
  scene.add(hips);
  for (const side of ['L', 'R']) {
    const thigh = new THREE.Bone();
    thigh.name = `Thigh${side}`;
    thigh.position.x = side === 'L' ? 0.1 : -0.1;
    const knee = new THREE.Bone();
    knee.name = `Shin${side}`;
    knee.position.set(0, -0.31, 0.047);
    const foot = new THREE.Bone();
    foot.name = `Foot${side}`;
    foot.position.set(0, -0.315, -0.047);
    hips.add(thigh);
    thigh.add(knee);
    knee.add(foot);
  }
  const left = scene.getObjectByName('FootL')!;
  return {
    scene, hips,
    leftSole: () => contacts[0].map((point) => left.localToWorld(new THREE.Vector3(...point))),
  };
}

async function geometryOnly(name: string) {
  const bytes = fs.readFileSync(new URL(`../public/nexciv-walk/${name}`, import.meta.url));
  const end = 20 + bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, end));
  // Ground registration only depends on the material names and triangles.
  gltf.materials = gltf.materials.map(({ name }: { name: string }) => ({ name }));
  delete gltf.textures;
  delete gltf.images;
  const json = Buffer.from(JSON.stringify(gltf));
  const padding = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
  const header = Buffer.from(bytes.subarray(0, 20));
  const binary = bytes.subarray(end);
  header.writeUInt32LE(json.length + padding.length, 12);
  header.writeUInt32LE(header.length + json.length + padding.length + binary.length, 8);
  const packed = new Uint8Array(Buffer.concat([header, json, padding, binary]));
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(packed.buffer, '');
}

describe('walkable city ground and foot placement', () => {
  it('samples the actual asphalt and raised pavement triangles on the plaza to market route', async () => {
    const surface = createCityGround();
    surface.add((await geometryOnly('nexus-market.glb')).scene);
    const paved = surface.height(8.45, 41.70, 0.18);
    const asphalt = surface.height(8.092, 42.033, 0);
    expect(paved).toBeGreaterThan(0.13);
    expect(asphalt).toBeLessThan(0.04);
    expect(surface.height(550, 550, 0)).toBeUndefined();
  });

  it('reads successive stair treads near the construction centre in the scene coordinates', async () => {
    const surface = createCityGround();
    surface.add((await geometryOnly('east-civic-district.glb')).scene);
    const stairs = [73.67, 74.02, 74.37, 74.72, 75.07, 75.42];
    const heights = stairs.map((z, index) => surface.height(95, z, 0.412 + index * 0.165));
    expect(heights[0]).toBeGreaterThan(0.35);
    for (let i = 1; i < heights.length; i += 1) {
      expect(heights[i]! - heights[i - 1]!).toBeCloseTo(0.165, 2);
    }
  });

  it('uses the cafe tile surface and rejects the coarse plane beneath its patio', async () => {
    const surface = createCityGround();
    surface.add((await geometryOnly('nexus-market.glb')).scene);
    expect(surface.height(12.6, 72.18, 0.184)).toBeUndefined();
    surface.add(createCafePaving());
    expect(surface.height(12.6, 72.18, 0.184)).toBeCloseTo(0.184, 3);
  });

  it('rotates a supporting shoe to the plane of a ramp and restores the animated pose', () => {
    const { scene, hips, leftSole } = mockLegs();
    const ramp = (_x: number, z: number) => 0.10 + z * 0.25;
    const feet = createTerrainFeet(scene, contacts, ramp)!;
    feet.apply(0);
    for (const point of leftSole()) expect(point.y).toBeCloseTo(ramp(point.x, point.z), 2);
    feet.restore();
    expect(hips.position.y).toBe(0.665);
    expect(leftSole()[0]!.y).toBeCloseTo(0);
  });

  it('keeps a foot above the upper stair edge without pitching across the riser', () => {
    const { scene, leftSole } = mockLegs();
    const feet = createTerrainFeet(scene, contacts, (_x, z) => z >= 0 ? 0.165 : 0)!;
    feet.apply(0);
    const [heel, toe] = leftSole();
    expect(toe!.y).toBeCloseTo(0.165, 2);
    expect(heel!.y).toBeCloseTo(toe!.y, 3);
  });

  it('drives only the selected apron panel with independent weights on the service model', async () => {
    const { scene } = await geometryOnly('agent-06.glb');
    const data = JSON.parse(fs.readFileSync(new URL('../public/nexciv-motion/agent-06-city-v1.json', import.meta.url), 'utf8'));
    const patch: ApronPatch = data.apron;
    const mesh = scene.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    const originalPositions = mesh.geometry.getAttribute('position');
    const thighWeight = mesh.geometry.getAttribute('skinWeight').getX(0);
    installServiceApron(scene, patch);
    expect(mesh.geometry.getAttribute('position')).toBe(originalPositions);
    expect(mesh.geometry.getAttribute('skinWeight').getX(0)).toBe(thighWeight);
    expect(mesh.skeleton.bones.length).toBe(patch.jointCount + 2);
    const pose = serviceApronPose(scene)!;
    const hem = scene.getObjectByName('ServiceApronL')!;
    pose();
    expect(Math.abs(hem.rotation.x)).toBeLessThan(0.15);
    const jog = THREE.AnimationClip.parse({ ...data.clips.find((entry: { name: string }) =>
      entry.name === 'Quaternius_JogLoop'), uuid: THREE.MathUtils.generateUUID() });
    const mixer = new THREE.AnimationMixer(scene);
    mixer.clipAction(jog).play();
    const poses: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      mixer.setTime(i * jog.duration / 30);
      pose();
      poses.push(hem.rotation.x);
    }
    expect(Math.min(...poses)).toBeLessThan(-0.25);
    expect(Math.max(...poses) - Math.min(...poses)).toBeGreaterThan(0.15);
    expect(Math.min(...poses)).toBeGreaterThan(-0.72);
  });
});
