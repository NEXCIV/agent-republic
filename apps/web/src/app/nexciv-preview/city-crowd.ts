import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createAgentPatrol, measuredRoute, type RoutePoint } from './agent';

export type PedestrianPath = {
  id: string;
  model: string;
  speed: number;
  start: number;
  pause: number;
  reverse: boolean;
  points: RoutePoint[];
};

export function createCityCrowd() {
  const group = new THREE.Group();
  group.name = 'City pedestrians';
  const pedestrians: { patrol: ReturnType<typeof createAgentPatrol>; advance: (
    dt: number,
    residents: readonly THREE.Vector3[],
    onLoadedGround: (point: THREE.Vector3) => boolean,
    blocksCrossing?: (point: THREE.Vector3) => boolean,
  ) => void }[] = [];

  return {
    group,
    add(asset: GLTF, path: PedestrianPath) {
      const last = path.points.at(-1)!;
      const scene = clone(asset.scene) as THREE.Group;
      const patrol = createAgentPatrol({ ...asset, scene }, path.points, [last[0], last[2]], path.speed);
      patrol.root.name = `Pedestrian ${path.id}`;
      patrol.root.visible = false;
      group.add(patrol.root);

      const { route, length, positionAt } = measuredRoute(path.points);
      let distance = length * path.start;
      // Keep the initial pose on raised pavement for paused and reduced-motion views.
      const startingPoint = route.reduce((best, point) =>
        point.position.y >= 0.105 && (best.position.y < 0.105 || Math.abs(point.distance - distance) < Math.abs(best.distance - distance))
          ? point : best);
      distance = startingPoint.distance;
      let direction = path.reverse ? -1 : 1;
      let waiting = 0;
      let wasMoving = false;
      const current = new THREE.Vector3();
      const next = new THREE.Vector3();
      const face = new THREE.Vector3();

      positionAt(distance, current);
      const endpoint = () => direction > 0 ? length : 0;
      const orient = () => {
        const facing = distance === endpoint() ? -direction : direction;
        positionAt(distance + facing * 0.47, face);
      };
      orient();
      patrol.observe(0, current, face);
      pedestrians.push({ patrol, advance(dt, residents, onLoadedGround, blocksCrossing) {
        if (dt <= 0) {
          const wasVisible = patrol.root.visible;
          patrol.root.visible = onLoadedGround(current);
          if (wasMoving || (!wasVisible && patrol.root.visible)) patrol.observe(0, current, face);
          wasMoving = false;
          return;
        }
        let moving = false;
        if (waiting > 0) {
          waiting = Math.max(0, waiting - dt);
          if (waiting === 0) direction *= -1;
        } else {
          const proposed = THREE.MathUtils.clamp(distance + direction * path.speed * dt, 0, length);
          positionAt(proposed, next);
          const loaded = onLoadedGround(next);
          const traffic = next.y < 0.105 && blocksCrossing?.(next);
          const occupied = residents.some(p => {
            const ahead = next.distanceToSquared(p);
            return ahead < 0.58 ** 2 && ahead < current.distanceToSquared(p);
          });
          if (!loaded || (!traffic && !occupied)) {
            moving = proposed !== distance;
            distance = proposed;
            current.copy(next);
            if (distance === endpoint()) waiting = path.pause;
          }
        }
        if (!waiting || waiting < path.pause * 0.28) orient();
        patrol.root.visible = onLoadedGround(current);
        if (patrol.root.visible) patrol.observe(dt, current, face, moving);
        wasMoving = moving;
      } });
    },
    update(
      dt: number,
      residents: readonly THREE.Vector3[],
      onLoadedGround: (point: THREE.Vector3) => boolean,
      blocksCrossing?: (point: THREE.Vector3) => boolean,
    ) {
      for (const pedestrian of pedestrians) pedestrian.advance(dt, residents, onLoadedGround, blocksCrossing);
    },
    dispose() {
      for (const { patrol } of pedestrians) {
        patrol.dispose();
        patrol.root.traverse(node => {
          if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
        });
      }
      pedestrians.length = 0;
      group.clear();
    },
  };
}
