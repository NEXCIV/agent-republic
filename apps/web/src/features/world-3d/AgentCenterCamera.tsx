'use client';

import { useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type StreetView = 'facade' | 'entrance';

export function AgentCenterCamera({ view, position }: {
  view: StreetView;
  position: readonly [number, number, number];
}) {
  const { get, set, gl, size, invalidate } = useThree();
  const camera = useMemo(() => new PerspectiveCamera(30, 1, 0.08, 160), []);
  const controls = useMemo(() => new OrbitControls(camera), [camera]);

  useLayoutEffect(() => {
    const previous = get().camera;
    controls.domElement = gl.domElement;
    controls.connect();
    controls.enablePan = false;
    controls.minAzimuthAngle = -0.68;
    controls.maxAzimuthAngle = 0.68;
    controls.minPolarAngle = 1.18;
    controls.maxPolarAngle = 1.66;
    controls.minDistance = 4.5;
    controls.maxDistance = 14;
    const redraw = () => invalidate();
    controls.addEventListener('change', redraw);
    set({ camera });
    return () => {
      controls.removeEventListener('change', redraw);
      controls.dispose();
      set({ camera: previous });
      invalidate();
    };
  }, [camera, controls, gl, get, set, invalidate]);

  useLayoutEffect(() => {
    camera.aspect = size.width / Math.max(1, size.height);
    // Keep the entire facade in frame on portrait screens.
    camera.fov = 2 * Math.atan(Math.max(Math.tan(Math.PI / 12), 0.37 / camera.aspect)) * 180 / Math.PI;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size, invalidate]);

  useLayoutEffect(() => {
    const [x, y, z] = position;
    if (view === 'facade') {
      camera.position.set(x - 2.8, y + 1.65, z + 12);
      controls.target.set(x, y + 2.42, z);
    } else {
      camera.position.set(x - 0.85, y + 1.05, z + 6.3);
      controls.target.set(x, y + 1.32, z + 1.3);
    }
    controls.update();
    invalidate();
  }, [camera, controls, position, view, invalidate]);
  return null;
}
