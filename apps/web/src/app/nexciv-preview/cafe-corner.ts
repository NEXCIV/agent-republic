import * as THREE from 'three';
import { CAFE_COUNTER, CAFE_CROSSING_X } from '../../lib/cafe-geometry';
export { CAFE_BENCH, CAFE_COUNTER, CAFE_HOST, CAFE_STALL, joinCafeToPier } from '../../lib/cafe-geometry';

export function createCafePaving() {
  const pavement = CAFE_COUNTER[1];
  const crossingX = CAFE_CROSSING_X;
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
