import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ASSET_ROOT = '/nexciv-walk/';
const TURN_SECONDS = 12;

function disposeScene(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const bitmaps = new Set<ImageBitmap>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of [node.material].flat()) materials.add(material);
    if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) {
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) bitmaps.add(texture.image);
    texture.dispose();
  }
  for (const bitmap of bitmaps) bitmap.close();
  for (const geometry of geometries) geometry.dispose();
}

export function createAvatarTurntable(host: HTMLDivElement, onContextLost: () => void) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true });
  if (!context) throw new Error('WebGL 2 is unavailable');

  const renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10);
  camera.position.set(0, 1.28, 4);
  camera.lookAt(0, .88, 0);
  const character = new THREE.Group();
  scene.add(character, new THREE.HemisphereLight(0xfff5e1, 0x8695a6, 2.5));

  const key = new THREE.DirectionalLight(0xffe8cb, 2.2);
  key.position.set(-2, 3.5, 4);
  const rim = new THREE.DirectionalLight(0xd5e7ff, 1.25);
  rim.position.set(2, 2.5, -3);
  scene.add(key, rim);

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(.52, .55, .075, 64), [
    new THREE.MeshStandardMaterial({ color: 0x625039, roughness: .58, metalness: .22 }),
    new THREE.MeshStandardMaterial({ color: 0x2f3032, roughness: .85 }),
    new THREE.MeshStandardMaterial({ color: 0x222426, roughness: .82 }),
  ]);
  plinth.position.y = -.039;
  scene.add(plinth);

  const loader = new GLTFLoader();
  const events = new AbortController();
  let model: THREE.Object3D | undefined;
  let frame: number | undefined;
  let previous = 0;
  let playing = false;
  let visible = true;
  let ended = false;
  let lost = false;

  function draw() {
    if (!ended && !lost) renderer.render(scene, camera);
  }

  function syncLoop() {
    const shouldPlay = playing && visible && !document.hidden && Boolean(model) && !ended && !lost;
    if (shouldPlay && frame === undefined) {
      previous = performance.now();
      frame = requestAnimationFrame(tick);
    } else if (!shouldPlay && frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }
  }

  function tick(time: number) {
    character.rotation.y = (character.rotation.y + Math.min((time - previous) / 1000, .1) * Math.PI * 2 / TURN_SECONDS) % (Math.PI * 2);
    previous = time;
    draw();
    frame = requestAnimationFrame(tick);
  }

  function resize() {
    const { clientWidth: width, clientHeight: height } = host;
    if (!width || !height || ended || lost) return;
    const aspect = width / height;
    const halfHeight = Math.max(1.09, .65 / aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.bottom = -halfHeight;
    camera.top = halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    draw();
  }

  const size = new ResizeObserver(resize);
  size.observe(host);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting);
    syncLoop();
  });
  intersection.observe(host);
  document.addEventListener('visibilitychange', syncLoop, { signal: events.signal });
  canvas.addEventListener('webglcontextlost', () => {
    lost = true;
    syncLoop();
    onContextLost();
  }, { signal: events.signal });
  resize();

  function removeModel() {
    if (!model) return;
    character.remove(model);
    disposeScene(model);
    model = undefined;
  }

  return {
    async show(asset: string, signal: AbortSignal) {
      removeModel();
      syncLoop();
      const response = await fetch(ASSET_ROOT + asset, { signal });
      if (!response.ok) throw new Error('Avatar model is unavailable');
      const bytes = await response.arrayBuffer();
      if (signal.aborted || ended || lost) return;
      const { scene: next, animations } = await loader.parseAsync(bytes, ASSET_ROOT);
      if (signal.aborted || ended || lost) { disposeScene(next); return; }

      // Sample the game's idle pose so rotating reveals the outfit at rest.
      const idle = THREE.AnimationClip.findByName(animations, 'Idle');
      if (idle) {
        const mixer = new THREE.AnimationMixer(next);
        mixer.clipAction(idle).play();
        mixer.setTime(.3);
      }
      next.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(next, true);
      const height = bounds.max.y - bounds.min.y;
      if (!Number.isFinite(height) || height <= 0) {
        disposeScene(next);
        throw new Error('Avatar has no visible geometry');
      }
      const center = bounds.getCenter(new THREE.Vector3());
      const scale = 1.72 / height;
      const pivot = new THREE.Group();
      pivot.scale.setScalar(scale);
      pivot.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
      pivot.add(next);
      model = pivot;
      character.add(model);
      character.rotation.y = 0;
      draw();
      syncLoop();
    },
    rotate(radians: number) {
      character.rotation.y = (character.rotation.y + radians) % (Math.PI * 2);
      draw();
    },
    play(active: boolean) {
      playing = active;
      syncLoop();
    },
    dispose() {
      ended = true;
      syncLoop();
      events.abort();
      size.disconnect();
      intersection.disconnect();
      removeModel();
      disposeScene(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
