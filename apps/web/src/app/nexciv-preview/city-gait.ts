import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { ApronPatch } from './service-apron';
import type { ShoeContacts } from './terrain-feet';
import type { GroundHeight } from './city-ground';

type BenchMotion = { enter: THREE.AnimationClip; rest: THREE.AnimationClip; exit: THREE.AnimationClip };

export type CityGait = {
  walk: THREE.AnimationClip;
  jog: THREE.AnimationClip;
  pivot: THREE.AnimationClip;
  stride: number;
  jogStride: number;
  modelHash: string;
  shoeContacts?: ShoeContacts;
  apron?: ApronPatch;
  talk?: THREE.AnimationClip;
  bench?: BenchMotion;
};
export type CityAgentAsset = GLTF & { gait?: CityGait; groundHeight?: GroundHeight };

export function cityGaitLoader(signal: AbortSignal) {
  const cache = new Map<string, Promise<CityGait | undefined>>();
  return function load(file: string, priority: RequestPriority) {
    const match = /^agent-(0[1-8])\.glb$/.exec(file);
    if (!match) return undefined;
    const url = `/nexciv-motion/agent-${match[1]}-city-v1.json`;
    let pending = cache.get(file);
    if (!pending) {
      pending = fetch(url, { signal, priority }).then(async (response) => {
        if (!response.ok) return undefined;
        const { stride, jogStride, clips, modelHash, shoeContacts, apron } = await response.json() as {
          stride: number;
          jogStride: number;
          modelHash: string;
          shoeContacts?: ShoeContacts;
          apron?: ApronPatch;
          clips: Omit<ReturnType<typeof THREE.AnimationClip.toJSON>, 'uuid'>[];
        };
        if (!Number.isFinite(stride) || stride <= 0 || !Number.isFinite(jogStride) || jogStride <= 0 ||
          !/^[a-f0-9]{64}$/.test(modelHash)) return undefined;
        const parse = (name: string) => {
          const clip = clips.find((entry) => entry.name === name);
          return clip && clip.duration > 0 ? THREE.AnimationClip.parse({ ...clip, uuid: THREE.MathUtils.generateUUID() }) : undefined;
        };
        const walk = parse('Quaternius_WalkLoop');
        const jog = parse('Quaternius_JogLoop');
        const pivot = parse('Quaternius_Pivot');
        if (walk && jog && pivot) {
          const talk = parse('Quaternius_Idle_Talking_Loop');
          const enter = parse('Quaternius_Sitting_Enter');
          const rest = parse('Quaternius_Sitting_Idle_Loop');
          const exit = parse('Quaternius_Sitting_Exit');
          const bench = enter && rest && exit ? { enter, rest, exit } : undefined;
          return { walk, jog, pivot, stride, jogStride, modelHash, shoeContacts, apron, talk, bench };
        }
        return undefined;
      }).catch(() => undefined); // Keep the embedded GLB gait available when the optional file is unavailable.
      cache.set(file, pending);
    }
    return pending;
  };
}

export async function matchCityGait(gait: CityGait | undefined, bytes: ArrayBuffer) {
  if (!gait || !globalThis.crypto?.subtle) return gait;
  try {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return hex === gait.modelHash ? gait : undefined;
  } catch {
    return undefined;
  }
}
