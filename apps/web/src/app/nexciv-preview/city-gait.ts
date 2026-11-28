import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

export type CityGait = {
  walk: THREE.AnimationClip;
  jog: THREE.AnimationClip;
  pivot: THREE.AnimationClip;
  stride: number;
  jogStride: number;
  modelHash: string;
};
export type CityAgentAsset = GLTF & { gait?: CityGait };

const urls: Partial<Record<string, string>> = {
  'agent-02.glb': '/nexciv-motion/agent-02-city-v1.json',
  'agent-06.glb': '/nexciv-motion/agent-06-city-v1.json',
};

export function cityGaitLoader(signal: AbortSignal) {
  const cache = new Map<string, Promise<CityGait | undefined>>();
  return function load(file: string, priority: RequestPriority) {
    const url = urls[file];
    if (!url) return undefined;
    let pending = cache.get(file);
    if (!pending) {
      pending = fetch(url, { signal, priority }).then(async (response) => {
        if (!response.ok) return undefined;
        const { stride, jogStride, clips, modelHash } = await response.json() as {
          stride: number;
          jogStride: number;
          modelHash: string;
          clips: Omit<ReturnType<typeof THREE.AnimationClip.toJSON>, 'uuid'>[];
        };
        if (!Number.isFinite(stride) || stride <= 0 || !Number.isFinite(jogStride) || jogStride <= 0 ||
          !/^[a-f0-9]{64}$/.test(modelHash)) return undefined;
        const parse = (name: string) => {
          const clip = clips.find((entry) => entry.name === name);
          return clip && THREE.AnimationClip.parse({ ...clip, uuid: THREE.MathUtils.generateUUID() });
        };
        const walk = parse('Quaternius_WalkLoop');
        const jog = parse('Quaternius_JogLoop');
        const pivot = parse('Quaternius_Pivot');
        if (walk && jog && pivot && walk.duration > 0 && jog.duration > 0 && pivot.duration > 0) {
          return { walk, jog, pivot, stride, jogStride, modelHash };
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
