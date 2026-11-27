import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createTraffic, removeParkedVehicles, trafficAdvance } from '../src/app/nexciv-preview/traffic';

describe('city traffic', () => {
  it('resumes gently, brakes progressively, and never advances past the available clearance', () => {
    expect(trafficAdvance(0, 8, 30, 0.1).speed).toBeCloseTo(0.21);
    expect(trafficAdvance(6, 8, 1.2, 0.1).speed).toBeCloseTo(5.52);
    expect(trafficAdvance(8, 8, 0.15, 0.1).distance).toBe(0.15);
    expect(trafficAdvance(4, 8, 0, 0.1)).toEqual({ speed: 0, distance: 0 });
    expect(trafficAdvance(5, 8, 0, 0)).toEqual({ speed: 5, distance: 0 });
  });

  it('continues one fleet across view changes while hiding vehicles in an unloaded road region', () => {
    const asset = new THREE.Group();
    const prototype = new THREE.Group();
    prototype.name = 'Traffic_body_1';
    asset.add(prototype);
    const traffic = createTraffic(asset)!;
    const cars = traffic.group.children.filter(node => node.name === 'Moving vehicle');
    traffic.update(0, [], () => true);
    const start = cars[0]!.position.clone();
    traffic.update(0.5, [], () => false);
    expect(cars.every(car => !car.visible)).toBe(true);
    traffic.update(0, [], () => true);
    expect(cars.every(car => car.visible)).toBe(true);
    expect(cars[0]!.position.distanceTo(start)).toBeGreaterThan(1);
    const paused = cars[0]!.position.clone();
    traffic.update(0, [], () => true);
    expect(cars[0]!.position.equals(paused)).toBe(true);
    traffic.dispose();
  });

  it('strips only the legacy car triangles at their authored locations and finishes', () => {
    const asset = new THREE.Group();
    const city = new THREE.Group();
    city.name = 'NEXCIV_city';
    asset.add(city);
    const vertices = [
      -124.5, 0.6, 87, -124.4, 0.7, 87, -124.4, 0.6, 88,
      -124.4, 0.038, 86, -123.4, 0.038, 86, -124.4, 0.038, 100,
    ];
    const makeMesh = (name: string) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setIndex([0, 1, 2, 3, 4, 5]);
      const material = new THREE.MeshStandardMaterial();
      material.name = name;
      const mesh = new THREE.Mesh(geometry, material);
      city.add(mesh);
      return mesh;
    };
    const car = makeMesh('MAT_CIVIC_Basalt.003');
    const marking = makeMesh('MAT_WARM_WHITE.003');
    expect(removeParkedVehicles(asset)).toBe(1);
    expect(Array.from(car.geometry.index!.array)).toEqual([3, 4, 5]);
    expect(marking.geometry.index!.count).toBe(6);
    expect(removeParkedVehicles(asset)).toBe(0);
  });

  it('holds a vehicle behind a crossing resident and resumes when the crossing clears', () => {
    const asset = new THREE.Group();
    const prototype = new THREE.Group();
    prototype.name = 'Traffic_body_1';
    asset.add(prototype);
    const traffic = createTraffic(asset)!;
    const car = traffic.group.getObjectByName('Moving vehicle')!;
    const dt = 1 / 30;
    const active = () => true;
    traffic.update(0, [], active);
    expect(traffic.blocksCrossing(car.position)).toBe(true);
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(car.quaternion);
    const crossing = car.position.clone().addScaledVector(direction, 10);
    for (let frame = 0; frame < 180; frame++) traffic.update(dt, [crossing], active);
    expect(car.position.distanceTo(crossing)).toBeGreaterThan(2.5);
    const stopped = car.position.clone();
    expect(traffic.blocksCrossing(crossing)).toBe(false);
    traffic.update(dt, [crossing], active);
    expect(car.position.equals(stopped)).toBe(true);
    for (let frame = 0; frame < 45; frame++) traffic.update(dt, [], active);
    expect(car.position.distanceTo(stopped)).toBeGreaterThan(1);
    traffic.dispose();
  });
});
