import * as THREE from 'three';
import layout from './traffic-layout.json';

type Point = { x: number; z: number };
type Lane = {
  ends: Point[];
  starts: number[];
  length: number;
  speed: number;
};
type Fleet = { count: number; parts: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[] };
type Driver = { distance: number; speed: number; body: THREE.Object3D; fleet: Fleet };

const CAR_GAP = 6.5;
const ROAD_HEIGHT = layout.roadHeight;
const VEHICLE_COUNT = layout.lanes.reduce((total, lane) => total + lane.count, 0);
const TURN_LOOKAHEAD = [2, 4, 6, 8];

function makeLane(points: number[][], speed: number): Lane {
  const ends = points.map(([x = 0, z = 0]) => ({ x, z }));
  const starts = [0];
  let length = 0;
  for (const [i, point] of ends.entries()) {
    const next = ends[(i + 1) % ends.length]!;
    length += Math.hypot(next.x - point.x, next.z - point.z);
    starts.push(length);
  }
  return { ends, starts, length, speed };
}

function sample(lane: Lane, distance: number, out: Point) {
  const along = THREE.MathUtils.euclideanModulo(distance, lane.length);
  let index = 0;
  while (lane.starts[index + 1]! <= along) index++;
  const length = lane.starts[index + 1]! - lane.starts[index]!;
  const progress = (along - lane.starts[index]!) / length;
  const start = lane.ends[index]!;
  const end = lane.ends[(index + 1) % lane.ends.length]!;
  out.x = THREE.MathUtils.lerp(start.x, end.x, progress);
  out.z = THREE.MathUtils.lerp(start.z, end.z, progress);
  return length;
}

/** Reuse the gap left by the car ahead and reserve the next few metres for crossing residents. */
export function trafficAdvance(speed: number, cruise: number, clearance: number, dt: number) {
  if (dt <= 0) return { speed, distance: 0 };
  const target = Math.min(cruise, Math.sqrt(2 * 4.8 * clearance));
  const change = (target < speed ? 4.8 : 2.1) * dt;
  const next = speed + THREE.MathUtils.clamp(target - speed, -change, change);
  const distance = Math.min(next * dt, clearance);
  return { speed: distance < next * dt ? distance / dt : next, distance };
}

