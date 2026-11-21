'use client';

import { useEffect, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Group } from 'three';

const cache = new Map<string, Promise<Group>>();
let loader: GLTFLoader | null = null;

function load(url: string): Promise<Group> {
  let pending = cache.get(url);
  if (pending === undefined) {
    if (loader === null) loader = new GLTFLoader();
    pending = loader.loadAsync(url).then((gltf) => gltf.scene);
    cache.set(url, pending);
  }
  return pending;
}

/**
 * P0+ — loads a GLB scene once per URL. Returns null while loading and after
 * a failure; callers keep their procedural fallback in that case, so a missing
 * asset can never blank or block the world (docs/3D_RENDERING.md §9).
 */
export function useGltfScene(url: string | null): Group | null {
  const [scene, setScene] = useState<Group | null>(null);

  useEffect(() => {
    if (url === null) return;
    let alive = true;
    load(url)
      .then((loaded) => {
        if (alive) setScene(loaded.clone(true));
      })
      .catch(() => {
        // Keep the procedural fallback; do not retry per render.
      });
    return () => {
      alive = false;
    };
  }, [url]);

  return scene;
}
