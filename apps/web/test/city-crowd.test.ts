import fs from 'node:fs';
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { createCityCrowd, type PedestrianPath } from '../src/app/nexciv-preview/city-crowd';

const visible = () => true;
const path: PedestrianPath = {
  id: 'test', model: '04', speed: 1, start: 0, pause: 2, reverse: false,
  points: [[0, 0.18, 0], [1, 0, 0], [2, 0, 0], [3, 0.18, 0]],
};

function setup() {
  const scene = new THREE.Group();
  const rig = new THREE.Group();
  rig.userData.walk_stride_m = 1;
  scene.add(rig);
  const asset = { scene, animations: ['Idle', 'Walk'].map(name => new THREE.AnimationClip(name, 1, [])) } as GLTF;
  const crowd = createCityCrowd();
  crowd.add(asset, path);
  return { crowd, pedestrian: crowd.group.children[0]!, asset };
}

describe('city pedestrians', () => {
  it('uses short walking paths with pavement at the pause points', () => {
    const file = new URL('../public/nexciv-walk/npc-paths.json', import.meta.url);
    const paths: PedestrianPath[] = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(new Set(paths.map(p => p.id)).size).toBe(14);
    for (const { points } of paths) {
      expect(points[0]![1]).toBeGreaterThan(0.1);
      expect(points.at(-1)![1]).toBeGreaterThan(0.1);
    }
  });

  it('pauses at the end of the sidewalk, then turns back without resetting position', () => {
    const { crowd, pedestrian } = setup();
    crowd.update(4, [], visible);
    expect(pedestrian.position.x).toBe(3);
    crowd.update(1.8, [], visible);
    expect(pedestrian.position.x).toBe(3);
    crowd.update(0.2, [], visible);
    crowd.update(0.2, [], visible);
    expect(pedestrian.position.x).toBeCloseTo(2.8, 1);
    crowd.dispose();
  });

  it('waits to step into an occupied crossing, resumes, and freezes in a paused scene', () => {
    const { crowd, pedestrian } = setup();
    crowd.update(0.4, [], visible);
    const before = pedestrian.position.clone();
    crowd.update(0.25, [], visible, () => true);
    expect(pedestrian.position.equals(before)).toBe(true);
    crowd.update(0.25, [], visible, () => false);
    expect(pedestrian.position.x).toBeGreaterThan(before.x);
    const paused = pedestrian.position.clone();
    crowd.update(0, [], visible);
    expect(pedestrian.position.equals(paused)).toBe(true);
    crowd.update(0, [], () => false);
    expect(pedestrian.visible).toBe(false);
    crowd.dispose();
  });

  it('keeps space ahead of a playable resident and leaves the shared model available for other pedestrians', () => {
    const { crowd, pedestrian, asset } = setup();
    const resident = new THREE.Vector3(0.55, 0.18, 0);
    crowd.update(0.1, [resident], visible);
    expect(pedestrian.position.x).toBe(0);
    crowd.update(0.1, [], visible);
    expect(pedestrian.position.x).toBeGreaterThan(0);
    expect(crowd.group.getObjectById(asset.scene.id)).toBeUndefined();
    crowd.dispose();
  });
});