function contactShadow() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec2 vContact;
      void main() {
        vContact = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vContact;
      void main() {
        float falloff = 1.0 - smoothstep(0.24, 1.0, dot(vContact, vContact));
        gl_FragColor = vec4(0.017, 0.019, 0.023, 0.42 * falloff);
      }
    `,
  });
}

export function createTraffic(asset: THREE.Group) {
  const group = new THREE.Group();
  group.name = 'City road traffic';
  const prototypes = asset.children.filter(node => node.name.startsWith('Traffic_body_'));
  if (!prototypes.length) return;

  // Moving vehicles share a small contact shadow. Static building shadows stay cached.
  const ground = new THREE.PlaneGeometry(2.55, 5.12).rotateX(-Math.PI / 2);
  const contact = contactShadow();
  const shadows = new THREE.InstancedMesh(ground, contact, VEHICLE_COUNT);
  shadows.frustumCulled = false;
  group.add(shadows);
  asset.updateMatrixWorld(true);
  const fleets = prototypes.map(prototype => {
    const parts: Fleet['parts'] = [];
    prototype.traverse(source => {
      if (!(source instanceof THREE.Mesh)) return;
      const mesh = new THREE.InstancedMesh(source.geometry, source.material, Math.ceil(VEHICLE_COUNT / prototypes.length));
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      parts.push({ mesh, local: source.matrixWorld.clone() });
      group.add(mesh);
    });
    return { count: 0, parts };
  });
  let modelIndex = 0;
  const lanes = layout.lanes.map(({ points, speed, count }, index) => {
    const lane = makeLane(points, speed);
    const drivers: Driver[] = Array.from({ length: count }, (_, i) => {
      const fleet = fleets[modelIndex++ % fleets.length]!;
      const body = new THREE.Object3D();
      body.name = 'Moving vehicle';
      group.add(body);
      return { distance: ((i + 0.22 + index * 0.11) / count) * lane.length, speed, body, fleet };
    });
    return { lane, drivers };
  });
  const center: Point = { x: 0, z: 0 };
  const rear: Point = { x: 0, z: 0 };
  const front: Point = { x: 0, z: 0 };
  const lookahead: Point = { x: 0, z: 0 };
  const positions = [3.2, 5.6, 8.0, 10.4, 13, 16];
  const modelMatrix = new THREE.Matrix4();
  const shadowMatrix = new THREE.Matrix4();

  return {
    group,
    update(dt: number, residents: readonly Point[], onLoadedRoad: (point: Point) => boolean) {
      let shadowCount = 0;
      for (const fleet of fleets) fleet.count = 0;
      for (const { lane, drivers } of lanes) {
        // Advance back to front using the same previous-frame distances for all car-following checks.
        const first = drivers[0]!.distance;
        for (const [i, driver] of drivers.entries()) {
          if (dt > 0) {
            const gap = drivers.length < 2 ? lane.length : THREE.MathUtils.euclideanModulo(
              (drivers[i + 1]?.distance ?? first) - driver.distance, lane.length);
            let clearance = Math.max(0, gap - CAR_GAP);
            const turning = sample(lane, driver.distance, center) < 2.5
              || TURN_LOOKAHEAD.some(ahead => sample(lane, driver.distance + ahead, lookahead) < 2.5);
            const speed = turning ? 3.25 : lane.speed;
            for (const ahead of positions) {
              if (ahead > clearance + 3.6) break;
              sample(lane, driver.distance + ahead, lookahead);
              if (residents.some(p => (p.x - lookahead.x) ** 2 + (p.z - lookahead.z) ** 2 < 2.0 ** 2)) {
                clearance = Math.min(clearance, Math.max(0, ahead - 3.6));
                break;
              }
            }
            const next = trafficAdvance(driver.speed, speed, clearance, dt);
            driver.distance = THREE.MathUtils.euclideanModulo(driver.distance + next.distance, lane.length);
            driver.speed = next.speed;
          }
          sample(lane, driver.distance, center);
          driver.body.visible = onLoadedRoad(center);
          if (!driver.body.visible) continue;
          sample(lane, driver.distance - 0.85, rear);
          sample(lane, driver.distance + 0.85, front);
          const yaw = Math.atan2(rear.x - front.x, rear.z - front.z);
          driver.body.position.set(center.x, ROAD_HEIGHT, center.z);
          driver.body.rotation.y = yaw;
          driver.body.updateMatrix();
          const { fleet } = driver;
          for (const { mesh, local } of fleet.parts) {
            mesh.setMatrixAt(fleet.count, modelMatrix.multiplyMatrices(driver.body.matrix, local));
          }
          fleet.count++;
          shadowMatrix.copy(driver.body.matrix).setPosition(center.x, ROAD_HEIGHT + 0.017, center.z);
          shadows.setMatrixAt(shadowCount++, shadowMatrix);
        }
      }
      for (const { count, parts } of fleets) {
        for (const { mesh } of parts) {
          mesh.count = count;
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
      shadows.count = shadowCount;
      shadows.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      ground.dispose();
      contact.dispose();
      shadows.dispose();
      for (const { parts } of fleets) for (const { mesh } of parts) mesh.dispose();
    },
  };
}

/** Old preview GLBs joined the parked cars into NEXCIV_city. Only strip triangles inside the authored car envelopes. */
export function removeParkedVehicles(asset: THREE.Object3D) {
  const city = asset.getObjectByName('NEXCIV_city');
  if (!city) return 0;
  let removed = 0;
  asset.updateMatrixWorld(true);
  city.traverse(mesh => {
    if (!(mesh instanceof THREE.Mesh) || Array.isArray(mesh.material)) return;
    const name = mesh.material.name.replace(/\.\d+$/, '');
    const boxes = layout.parkedVehicles.filter(car => car.finishes.includes(name)).map(car =>
      new THREE.Box3(new THREE.Vector3().fromArray(car.min), new THREE.Vector3().fromArray(car.max)).expandByScalar(0.027));
    const positions = mesh.geometry.getAttribute('position');
    const indices = mesh.geometry.index;
    if (!boxes.length || !positions || !indices) return;
    const hits = new Int32Array(positions.count);
    const vertex = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      if (vertex.y < 0.012 || vertex.y > 2.1) continue;
      const box = boxes.findIndex(bounds => bounds.containsPoint(vertex));
      if (box >= 0) hits[i] = box + 1;
    }
    const kept: number[] = [];
    for (let i = 0; i < indices.count; i += 3) {
      const a = indices.getX(i), b = indices.getX(i + 1), c = indices.getX(i + 2);
      if (hits[a] && hits[a] === hits[b] && hits[a] === hits[c]) removed++;
      else kept.push(a, b, c);
    }
    if (kept.length !== indices.count) mesh.geometry.setIndex(kept);
  });
  return removed;
}
