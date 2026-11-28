import * as THREE from 'three';
import { expect, it } from 'vitest';
import { lightOverview } from '../src/app/nexciv-preview/overview-dusk';

it('uses a single transparent pass for overview fountain jets and keeps other transmissive surfaces intact', () => {
  const jets = new THREE.MeshPhysicalMaterial({
    name: 'MAT_CIVIC_Jet.001', transmission: 0.52, emissive: '#56bce0', side: THREE.DoubleSide,
  });
  const glazing = new THREE.MeshPhysicalMaterial({ name: 'Building glass', transmission: 0.5 });
  const asset = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  const sky = new THREE.Texture();
  asset.add(new THREE.Mesh(geometry, [jets, glazing]));
  const emissive = jets.emissive.clone();
  try {
    lightOverview(asset, sky);
    expect(jets).toMatchObject({ transmission: 0, transparent: true, depthWrite: false, forceSinglePass: true });
    expect(jets.opacity).toBeGreaterThan(0);
    expect(jets.opacity).toBeLessThan(1);
    expect(jets.emissive.equals(emissive)).toBe(true);
    expect(glazing.transmission).toBe(0.5);
  } finally {
    geometry.dispose();
    jets.dispose();
    glazing.dispose();
    sky.dispose();
  }
});
