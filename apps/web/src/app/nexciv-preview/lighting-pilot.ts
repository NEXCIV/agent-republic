import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { CityPoint } from '../../lib/cafe-geometry';

export function createPilotLamp(position: CityPoint) {
  const group = new THREE.Group();
  group.name = 'NEXCIV_Lakeshore_Pilot_Lamp';
  group.position.set(...position);
  const graphite = new THREE.MeshStandardMaterial({ color: '#24292e', metalness: 0.38, roughness: 0.47 });
  const trim = new THREE.MeshStandardMaterial({ color: '#f0b90b', metalness: 0.26, roughness: 0.36 });
  const lens = new THREE.MeshStandardMaterial({
    color: '#ffe6b5', emissive: '#ffbc57', emissiveIntensity: 2.8, roughness: 0.29,
  });
  const parts = [
    { size: [0.37, 0.065, 0.28], bottom: 0, material: graphite },
    { size: [0.21, 0.8, 0.17], bottom: 0.05, material: graphite },
    { size: [0.27, 0.025, 0.23], bottom: 0.85, material: trim },
    { size: [0.23, 0.092, 0.19], bottom: 0.875, material: lens },
    { size: [0.29, 0.079, 0.25], bottom: 0.967, material: graphite },
  ] as const;
  for (const { size: [width, height, depth], bottom, material } of parts) {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 1, 0.013), material);
    mesh.position.y = bottom + height / 2;
    mesh.receiveShadow = true;
    mesh.castShadow = material === graphite;
    group.add(mesh);
  }
  const light = new THREE.PointLight('#ffbc66', 22, 4.5, 2);
  light.position.set(0, 0.91, 0.21);
  group.add(light);
  return group;
}

export function createInstallationKit([x, y, z]: CityPoint) {
  const group = new THREE.Group();
  group.name = 'NEXCIV_Lakeshore_Installation_Kit';
  group.position.set(x - 0.5, y, z - 0.34);
  const shell = new THREE.MeshStandardMaterial({ color: '#34373b', metalness: 0.28, roughness: 0.48 });
  const yellow = new THREE.MeshStandardMaterial({ color: '#f0b90b', roughness: 0.51 });
  for (const [width, height, depth, elevation, material] of [
    [0.39, 0.19, 0.28, 0.10, shell],
    [0.40, 0.04, 0.29, 0.208, yellow],
    [0.14, 0.038, 0.045, 0.247, shell],
  ] as const) {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 1, 0.012), material);
    mesh.position.y = elevation;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
