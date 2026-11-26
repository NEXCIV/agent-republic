import * as THREE from 'three';
import type { RoutePoint } from './agent';

const pavement = 0.184;
const crossingX = 8.65;
const marketJunction = new THREE.Vector3(crossingX, pavement, 58.15);

export const CAFE_STALL: RoutePoint = [12.60, pavement, 74];
export const CAFE_COUNTER: RoutePoint = [12.60, pavement, 72.18];
export const CAFE_HOST: RoutePoint = [10.95, pavement, 72.15];
export const CAFE_BENCH: RoutePoint = [16, pavement, 72.35];

const counterToMarketSidewalk: RoutePoint[] = [
  CAFE_COUNTER,
  [CAFE_COUNTER[0], pavement, 70.85],
  [10.95, pavement, 70.05],
  [crossingX, pavement, 69.55],
  [crossingX, pavement, 67.80],
  [crossingX, 0.038, 67.20],
  [crossingX, 0.038, 60.95],
  [crossingX, pavement, 60.35],
];

export function joinCafeToPier(marketToPier: RoutePoint[]): RoutePoint[] {
  let nearest = 0;
  let distance = Infinity;
  for (const [index, [x, y, z]] of marketToPier.entries()) {
    const metres = Math.hypot(x - marketJunction.x, y - marketJunction.y, z - marketJunction.z);
    if (metres < distance) {
      distance = metres;
      nearest = index;
    }
  }
  if (distance > 0.75) throw new Error('The café crossing must meet the market sidewalk route');
  return [...counterToMarketSidewalk, ...marketToPier.slice(nearest)];
}

export function createCafePaving() {
  const corner = new THREE.Group();
  corner.name = 'Cafe corner apron and crossing';
  const west = 8.45;
  const north = 70.20;
  const columns = 12;
  const rows = 8;
  const tileWidth = 0.79;
  const tileDepth = 0.68;
  const width = columns * tileWidth;
  const depth = rows * tileDepth;
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.19, depth),
    new THREE.MeshStandardMaterial({ color: '#948a7c', roughness: 0.92 }),
  );
  base.position.set(west + width / 2, pavement - 0.108, north + depth / 2);
  base.receiveShadow = true;
  corner.add(base);

  const tiles = new THREE.InstancedMesh(
    new THREE.BoxGeometry(tileWidth - 0.015, 0.016, tileDepth - 0.015),
    new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    columns * rows,
  );
  const stone = ['#aaa094', '#a49b8e', '#a9a093'].map((tone) => new THREE.Color(tone));
  const transform = new THREE.Matrix4();
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      transform.makeTranslation(west + (column + 0.5) * tileWidth, pavement - 0.008, north + (row + 0.5) * tileDepth);
      tiles.setMatrixAt(index, transform);
      tiles.setColorAt(index, stone[(row * 3 + column * 7 + row * column) % stone.length]!);
    }
  }
  tiles.receiveShadow = true;
  corner.add(tiles);

  const stripes = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1.8, 0.29),
    new THREE.MeshStandardMaterial({ color: '#ded9ca', roughness: 0.86 }),
    11,
  );
  transform.makeRotationX(-Math.PI / 2);
  for (let index = 0; index < stripes.count; index++) {
    transform.setPosition(crossingX, 0.041, 61.28 + index * 0.54);
    stripes.setMatrixAt(index, transform);
  }
  stripes.receiveShadow = true;
  corner.add(stripes);
  return corner;
}
