import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createAgentPatrol, type AgentPhase, type RoutePoint } from './agent';

export type View = 'overview' | 'follow';
export type AgentStatus = AgentPhase | 'loading' | 'unavailable';
type RouteData = { points: RoutePoint[]; target: RoutePoint };
type Callbacks = {
  ready: (elapsedMs: number) => void;
  fallback: () => void;
  agent: (status: AgentStatus, percent: number) => void;
  fps: (value: number) => void;
};

export type WalkController = {
  view: (mode: View) => void;
  zoom: (factor: number) => void;
  play: (enabled: boolean) => void;
  reset: () => void;
  dispose: () => void;
};

const START_YAW = 0.23;
const START_PITCH = 0.88;
const START_DISTANCE = 115;
const FOLLOW_YAW = -2.54;
const FOLLOW_PITCH = 0.39;
const FOLLOW_DISTANCE = 5.6;
const ASSET_PATH = '/nexciv-walk/';

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

export function createWalk(host: HTMLDivElement, initialView: View, autoPlay: boolean, callbacks: Callbacks): WalkController {
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
  const aim = new THREE.Vector3();
  const tween = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointers = new Map<number, { x: number; y: number }>();
  const aborter = new AbortController();
  let ended = false;
  let contextLost = false;
  let model: THREE.Object3D | undefined;
  let actor: GLTF | undefined;
  let patrol: ReturnType<typeof createAgentPatrol> | undefined;
  let route: RouteData | undefined;
  let updateDetail = (_level: number) => {};
  let mode: View = initialView;
  let playing = autoPlay;
  let orbitYaw = START_YAW;
  let orbitPitch = START_PITCH;
  let desiredDistance = START_DISTANCE;
  let orbitDistance = START_DISTANCE;
  let followYaw = FOLLOW_YAW;
  let followPitch = FOLLOW_PITCH;
  let followDistance = FOLLOW_DISTANCE;
  let followHeight: number | undefined;
  let shownPhase: AgentPhase | undefined;
  let shownProgress = -1;
  let measurements = 0;
  let measuredAt = performance.now();
  let lastFrame = measuredAt;
  let frameId = 0;

  function resize() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, width <= 600 ? 1.25 : 1.6));
    renderer.setSize(width, height, false);
  }

  function zoom(factor: number) {
    if (mode === 'follow' && patrol) followDistance = THREE.MathUtils.clamp(followDistance * factor, 3.6, 9.5);
    else desiredDistance = THREE.MathUtils.clamp(desiredDistance * factor, 24, 139);
  }

  function setView(next: View) {
    mode = next;
    followHeight = undefined;
  }

  function connectAgent() {
    if (!model || !route || !actor || patrol || ended || contextLost) return;
    try {
      patrol = createAgentPatrol(actor, route.points);
      scene.add(patrol.root);
    } catch {
      disposeModel(actor.scene);
      actor = undefined;
      callbacks.agent('unavailable', 0);
    }
  }

  function animate(now: number) {
    if (ended || contextLost || !model) return;
    const dt = document.hidden ? 0 : Math.min((now - lastFrame) / 1000, 0.075);
    lastFrame = now;
    measurements++;
    if (now - measuredAt >= 1200) {
      callbacks.fps(Math.round(measurements * 1000 / (now - measuredAt)));
      measurements = 0;
      measuredAt = now;
    }

    if (patrol) {
      if (playing) patrol.advance(dt);
      if (shownPhase !== patrol.phase || shownProgress !== patrol.progress) {
        shownPhase = patrol.phase;
        shownProgress = patrol.progress;
        callbacks.agent(shownPhase, shownProgress);
      }
    }

    if (mode === 'follow' && patrol) {
      fog.near = 48;
      fog.far = 139;
      const feet = patrol.root.position;
      followHeight = followHeight === undefined || !tween ? feet.y : THREE.MathUtils.damp(followHeight, feet.y, 12, dt);
      aim.set(feet.x, followHeight + 0.94, feet.z);
      // Frame the shop from the street side as the Agent passes the entrance tree.
      const streetSide = THREE.MathUtils.smoothstep(feet.z, 47, 56);
      const yaw = followYaw + streetSide * 1.14;
      camera.position.set(
        aim.x + followDistance * Math.sin(yaw) * Math.cos(followPitch),
        aim.y + followDistance * Math.sin(followPitch),
        aim.z + followDistance * Math.cos(yaw) * Math.cos(followPitch),
      );
      camera.lookAt(aim);
      updateDetail(1);
    } else {
      fog.near = 110;
      fog.far = 235;
      orbitDistance = tween ? THREE.MathUtils.damp(orbitDistance, desiredDistance, 11, dt) : desiredDistance;
      const distance = orbitDistance * (camera.aspect < 0.8 ? 1.09 : 1);
      camera.position.set(
        focus.x + distance * Math.sin(orbitYaw) * Math.cos(orbitPitch),
        focus.y + distance * Math.sin(orbitPitch),
        focus.z + distance * Math.cos(orbitYaw) * Math.cos(orbitPitch),
      );
      camera.lookAt(focus);
      updateDetail(1 - THREE.MathUtils.smoothstep(orbitDistance, 33, 71));
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
    if (mode === 'follow' && patrol) {
      followYaw -= dx * 0.006;
      followPitch = THREE.MathUtils.clamp(followPitch - dy * 0.006, 0.16, 1.18);
    } else {
      orbitYaw -= dx * 0.006;
      orbitPitch = THREE.MathUtils.clamp(orbitPitch - dy * 0.006, 0.48, 1.45);
    }
  }

  function onPointerEnd(event: PointerEvent) {
    pointers.delete(event.pointerId);
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    zoom(Math.exp(THREE.MathUtils.clamp(event.deltaY * 0.0012, -0.24, 0.24)));
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    contextLost = true;
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
  resize();

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  async function request(name: string) {
    const response = await fetch(`${ASSET_PATH}${name}`, { signal });
    if (!response.ok) throw new Error(`Missing preview asset ${name}`);
    return response;
  }

  request('agent-01.glb').then((response) => response.arrayBuffer()).then(async (bytes) => {
    if (ended || contextLost) return;
    const result = await loader.parseAsync(bytes, ASSET_PATH);
    if (ended || contextLost) { disposeModel(result.scene); return; }
    actor = result;
    connectAgent();
  }).catch(() => {
    if (!ended && !contextLost) callbacks.agent('unavailable', 0);
  });

  Promise.all([
    request('route.json').then((response) => response.json() as Promise<RouteData>),
    request('nexus-market.glb').then((response) => response.arrayBuffer()),
  ]).then(async ([layout, bytes]) => {
    if (ended || contextLost) return;
    const result = await loader.parseAsync(bytes, ASSET_PATH);
    if (ended || contextLost) { disposeModel(result.scene); return; }
    route = layout;
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
    connectAgent();
    renderer.shadowMap.needsUpdate = true;
    lastFrame = measuredAt = performance.now();
    animate(lastFrame);
    callbacks.ready(performance.now() - started);
  }).catch(() => {
    if (!ended && !contextLost) callbacks.fallback();
  });

  return {
    view: setView,
    zoom,
    play(enabled) { playing = enabled; },
    reset() {
      orbitYaw = START_YAW;
      orbitPitch = START_PITCH;
      orbitDistance = desiredDistance = START_DISTANCE;
      followYaw = FOLLOW_YAW;
      followPitch = FOLLOW_PITCH;
      followDistance = FOLLOW_DISTANCE;
    },
    dispose() {
      ended = true;
      aborter.abort();
      cancelAnimationFrame(frameId);
      sizeObserver.disconnect();
      patrol?.dispose();
      if (actor) disposeModel(actor.scene);
      if (model) disposeModel(model);
      sun.shadow.dispose();
      environment.dispose();
      renderer.forceContextLoss();
      renderer.dispose();
      canvas.remove();
    },
  };
}
