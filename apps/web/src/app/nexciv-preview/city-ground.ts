import * as THREE from 'three';

export type GroundHeight = (x: number, z: number, expected: number) => number | undefined;

const CELL = 3;
const paving = /^(NEXCIV_paving|CIVRUM_PAVED_FORECOURT)(?:[_.]|$)/i;
const terrain = /^(NEXCIV_terrain|NEXCIV_land)(?:[_.]|$)/i;
const street = /^NEXCIV_city(?:[_.]|$)/i;
const shore = /^NEXCIV_shore(?:[_.]|$)/i;
const works = /^HERO_04_Public_Construction(?:[_.0-9]|$)/i;
const cityFloor = /CIVIC[_ ](?:Square_Pavers|Paving)|entrance[_ ]paving|volcanic[_ ]paver|crosswalk|CONCRETE_GRAY/i;
const shoreFloor = /Bluestone|Shingle|Gravel.path|Warm.teak|Connector.asphalt|Quay.limestone|Pier.*teak|Granite.edging/i;
const workStone = /Works[_ ](?:Limestone|Cut.Stone)/i;

type GroundFace = {
  ax: number; az: number; ay: number;
  bx: number; bz: number; by: number;
  cx: number; cz: number; cy: number;
  inverse: number;
  coarse: boolean;
  visibility?: THREE.Object3D;
};

export function createCityGround() {
  const faces = new Map<string, GroundFace[]>();
  const cell = (coordinate: number) => Math.floor(coordinate / CELL);
  const registered = new WeakSet<THREE.Mesh>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();

  function add(asset: THREE.Object3D) {
    asset.updateWorldMatrix(true, true);
    asset.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || registered.has(object)) return;
      // glTF primitive meshes may be children of a named multi-material mesh.
      const names = [object.name, object.parent?.name ?? ''].map((part) => part.replaceAll(' ', '_'));
      const matches = (pattern: RegExp) => names.some((part) => pattern.test(part));
      const workObject = [object, object.parent].find((part) => part && (
        part.userData.previewTier === 'works_proxy' || works.test(part.name)));
      const isWorks = Boolean(workObject);
      const isTerrain = matches(terrain);
      const isExplicit = typeof object.userData.walkableOffset === 'number';
      const offset = isExplicit ? object.userData.walkableOffset as number : 0;
      if (!matches(paving) && !isTerrain && !matches(street) && !matches(shore) && !isWorks && !isExplicit) return;
      const position = object.geometry.getAttribute('position');
      if (!position) return;
      const index = object.geometry.index;
      const world = object.matrixWorld;
      registered.add(object);

      const include = (material: THREE.Material) =>
        isExplicit || matches(paving) || isTerrain || (matches(street) && cityFloor.test(material.name)) ||
        (matches(shore) && shoreFloor.test(material.name)) ||
        (isWorks && (workStone.test(material.name) || /^tripo_material/i.test(material.name)));
      const groups = object.geometry.groups.length ? object.geometry.groups : [
        { start: 0, count: index?.count ?? position.count, materialIndex: 0 },
      ];
      for (const group of groups) {
        const material = Array.isArray(object.material) ? object.material[group.materialIndex ?? 0] : object.material;
        if (!material || !include(material)) continue;
        for (let i = group.start; i + 2 < group.start + group.count; i += 3) {
          a.fromBufferAttribute(position, index?.getX(i) ?? i).applyMatrix4(world);
          b.fromBufferAttribute(position, index?.getX(i + 1) ?? i + 1).applyMatrix4(world);
          c.fromBufferAttribute(position, index?.getX(i + 2) ?? i + 2).applyMatrix4(world);
          if (isWorks && [a, b, c].some((p) => p.x < 90.9 || p.x > 99.1 || p.z < 73.2 || p.z > 82 || p.y > 1.55)) continue;
          edge1.subVectors(b, a);
          edge2.subVectors(c, a);
          const normal = edge1.cross(edge2);
          if (normal.y < 0.00001 || normal.y < normal.length() * 0.72) continue;
          const face = {
            ax: a.x, az: a.z, ay: a.y + offset,
            bx: b.x - a.x, bz: b.z - a.z, by: b.y - a.y,
            cx: c.x - a.x, cz: c.z - a.z, cy: c.y - a.y,
            inverse: -1 / normal.y,
            coarse: isTerrain,
            visibility: workObject ?? undefined,
          };
          for (let x = cell(Math.min(a.x, b.x, c.x)); x <= cell(Math.max(a.x, b.x, c.x)); x += 1) {
            for (let z = cell(Math.min(a.z, b.z, c.z)); z <= cell(Math.max(a.z, b.z, c.z)); z += 1) {
              const key = `${x},${z}`;
              const bucket = faces.get(key);
              if (bucket) bucket.push(face);
              else faces.set(key, [face]);
            }
          }
        }
      }
    });
  }

  const height: GroundHeight = (x, z, expected) => {
    const bucket = faces.get(`${cell(x)},${cell(z)}`);
    if (!bucket) return;
    let top = -Infinity;
    for (const face of bucket) {
      const dx = x - face.ax;
      const dz = z - face.az;
      const u = (dx * face.cz - dz * face.cx) * face.inverse;
      const v = (face.bx * dz - face.bz * dx) * face.inverse;
      if (Math.min(u, v) < -0.0001 || u + v > 1.0001) continue;
      if (face.visibility) {
        let parent: THREE.Object3D | null = face.visibility;
        while (parent?.visible) parent = parent.parent;
        if (parent) continue;
      }
      const y = face.ay + face.by * u + face.cy * v;
      if (face.coarse && Math.abs(y - expected) > 0.065) continue;
      if (y >= expected - 0.28 && y <= expected + 0.24 && y > top) top = y;
    }
    if (Number.isFinite(top)) return top;
  };
  return { add, height };
}
