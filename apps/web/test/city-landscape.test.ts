import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { landscapeVisibility, LANDSCAPE_REGION, substituteLandscapeRetail } from '../src/app/nexciv-preview/city-landscape';

describe('city landscape building variants', () => {
  it('retains original instances at unrelated addresses and compacts every material primitive', () => {
    const root = new THREE.Group();
    const shop = new THREE.Group();
    shop.name = 'NEXCIV instances | HI3D | Garden Roof Retail.001';
    root.add(shop);
    for (let primitive = 0; primitive < 2; primitive++) {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 3);
      mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-141.1, 0, 46));
      mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(-18.6, 0, 50.55));
      mesh.setMatrixAt(2, new THREE.Matrix4().makeTranslation(42, 0, 141));
      shop.add(mesh);
    }
    substituteLandscapeRetail(root);
    substituteLandscapeRetail(root);
    for (const mesh of shop.children as THREE.InstancedMesh[]) {
      expect(mesh.count).toBe(1);
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(0, matrix);
      const retained = new THREE.Vector3().setFromMatrixPosition(matrix);
      expect(retained.x).toBeCloseTo(-18.6);
      expect(retained.z).toBeCloseTo(50.55);
    }
  });

  it('suppresses a matching street model and its existing close clone while leaving other locations alone', () => {
    const root = new THREE.Group();
    const at = (x: number, z: number, name: string) => {
      const shop = new THREE.Group();
      shop.name = name;
      shop.position.set(x, 0, z);
      root.add(shop);
      return shop;
    };
    const mid = at(-107, 27, 'HI3D | Garden Roof Retail.002');
    const close = at(-107, 27, 'HI3D | Garden Roof Retail.002_close');
    const other = at(-51, 19, 'HI3D | Garden Roof Retail.004');
    const landmark = at(-107, 27, 'Hero landmark');
    substituteLandscapeRetail(root);
    expect(mid.visible).toBe(false);
    expect(close.visible).toBe(false);
    expect(mid.userData.landscapeReplacement).toBe(true);
    expect(other.visible).toBe(true);
    expect(landmark.visible).toBe(true);
  });

  it('restores all instances after switching between a loaded street region and overview', () => {
    const root = new THREE.Group();
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 2);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(25, 0, 112));
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(-107, 0, 27));
    root.add(mesh);
    const update = landscapeVisibility(root);
    expect(update(LANDSCAPE_REGION.west)).toBe(true);
    expect(mesh.count).toBe(1);
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).x).toBe(-107);
    expect(update(LANDSCAPE_REGION.base)).toBe(true);
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);
    update(LANDSCAPE_REGION.south | LANDSCAPE_REGION.west);
    expect(mesh.count).toBe(2);
    expect(mesh.visible).toBe(true);
    mesh.getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).x).toBe(25);
  });
});
