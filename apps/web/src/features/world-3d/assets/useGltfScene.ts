'use client';

import { useEffect, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Group } from 'three';

const cache = new Map<string, Promise<Group>>();
let loader: GLTFLoader | null = null;

function load(url: string): Promise<Group> {
  let pending = cache.get(url);
  if (pending === undefined) {
    if (loader === null) loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    pending = loader.loadAsync(url).then((gltf) => gltf.scene).catch((error: unknown) => {
      cache.delete(url);
      throw error;
    });
    cache.set(url, pending);
  }
  return pending;
}

/**
 * P0+ — loads a GLB scene once per URL. Returns null while loading and after
 * a failure; callers keep their procedural fallback in that case, so a missing
 * asset can never blank or block the world (docs/3D_RENDERING.md §9).
 */
export function useGltfAsset(url: string | null) {
  const [result, setResult] = useState<{ url: string; scene: Group | null } | null>(null);

  useEffect(() => {
    if (url === null) return;
    let alive = true;
    load(url)
      .then((loaded) => {
        if (alive) setResult({ url, scene: loaded.clone(true) });
      })
      .catch(() => {
        if (alive) setResult({ url, scene: null });
      });
    return () => {
      alive = false;
    };
  }, [url]);

  return result?.url === url ? result : null;
}

export function useGltfScene(url: string | null): Group | null {
  return useGltfAsset(url)?.scene ?? null;
}
