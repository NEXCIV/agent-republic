import fs from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createAgentPatrol } from '../src/app/nexciv-preview/agent';
import { cityGaitLoader, matchCityGait, type CityAgentAsset, type CityGait } from '../src/app/nexciv-preview/city-gait';
import { SHARED_AVATARS } from '../src/lib/shared-pilot-profiles';

function setup(gait?: CityGait) {
  const scene = new THREE.Group();
  const rig = new THREE.Group();
  rig.userData.walk_stride_m = 1;
  const hips = new THREE.Object3D();
  hips.name = 'Hips';
  rig.add(hips);
  scene.add(rig);
  const animations = [constantPose('Idle', 0), constantPose('Walk', 0.3)];
  const asset = { scene, animations, gait } as CityAgentAsset;
  const patrol = createAgentPatrol(asset, [[0, 0, 0], [0, 0, 3], [3, 0, 3]], [3, 3]);
  return { patrol, hips };
}

function constantPose(name: string, height: number) {
  return new THREE.AnimationClip(name, 1,
    [new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, height, 0, 0, height, 0])]);
}

function gaitFixture(): CityGait {
  return {
    walk: new THREE.AnimationClip('Quaternius_WalkLoop', 1, [
      new THREE.VectorKeyframeTrack('Hips.position', [0, 0.5, 1], [0, 0, 0, 0, 1, 0, 0, 0, 0]),
    ]),
    jog: constantPose('Quaternius_JogLoop', 0.7),
    pivot: constantPose('Quaternius_Pivot', 0.5),
    stride: 1,
    jogStride: 3,
    modelHash: '',
  };
}

describe('Quaternius city locomotion', () => {
  it('samples the gait by distance around a corner and blends back to idle at arrival', () => {
    const { patrol, hips } = setup(gaitFixture());
    patrol.observeJourney(0.2, 1 / 12, 5);
    patrol.observeJourney(0.2, 1 / 12, 5);
    expect(hips.position.y).toBeCloseTo(1);
    patrol.observeJourney(0.05, 0.5, 5);
    expect(patrol.root.position.toArray()).toEqual([0, 0, 3]);
    expect(hips.position.y).toBeCloseTo(0);
    patrol.observeJourney(0.05, 0.51, 5);
    expect(patrol.root.position.toArray()).toEqual([expect.closeTo(0.06), 0, 3]);
    expect(hips.position.y).toBeCloseTo(0.12);
    patrol.observeJourney(0.2, 1, 5);
    patrol.observeJourney(0.2, 1, 5);
    expect(hips.position.y).toBeCloseTo(0);
    patrol.dispose();
  });

  it.each([-1, 1])('steps into a stationary quarter turn facing x = %s', (direction) => {
    const { patrol, hips } = setup(gaitFixture());
    const origin = new THREE.Vector3();
    const face = new THREE.Vector3(direction, 0, 0);
    patrol.observe(0.25, origin, face);
    patrol.observe(0.25, origin, face);
    expect(hips.position.y).toBeCloseTo(0.5);
    expect(patrol.root.position.toArray()).toEqual([0, 0, 0]);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(patrol.root.quaternion).z).toBeGreaterThan(0);
    patrol.observe(0.6, origin, face);
    patrol.observe(0.25, origin, face);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(patrol.root.quaternion).x).toBeCloseTo(direction);
    expect(hips.position.y).toBeCloseTo(0);
    patrol.dispose();
  });

  it('uses the bundled legacy walk without an optional gait', () => {
    const { patrol, hips } = setup();
    patrol.advance(0.2);
    patrol.advance(0.2);
    expect(hips.position.y).toBeCloseTo(0.3);
    patrol.dispose();
  });

  it('uses the Quaternius jog instead of speeding up the walk on a fast shared route', () => {
    const { patrol, hips } = setup(gaitFixture());
    patrol.observeJourney(0.2, 0.1, 1.5);
    patrol.observeJourney(0.2, 0.2, 1.5);
    expect(hips.position.y).toBeCloseTo(0.7);
    patrol.dispose();
  });

  it.each(Object.values(SHARED_AVATARS))('loads the matching model and loopable clips for $asset', async ({ asset }) => {
    const id = asset.slice(6, 8);
    const data = fs.readFileSync(new URL(`../public/nexciv-motion/agent-${id}-city-v1.json`, import.meta.url), 'utf8');
    const fetch = vi.fn(async () => new Response(data));
    vi.stubGlobal('fetch', fetch);
    try {
      const load = cityGaitLoader(new AbortController().signal);
      expect(load('npc-04.glb', 'auto')).toBeUndefined();
      const gait = await load(asset, 'auto');
      expect(await load(asset, 'low')).toBe(gait);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(`/nexciv-motion/agent-${id}-city-v1.json`, expect.any(Object));
      expect(gait?.pivot.duration).toBeCloseTo(1.25);
      expect(gait?.walk.duration).toBeCloseTo(0.78);
      expect(gait?.jog.duration).toBeCloseTo(0.93333);
      expect(gait?.jogStride).toBeGreaterThan(3.5);
      expect(gait?.shoeContacts).toHaveLength(2);
      const bytes = new Uint8Array(fs.readFileSync(new URL(`../public/nexciv-walk/${asset}`, import.meta.url)));
      expect(await matchCityGait(gait, bytes.buffer)).toBe(gait);
      expect(await matchCityGait(gait, new ArrayBuffer(4))).toBeUndefined();
      for (const track of [...gait!.walk.tracks, ...gait!.jog.tracks]) {
        expect(track.name).not.toMatch(/^Root\./);
        const size = track.getValueSize();
        const start = track.values.slice(0, size);
        const end = track.values.slice(-size);
        if (size === 4) {
          expect(Math.abs(new THREE.Quaternion().fromArray(start).dot(new THREE.Quaternion().fromArray(end)))).toBeCloseTo(1, 4);
        } else {
          expect(start).toEqual(end);
        }
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
