import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

type View = 'overview' | 'walk';
type RouteData = { points: [number, number, number][]; target: [number, number, number] };
type Callbacks = {
  ready: (elapsedMs: number) => void;
  fallback: () => void;
  progress: (percent: number) => void;
  fps: (value: number) => void;
};

export type WalkController = {
  view: (mode: View) => void;
  zoom: (factor: number) => void;
  step: (direction: number) => void;
  seek: (percent: number) => void;
  reset: () => void;
  dispose: () => void;
};

const START_YAW = 0.23;
const START_PITCH = 0.88;
const START_DISTANCE = 115;
const EYE_HEIGHT = 1.72;
const WALK_METRES_PER_SECOND = 1.9;

function markDistances(points: RouteData['points']) {
  let length = 0;
  let previous: THREE.Vector3 | undefined;
  return points.map((point) => {
    const position = new THREE.Vector3(...point);
    if (previous) length += position.distanceTo(previous);
    previous = position;
    return { position, distance: length };
  });
}

function installDetailFade(root: THREE.Object3D) {
  const batch = root.getObjectByName('NEXCIV_detail') ?? root.getObjectByName('NEXCIV detail');
  const visibility = { value: 0 };
  batch?.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
    const copies = materials.map((source) => {
      const material = source.clone();
      material.onBeforeCompile = (shader) => {
        shader.uniforms.detailVisibility = visibility;
        shader.fragmentShader = 'uniform float detailVisibility;\n' + shader.fragmentShader.replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          vec2 grid = mod(gl_FragCoord.xy, 4.0);
          float threshold = fract(dot(grid, vec2(0.5, 0.25)) + floor(grid.x * 0.5) * 0.125 + floor(grid.y * 0.5) * 0.0625);
          if (threshold >= detailVisibility) discard;`,
        );
      };
      material.customProgramCacheKey = () => 'nexciv-detail-coverage';
      return material;
    });
    object.material = Array.isArray(object.material) ? copies : copies[0];
  });
  return (level: number) => {
    visibility.value = level;
    if (batch) batch.visible = level > 0.001;
  };
}

function disposeModel(asset: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  const maps = new Set<THREE.Texture>();
  const meshes = new Set<THREE.BufferGeometry>();
  asset.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes.add(object.geometry);
    const list: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      materials.add(material);
      for (const property of Object.values(material)) {
        if (property instanceof THREE.Texture) maps.add(property);
      }
    }
  });
  for (const material of materials) material.dispose();
  for (const map of maps) map.dispose();
  for (const mesh of meshes) mesh.dispose();
}

export function createWalk(host: HTMLDivElement, callbacks: Callbacks): WalkController {
  const started = performance.now();
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', '可拖动与缩放的 NEXCIV 街区');
  canvas.tabIndex = 0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  host.append(canvas);

  const scene = new THREE.Scene();
  const sky = new THREE.Color('#837574');
  scene.background = sky;
  const fog = new THREE.Fog(sky, 110, 235);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(49, 1, 0.18, 235);
  const ambient = new THREE.HemisphereLight('#b5ceff', '#81705a', 0.97);
  const sun = new THREE.DirectionalLight('#ffc481', 2.14);
  sun.position.set(-43, 33, 62);
  sun.target.position.set(0, 0, 22);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 53, bottom: -53, near: 4, far: 120 });
  sun.shadow.mapSize.setScalar(host.clientWidth <= 600 ? 1024 : 2048);
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.033;
  scene.add(ambient, sun, sun.target);
  const marketLamp = new THREE.PointLight('#ffc478', 180, 15, 2);
  marketLamp.position.set(13.6, 3.2, 54.1);
  scene.add(marketLamp);

  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = generator.fromScene(room, 0.05);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.28;
  room.dispose();
  generator.dispose();

  const focus = new THREE.Vector3(0, 0, 24);
  const eye = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const look = new THREE.Vector3();
  const tween = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointers = new Map<number, { x: number; y: number }>();
  const keys = new Set<string>();
  const aborter = new AbortController();
  let ended = false;
  let model: THREE.Object3D | undefined;
  let updateDetail = (_level: number) => {};
  let points: ReturnType<typeof markDistances> = [];
  let length = 0;
  let mode: View = 'overview';
  let orbitYaw = START_YAW;
  let orbitPitch = START_PITCH;
  let desiredDistance = START_DISTANCE;
  let orbitDistance = START_DISTANCE;
  let travel = 0;
  let desiredTravel = 0;
  let yawOffset = 0;
  let headTilt = -0.015;
  let eyeHeight: number | undefined;
  let shownProgress = 0;
  let measurements = 0;
  let measuredAt = performance.now();
  let lastFrame = measuredAt;
  let frameId = 0;

  function positionAt(at: number, out: THREE.Vector3) {
    if (at >= length) return out.copy(points.at(-1)!.position);
    const next = points.findIndex((point) => point.distance > at);
    const from = points[next - 1]!;
    const to = points[next]!;
    return out.lerpVectors(from.position, to.position, (at - from.distance) / (to.distance - from.distance));
  }

  function resize() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, width <= 600 ? 1.25 : 1.6));
    renderer.setSize(width, height, false);
  }

  function zoom(factor: number) {
    if (mode === 'overview') desiredDistance = THREE.MathUtils.clamp(desiredDistance * factor, 24, 139);
  }

  function setView(next: View) {
    if (mode !== next) {
      keys.clear();
      yawOffset = 0;
      headTilt = -0.015;
      eyeHeight = undefined;
      mode = next;
      fog.near = next === 'walk' ? 48 : 130;
      fog.far = next === 'walk' ? 139 : 230;
    }
  }

  function animate(now: number) {
    if (ended || !model) return;
    const dt = Math.min((now - lastFrame) / 1000, 0.075);
    lastFrame = now;
    measurements++;
    if (now - measuredAt >= 1200) {
      callbacks.fps(Math.round(measurements * 1000 / (now - measuredAt)));
      measurements = 0;
      measuredAt = now;
    }

    if (mode === 'overview') {
      orbitDistance = tween ? THREE.MathUtils.damp(orbitDistance, desiredDistance, 11, dt) : desiredDistance;
      const distance = orbitDistance * (camera.aspect < 0.8 ? 1.09 : 1);
      camera.position.set(
        focus.x + distance * Math.sin(orbitYaw) * Math.cos(orbitPitch),
        focus.y + distance * Math.sin(orbitPitch),
        focus.z + distance * Math.cos(orbitYaw) * Math.cos(orbitPitch),
      );
      camera.lookAt(focus);
      updateDetail(1 - THREE.MathUtils.smoothstep(orbitDistance, 33, 71));
    } else {
      const forward = keys.has('w') || keys.has('arrowup');
      const backward = keys.has('s') || keys.has('arrowdown');
      if (forward !== backward) {
        const speed = forward ? WALK_METRES_PER_SECOND : -WALK_METRES_PER_SECOND;
        desiredTravel = THREE.MathUtils.clamp(desiredTravel + speed * dt, 0, length);
      }
      travel = tween ? THREE.MathUtils.damp(travel, desiredTravel, 15, dt) : desiredTravel;
      if (Math.abs(travel - desiredTravel) < 0.015) travel = desiredTravel;
      positionAt(travel, eye);
      look.copy(positionAt(Math.min(length, travel + 2.2), aim)).sub(eye);
      const approach = THREE.MathUtils.smoothstep(travel, length - 3.2, length - 0.25);
      if (approach > 0) look.lerp(aim.set(13.70, eye.y, 54.91).sub(eye), approach);
      const yaw = Math.atan2(look.x, look.z) + yawOffset;
      const ground = eye.y + EYE_HEIGHT;
      eyeHeight = eyeHeight === undefined || !tween ? ground : THREE.MathUtils.damp(eyeHeight, ground, 12, dt);
      camera.position.set(eye.x, eyeHeight, eye.z);
      aim.set(Math.sin(yaw), Math.tan(headTilt + approach * 0.13), Math.cos(yaw)).add(camera.position);
      camera.lookAt(aim);
      updateDetail(1);
      const percent = Math.round(100 * travel / length);
      if (shownProgress !== percent) {
        shownProgress = percent;
        callbacks.progress(percent);
      }
    }
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  }

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function onPointerMove(event: PointerEvent) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, next);
    if (pointers.size > 1) {
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const a = Math.hypot(previous.x - other.x, previous.y - other.y);
        const b = Math.hypot(next.x - other.x, next.y - other.y);
        if (a > 4 && b > 4) zoom(a / b);
      }
      return;
    }
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    if (mode === 'overview') {
      orbitYaw -= dx * 0.006;
      orbitPitch = THREE.MathUtils.clamp(orbitPitch - dy * 0.006, 0.48, 1.45);
    } else {
      yawOffset -= dx * 0.007;
      headTilt = THREE.MathUtils.clamp(headTilt + dy * 0.007, -0.83, 0.78);
    }
  }

  function onPointerEnd(event: PointerEvent) {
    pointers.delete(event.pointerId);
  }

  function onWheel(event: WheelEvent) {
    if (mode !== 'overview') return;
    event.preventDefault();
    zoom(Math.exp(THREE.MathUtils.clamp(event.deltaY * 0.0012, -0.24, 0.24)));
  }

  function onKey(event: KeyboardEvent) {
    if (mode !== 'walk' || /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement).tagName ?? '')) return;
    const key = event.key.toLowerCase();
    if (!['w', 's', 'arrowup', 'arrowdown'].includes(key)) return;
    if (event.type === 'keydown') {
      event.preventDefault();
      keys.add(key);
    } else {
      keys.delete(key);
    }
  }

  function clearKeys() {
    keys.clear();
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    cancelAnimationFrame(frameId);
    callbacks.fallback();
  }

  const { signal } = aborter;
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(host);
  canvas.addEventListener('pointerdown', onPointerDown, { signal });
  canvas.addEventListener('pointermove', onPointerMove, { signal });
  canvas.addEventListener('lostpointercapture', onPointerEnd, { signal });
  canvas.addEventListener('wheel', onWheel, { passive: false, signal });
  canvas.addEventListener('webglcontextlost', onContextLost, { signal });
  window.addEventListener('keydown', onKey, { signal });
  window.addEventListener('keyup', onKey, { signal });
  window.addEventListener('blur', clearKeys, { signal });
  resize();

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  Promise.all([
    fetch('/nexciv-walk/route.json', { signal }).then((response) => {
      if (!response.ok) throw new Error('Route unavailable');
      return response.json() as Promise<RouteData>;
    }),
    fetch('/nexciv-walk/nexus-market.glb', { signal }).then((response) => {
      if (!response.ok) throw new Error('Model unavailable');
      return response.arrayBuffer();
    }),
  ]).then(async ([route, bytes]) => {
    if (ended) return;
    const result = await loader.parseAsync(bytes, '/nexciv-walk/');
    if (ended) { disposeModel(result.scene); return; }
    points = markDistances(route.points);
    length = points.at(-1)?.distance ?? 0;
    if (length <= 0) { disposeModel(result.scene); throw new Error('Invalid walk route'); }
    focus.set(...route.target);
    model = result.scene;
    const paving = model.getObjectByName('NEXCIV_paving');
    const pavement = new Set<THREE.Object3D>();
    paving?.traverse((object) => pavement.add(object));
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const transparent = (Array.isArray(object.material) ? object.material : [object.material]).some((m) => m.transparent);
      object.castShadow = !transparent && object.name !== 'NEXCIV_terrain' && !pavement.has(object);
      object.receiveShadow = true;
    });
    updateDetail = installDetailFade(model);
    scene.add(model);
    renderer.shadowMap.needsUpdate = true;
    lastFrame = measuredAt = performance.now();
    animate(lastFrame);
    callbacks.ready(performance.now() - started);
  }).catch(() => {
    if (ended) return;
    callbacks.fallback();
  });

  return {
    view: setView,
    zoom,
    step(direction) {
      if (mode === 'walk') desiredTravel = THREE.MathUtils.clamp(desiredTravel + 2.7 * direction, 0, length);
    },
    seek(percent) { desiredTravel = THREE.MathUtils.clamp(percent / 100, 0, 1) * length; },
    reset() {
      setView('overview');
      orbitYaw = START_YAW;
      orbitPitch = START_PITCH;
      orbitDistance = desiredDistance = START_DISTANCE;
      travel = desiredTravel = shownProgress = 0;
      callbacks.progress(0);
    },
    dispose() {
      ended = true;
      aborter.abort();
      cancelAnimationFrame(frameId);
      sizeObserver.disconnect();
      if (model) disposeModel(model);
      sun.shadow.dispose();
      environment.dispose();
      renderer.forceContextLoss();
      renderer.dispose();
      canvas.remove();
    },
  };
}
