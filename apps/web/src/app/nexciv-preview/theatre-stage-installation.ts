import * as THREE from 'three';
import { THEATRE_STAGE } from '../../lib/theatre-layout';
import { THEATRE_CUES } from '../../lib/theatre-programme';

const GOLD = new THREE.Color('#f5bf59');
const PEARL = new THREE.Color('#ffe7b5');
const WATER = new THREE.Color('#71d5cd');
const OFF = new THREE.Color('#6b5f50');

export function createStageInstallation() {
  const group = new THREE.Group();
  group.name = 'NEXCIV stage installation – City of Lights';
  group.position.set(...THEATRE_STAGE);
  const graphite = new THREE.MeshStandardMaterial({ color: '#282c30', metalness: 0.27, roughness: 0.53 });
  const brass = new THREE.MeshStandardMaterial({ color: '#ad7633', metalness: 0.59, roughness: 0.43 });
  const trim = new THREE.MeshStandardMaterial({
    color: '#b8a07e', roughness: 0.46, metalness: 0.42, emissive: GOLD, emissiveIntensity: 0,
  });

  function cylinder(radius: number, height: number, y: number, material: THREE.Material, segments = 60) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material);
    mesh.position.y = y;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  function ring(radius: number, width: number, y: number, material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(radius, radius + width, 80), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  cylinder(3.78, 0.10, 0.057, graphite);
  ring(3.59, 0.04, 0.109, brass);
  ring(2.51, 0.028, 0.11, trim);
  ring(1.49, 0.075, 0.111, brass);
  cylinder(1.04, 0.14, 0.175, graphite, 12);
  cylinder(0.92, 0.055, 0.274, brass, 12);
  cylinder(0.80, 0.21, 0.402, graphite, 12);
  cylinder(0.27, 0.50, 0.691, brass, 8);

  const reflector = new THREE.Group();
  reflector.position.y = 1.43;
  group.add(reflector);
  const crystalMaterial = new THREE.MeshStandardMaterial({
    color: '#e3b267', metalness: 0.33, roughness: 0.34, emissive: GOLD, emissiveIntensity: 0.15, flatShading: true,
  });
  const crystal = new THREE.Mesh(new THREE.IcosahedronGeometry(0.63, 0), crystalMaterial);
  crystal.rotation.z = 0.16;
  reflector.add(crystal);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.80, 0.022, 6, 52), brass);
  collar.rotation.set(Math.PI / 2 + 0.28, 0, -0.20);
  reflector.add(collar);
  const secondCollar = new THREE.Mesh(new THREE.TorusGeometry(0.90, 0.015, 6, 52), trim);
  secondCollar.rotation.set(Math.PI / 2 - 0.32, 0.14, 0.38);
  reflector.add(secondCollar);

  const columns = Array.from({ length: 24 }, (_, index) => {
    const outer = index < 16;
    const angle = outer ? index * Math.PI / 8 : (index - 16) * Math.PI / 4 + Math.PI / 16;
    const radius = outer ? 3.14 : 1.97;
    const height = outer ? 0.29 + (index % 4) * 0.07 : 0.40 + (index % 4) * 0.14;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, height, angle, outer };
  });
  const mounts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.145, 0.19, 1, 8), brass, columns.length);
  const lenses = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.075, 0.094, 1, 8), new THREE.MeshBasicMaterial(), columns.length);
  const post = new THREE.Object3D();
  columns.forEach(({ x, z, height }, index) => {
    post.position.set(x, 0.17, z);
    post.scale.set(1, 0.12, 1);
    post.updateMatrix();
    mounts.setMatrixAt(index, post.matrix);
    post.position.y = 0.23 + height / 2;
    post.scale.y = height;
    post.updateMatrix();
    lenses.setMatrixAt(index, post.matrix);
    lenses.setColorAt(index, OFF);
  });
  mounts.instanceMatrix.needsUpdate = true;
  lenses.instanceMatrix.needsUpdate = true;
  group.add(mounts, lenses);

  const glow = new THREE.PointLight('#f5bf59', 0, 9, 2);
  glow.position.y = 1.7;
  group.add(glow);
  const scratch = new THREE.Color();
  let lastFrame = Number.NaN;
  function update(elapsed: number, animated: boolean) {
    const cue = THEATRE_CUES.find(({ start, end }) => elapsed >= start && elapsed < end);
    const seconds = cue ? animated ? (elapsed - cue.start) / 1000 : (cue.end - cue.start) * 0.0006 : 0;
    const sample = cue ? cue.start + seconds * 1000 : -1;
    if (sample === lastFrame) return;
    lastFrame = sample;
    const water = cue?.id === 'water';
    const finale = cue?.id === 'finale';
    const easeOut = 1 - Math.pow(1 - Math.min(1, seconds / 2), 3);
    const endFade = cue ? THREE.MathUtils.smoothstep((cue.end - sample) / 1000, 0, 1.4) : 1;
    const intensity = cue ? easeOut * endFade : 0;
    glow.color.copy(water ? WATER : GOLD);
    glow.intensity = intensity * (water ? 21 : 33);
    trim.emissive.copy(water ? WATER : GOLD);
    trim.emissiveIntensity = intensity * (finale ? 1.4 : 0.64);
    crystalMaterial.emissive.copy(water ? WATER : GOLD);
    crystalMaterial.emissiveIntensity = 0.12 + intensity * (water ? 0.78 : 1.35);
    reflector.rotation.y = animated ? Math.max(0, Math.min(elapsed, 47000)) * 0.00012 : 0.26;
    columns.forEach(({ outer, angle }, index) => {
      const sweep = THREE.MathUtils.smoothstep(seconds / 6.5 - angle / (2 * Math.PI), -0.06, 0.13);
      const rhythm = 0.63 + 0.31 * Math.sin(seconds * 0.85 - angle * 2);
      const level = !cue ? 0 : water ? rhythm * intensity : finale ? intensity : sweep * intensity;
      scratch.copy(OFF).lerp(water && !outer ? WATER : finale ? PEARL : GOLD, level);
      scratch.multiplyScalar(1 + level * (water ? 0.40 : 0.75));
      lenses.setColorAt(index, scratch);
    });
    if (lenses.instanceColor) lenses.instanceColor.needsUpdate = true;
  }
  update(-1, false);
  return { group, update };
}
