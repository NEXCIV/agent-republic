import * as THREE from 'three';
import layout from './city-landscape.json';

const RETAIL = 'HI3DGardenRoofRetail';
const INSTANCED_RETAIL = 'NEXCIVinstances' + RETAIL;
export const LANDSCAPE_REGION = {
  base: 1, governance: 2, west: 4, east: 8, research: 16, residential: 32, shore: 64, south: 128, outline: 256,
};

function regionFor(x: number, z: number) {
  const y = -z;
  if (y >= 116) return LANDSCAPE_REGION.shore;
  if (x < -52) {
    return y < -130 ? LANDSCAPE_REGION.outline : y >= 15 ? LANDSCAPE_REGION.research : LANDSCAPE_REGION.west;
  }
  if (x > 53) {
    return y < -125 ? LANDSCAPE_REGION.outline : y >= 44 ? LANDSCAPE_REGION.residential : LANDSCAPE_REGION.east;
  }
  return y >= 46 ? LANDSCAPE_REGION.governance : y <= -81 ? LANDSCAPE_REGION.south : LANDSCAPE_REGION.base;
}

/** Reuse the same instanced asset in the overview and in the currently loaded pedestrian regions. */
export function landscapeVisibility(asset: THREE.Object3D) {
  const batches: { mesh: THREE.InstancedMesh; entries: { matrix: THREE.Matrix4; region: number }[] }[] = [];
  asset.updateMatrixWorld(true);
  asset.traverse(mesh => {
    if (!(mesh instanceof THREE.InstancedMesh)) return;
    const entries = Array.from({ length: mesh.count }, (_, index) => {
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(index, matrix);
      const point = new THREE.Vector3().setFromMatrixPosition(matrix).applyMatrix4(mesh.matrixWorld);
      return { matrix, region: regionFor(point.x, point.z) };
    });
    batches.push({ mesh, entries });
  });
  let previous = -1;
  return (mask: number) => {
    if (previous === mask) return false;
    previous = mask;
    for (const { mesh, entries } of batches) {
      let count = 0;
      for (const entry of entries) {
        if (entry.region & mask) mesh.setMatrixAt(count++, entry.matrix);
      }
      mesh.visible = count > 0;
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (count) {
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
      }
    }
    return true;
  };
}

function originalSlot(point: THREE.Vector3) {
  return layout.retailReplacements.some(([x, z]) =>
    x !== undefined && z !== undefined && Math.abs(point.x - x) < 0.22 && Math.abs(point.z - z) < 0.22);
}

/** Hide only the repeated procedural shop placements occupied by the successfully loaded variants. */
export function substituteLandscapeRetail(asset: THREE.Object3D) {
  const point = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  asset.updateMatrixWorld(true);
  asset.traverse(node => {
    const name = node.name.replace(/[^a-z0-9]/gi, '');
    if (name.startsWith(INSTANCED_RETAIL) && !node.userData.landscapeGroupApplied) {
      node.userData.landscapeGroupApplied = true;
      node.traverse(part => {
        if (!(part instanceof THREE.InstancedMesh) || part.userData.landscapeVariantsApplied) return;
        part.userData.landscapeVariantsApplied = true;
        let retained = 0;
        for (let i = 0; i < part.count; i++) {
          part.getMatrixAt(i, matrix);
          point.setFromMatrixPosition(matrix).applyMatrix4(part.matrixWorld);
          if (originalSlot(point)) continue;
          if (retained !== i) {
            part.setMatrixAt(retained, matrix);
            if (part.instanceColor) {
              part.getColorAt(i, color);
              part.setColorAt(retained, color);
            }
          }
          retained++;
        }
        if (retained !== part.count) {
          part.count = retained;
          part.instanceMatrix.needsUpdate = true;
          if (part.instanceColor) part.instanceColor.needsUpdate = true;
          part.computeBoundingBox();
          part.computeBoundingSphere();
        }
      });
      return;
    }
    if (!name.startsWith(RETAIL) || node instanceof THREE.InstancedMesh) return;
    if (!originalSlot(node.getWorldPosition(point))) return;
    node.userData.landscapeReplacement = true;
    node.visible = false;
  });
}
