import * as THREE from 'three';
import { THEATRE_ENTRY_LIGHTS, THEATRE_STAGE } from '../../lib/theatre-layout';

export function createTheatreLighting() {
  const group = new THREE.Group();
  group.name = 'NEXCIV Theatre admission lights';
  const housing = new THREE.MeshStandardMaterial({ color: '#282d31', metalness: 0.44, roughness: 0.47 });
  const lens = new THREE.MeshStandardMaterial({ color: '#ae7d34', emissive: '#ffbf63', emissiveIntensity: 0, roughness: 0.33 });
  const body = new THREE.BoxGeometry(0.22, 0.94, 0.21);
  const head = new THREE.BoxGeometry(0.29, 0.12, 0.25);
  const lights: THREE.PointLight[] = [];
  for (const point of THEATRE_ENTRY_LIGHTS) {
    const marker = new THREE.Group();
    marker.position.set(...point);
    const upright = new THREE.Mesh(body, housing);
    upright.position.y = 0.47;
    const cap = new THREE.Mesh(head, lens);
    cap.position.y = 0.91;
    const lamp = new THREE.PointLight('#ffbf71', 23, 5.5, 2);
    lamp.position.set(0, 0.93, -0.17);
    lights.push(lamp);
    marker.add(upright, cap, lamp);
    group.add(marker);
  }
  const stage = new THREE.PointLight('#ffd3a0', 220, 19, 2);
  stage.position.set(THEATRE_STAGE[0], 4.6, THEATRE_STAGE[2]);
  lights.push(stage);
  group.add(stage);
  function setOpen(open: boolean) {
    lens.emissiveIntensity = open ? 3.4 : 0;
    for (const light of lights) light.visible = open;
  }
  setOpen(false);
  return { group, setOpen };
}
