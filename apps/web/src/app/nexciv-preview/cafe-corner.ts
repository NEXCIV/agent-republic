import * as THREE from 'three';
import { CAFE_COUNTER, CAFE_CROSSING_X } from '../../lib/cafe-geometry';
export { CAFE_BENCH, CAFE_COUNTER, CAFE_HOST, CAFE_STALL, joinCafeToPier } from '../../lib/cafe-geometry';

// Soft pools under the fixtures also read at city scale, where a bulb is smaller than one pixel.
export function createPromenadeLightPools() {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const u = (col + 0.5) * 2 / size - 1;
      const v = (row + 0.5) * 2 / size - 1;
      const falloff = Math.max(0, 1 - u * u - v * v) ** 3;
      pixels.set([255, 255, 255, Math.round(255 * falloff)], (row * size + col) * 4);
    }
  }
  const map = new THREE.DataTexture(pixels, size, size);
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  const fixtures = [
    // x, pavement height, z, width and depth in metres
    [12.6, 0.184, 72.4, 3.7, 2.6],
    [20.9, 0.184, 73.8, 5.5, 3.4], [26.9, 0.184, 73.8, 5.5, 3.4],
    [4.15, 0.18, 25.2, 2.15, 2.15], [-1.15, 0.18, 25.2, 2.15, 2.15],
  ] as const;
  const geometry = new THREE.PlaneGeometry().rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({
    map, color: '#ffc07c', opacity: 0.25, blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
  }), fixtures.length);
  const matrix = new THREE.Matrix4();
  fixtures.forEach(([x, y, z, width, depth], i) => {
    pools.setMatrixAt(i, matrix.makeScale(width, 1, depth).setPosition(x, y + .006, z));
  });
  pools.name = 'Dusk light on promenade paving';
  return pools;
}

export function createCafePaving() {
  const pavement = CAFE_COUNTER[1];
  const crossingX = CAFE_CROSSING_X;
  const corner = new THREE.Group();
  corner.name = 'Cafe corner apron and crossing';
  // West and north meet the two surveyed sidewalk edges. The terrace starts at x = 17.93.
  const west = 7.75;
  const north = 70.25;
  const columns = 13;
  const rows = 8;
  const tileWidth = (17.93 - west) / columns;
  const tileDepth = 0.68;
  const width = columns * tileWidth;
  const depth = rows * tileDepth;
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.19, depth),
    new THREE.MeshStandardMaterial({ color: '#948a7c', roughness: 0.92 }),
  );
  base.position.set(west + width / 2, pavement - 0.108, north + depth / 2);
  // Use the base footprint at the tile tops, including the narrow tile joints.
  base.userData.walkableOffset = 0.013;
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
