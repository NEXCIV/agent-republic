import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createAgentPatrol, type RoutePoint } from './agent';
import { CAFE_BENCH, CAFE_COUNTER, CAFE_HOST, CAFE_STALL, createCafePaving, joinCafeToPier } from './cafe-corner';
import { createMarketGreeting } from './marketGreeting';
import type { CafeSnapshot } from '../../lib/cafe-life';
import { createFishingGear, FISHING_SPOT } from './fishing';
import { createNavigation, DESTINATION_FACING, placeAt, type AgentStart, type Connection, type EastRoutes, type Place, type ResidentId, type Visits } from './navigation';

export type District = 'east' | 'west' | 'shore' | 'research' | 'residential';
export type View = 'overview' | 'follow' | District;
export type DistrictStatus = 'idle' | 'loading' | 'ready' | 'unavailable';
export type AgentId = ResidentId;
type Activity = 'outbound' | 'arrived' | 'greeting';
export type AgentStatus = Activity | 'loading' | 'unavailable';
export type AgentReport = { status: AgentStatus; progress: number; from?: Place; destination?: Place };
type RouteData = Connection & { target: RoutePoint };
type Patrol = ReturnType<typeof createAgentPatrol>;
type ActiveAgent = {
  asset: GLTF;
  patrol: Patrol;
  from: Place;
  destination: Place;
  visits: Visits;
  lookAt: THREE.Vector3;
  reported?: AgentReport;
};
type Callbacks = {
  ready: (elapsedMs: number) => void;
  fallback: () => void;
  agent: (id: AgentId, report: AgentReport) => void;
  district: (side: District, status: DistrictStatus) => void;
  overview: (status: DistrictStatus) => void;
  fps: (value: number) => void;
};

export type WalkController = {
  syncCafe: (snapshot: CafeSnapshot | null) => void;
  view: (mode: View, id?: AgentId) => void;
  zoom: (factor: number) => void;
  play: (enabled: boolean) => void;
  reset: () => void;
  dispose: () => void;
};

const START_YAW = 0.23;
const START_PITCH = 0.88;
const START_DISTANCE = 115;
const EXPANDED_PITCH = 1.08;
const EXPANDED_DISTANCE = 166;
const CITYWIDE_FILE = 'nexciv-city-overview.glb';
const CITYWIDE_DISTANCE = 382;
const CITYWIDE_PITCH = 0.99;
const DISTRICT_ORBIT: Record<District, [yaw: number, pitch: number, distance: number]> = {
  east: [START_YAW, 1.02, 143],
  west: [-0.18, 1.02, 130],
  shore: [START_YAW, 0.76, 169],
  research: [0.62, 0.84, 94],
  residential: [-0.44, 0.84, 94],
};
const DISTRICT_FILES: Record<District, [string, string]> = {
  east: ['east-routes.json', 'east-civic-district.glb'],
  west: ['west-route.json', 'west-community-district.glb'],
  shore: ['lakeshore-route.json', 'north-lakeshore.glb'],
  research: ['research-route.json', 'northwest-research-district.glb'],
  residential: ['residential-route.json', 'northeast-garden-residences.glb'],
};
const FOLLOW_YAW = -2.54;
const FOLLOW_PITCH = 0.39;
const FOLLOW_DISTANCE = 5.6;
const ASSET_PATH = '/nexciv-walk/';
const RETAIL_PREFIX = 'HI3DGardenRoofRetail';
const RETAIL_DETAIL = 'garden-roof-retail-detail.glb';
const DETAIL_FILES = {
  street: 'nexus-street-detail.glb',
  market: 'corner-market-detail.glb',
  registry: 'citizen-registry-detail.glb',
  works: 'public-construction-detail.glb',
  center: 'research-agent-center-detail.glb',
  hall: 'governance-hall-detail.glb',
};
type Detail = keyof typeof DETAIL_FILES;
const LANDMARK_DETAILS = ['registry', 'works', 'center', 'hall'] as const;

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

function prepareEnvironment(asset: THREE.Object3D, anisotropy = 1) {
  const pavement = new Set<THREE.Object3D>();
  asset.getObjectByName('NEXCIV_paving')?.traverse((object) => pavement.add(object));
  asset.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const terrain = object.name === 'NEXCIV_terrain' || object.userData.previewTier === 'land';
    object.castShadow = !materials.some((material) => material.transparent) && !terrain && !pavement.has(object);
    object.receiveShadow = true;
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial) || !material.map) continue;
      material.map.anisotropy = Math.max(anisotropy, material.map.anisotropy);
    }
  });
}

function createStreetSky(horizon: THREE.Color) {
  const zenith = new THREE.Color('#526887');
  const lower = new THREE.Color('#535454');
  const sample = new THREE.Color();
  const height = 128;
  const pixels = new Uint8Array(4 * height * 4);
  for (let row = 0; row < height; row++) {
    const elevation = -Math.cos(Math.PI * (row + 0.5) / height);
    sample.copy(horizon).lerp(elevation > 0 ? zenith : lower, THREE.MathUtils.smoothstep(Math.abs(elevation), 0, 0.68));
    sample.getRGB(sample, THREE.SRGBColorSpace);
    for (let column = 0; column < 4; column++) {
      pixels.set([sample.r * 255, sample.g * 255, sample.b * 255, 255], (row * 4 + column) * 4);
    }
  }
  const sky = new THREE.DataTexture(pixels, 4, height);
  sky.mapping = THREE.EquirectangularReflectionMapping;
  sky.colorSpace = THREE.SRGBColorSpace;
  sky.magFilter = THREE.LinearFilter;
  sky.minFilter = THREE.LinearFilter;
  sky.needsUpdate = true;
  return sky;
}

function isGardenRetail(object: THREE.Object3D) {
  return object.name.replace(/[^a-z0-9]/gi, '').startsWith(RETAIL_PREFIX);
}

function softenRetailWindows(asset: THREE.Object3D) {
  asset.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !isGardenRetail(object)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof THREE.MeshStandardMaterial && material.emissiveMap) {
        material.emissiveIntensity = Math.min(material.emissiveIntensity, 0.65);
      }
    }
  });
}

function addLakeRipples(asset: THREE.Object3D, time: { value: number }) {
  asset.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.previewTier !== 'water') return;
    object.castShadow = false;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      material.customProgramCacheKey = () => 'nexciv-lake';
      material.onBeforeCompile = (shader) => {
        shader.uniforms.lakeTime = time;
        shader.vertexShader = 'varying vec2 vLakePosition;\n' + shader.vertexShader.replace(
          '#include <project_vertex>',
          'vLakePosition = (modelMatrix * vec4(transformed, 1.0)).xz;\n#include <project_vertex>',
        );
        shader.fragmentShader = 'varying vec2 vLakePosition;\nuniform float lakeTime;\n' + shader.fragmentShader.replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          float bend = sin(dot(vLakePosition, vec2(0.36, 0.18)) + lakeTime * 0.14);
          float waveA = dot(vLakePosition, vec2(2.3, 5.4)) + 2.1 * bend + lakeTime * 0.95;
          float waveB = dot(vLakePosition, vec2(-1.5, 2.7)) - 1.3 * bend - lakeTime * 0.61;
          float footprint = max(fwidth(waveA), fwidth(waveB));
          float ripple = (1.0 - smoothstep(19.0, 94.0, length(vViewPosition))) * (1.0 - smoothstep(0.35, 1.6, footprint));
          vec3 slope = vec3(0.077 * cos(waveA), 0.0, 0.09 * cos(waveB));
          normal = normalize(normal + mat3(viewMatrix) * slope * ripple);
          diffuseColor.rgb *= 1.0 + 0.018 * (sin(waveA) + sin(waveB)) * ripple;`,
        );
      };
    }
  });
}

function addCenterNameplate(asset: THREE.Object3D) {
  let building: THREE.Object3D | undefined;
  asset.traverse((object) => {
    if (!building && object.userData.previewTier === 'center_proxy') building = object;
  });
  if (!building) return;
  const face = document.createElement('canvas');
  face.width = 1024;
  face.height = 184;
  const brush = face.getContext('2d');
  if (!brush) return;
  brush.fillStyle = '#462c46';
  brush.fillRect(0, 0, face.width, face.height);
  brush.strokeStyle = '#b69066';
  brush.lineWidth = 3;
  brush.beginPath();
  brush.roundRect(18, 17, 988, 150, 22);
  brush.stroke();

  brush.fillStyle = '#f5e2bc';
  brush.beginPath();
  brush.roundRect(107, 61, 116, 66, 16);
  brush.fill();
  brush.fillRect(162, 48, 6, 16);
  brush.beginPath();
  brush.arc(165, 45, 7, 0, Math.PI * 2);
  brush.fill();
  brush.fillStyle = '#462c46';
  brush.beginPath();
  brush.roundRect(117, 71, 96, 46, 12);
  brush.fill();
  brush.fillStyle = '#f5e2bc';
  for (const x of [146, 184]) {
    brush.beginPath();
    brush.arc(x, 94, 6, 0, Math.PI * 2);
    brush.fill();
  }
  brush.textBaseline = 'middle';
  brush.font = '700 72px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  brush.fillText('AGENT 中心', 305, 81, 590);
  brush.font = '600 26px system-ui, sans-serif';
  brush.fillText('NEXCIV', 308, 132);

  const texture = new THREE.CanvasTexture(face);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(2.36, 0.425, 0.065),
    new THREE.MeshStandardMaterial({ color: '#402640', roughness: 0.5 }),
  );
  frame.name = 'NEXCIV_Agent_Center_Nameplate';
  frame.position.set(2.325, 1.566, 0);
  frame.rotation.y = Math.PI / 2;
  const lettering = new THREE.Mesh(
    new THREE.PlaneGeometry(2.345, 0.42),
    new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.72,
      emissiveMap: texture,
      emissive: '#ffffff',
      emissiveIntensity: 0.15,
    }),
  );
  lettering.position.z = 0.033;
  frame.add(lettering);
  building.add(frame);
  // Keep the source placement, including its scale, when the near mesh replaces the district mesh.
  asset.attach(frame);
}

export function createWalk(host: HTMLDivElement, initialView: View, autoPlay: boolean, callbacks: Callbacks, cafeMode = false): WalkController {
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
  const streetAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  host.append(canvas);

  const scene = new THREE.Scene();
  const street = new THREE.Group();
  scene.add(street);
  const citySky = new THREE.Color('#837574');
  const horizon = new THREE.Color('#aa8e7b');
  const streetSky = createStreetSky(horizon);
  scene.background = streetSky;
  const fog = new THREE.Fog(horizon, 110, 235);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(49, 1, 0.18, 285);
  const ambient = new THREE.HemisphereLight('#b5ceff', '#81705a', 0.84);
  const sun = new THREE.DirectionalLight('#ffbb78', 2.35);
  const sunOffset = new THREE.Vector3(-105, 73, 71);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { near: 5, far: 320 });
  sun.shadow.mapSize.setScalar(host.clientWidth <= 600 ? 1024 : 2048);
  sun.shadow.bias = -0.00016;
  scene.add(ambient, sun, sun.target);
  const sunset = new THREE.DirectionalLight('#ffb56e', 2.65);
  sunset.position.set(-210, 145, 120);
  sunset.target.position.set(0, 0, -22);
  sunset.castShadow = true;
  sunset.visible = false;
  Object.assign(sunset.shadow.camera, { left: -248, right: 248, top: 236, bottom: -230, near: 4, far: 645 });
  sunset.shadow.camera.updateProjectionMatrix();
  sunset.shadow.mapSize.setScalar(2048);
  sunset.shadow.bias = -0.00038;
  sunset.shadow.normalBias = 0.10;
  scene.add(sunset, sunset.target);
  const marketLamp = new THREE.PointLight('#ffc478', 180, 15, 2);
  marketLamp.position.set(13.6, 3.2, 54.1);
  street.add(marketLamp);

  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = generator.fromScene(room, 0.05);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.28;
  room.dispose();
  generator.dispose();

  const focus = new THREE.Vector3(0, 0, 24);
  const citywideFocus = new THREE.Vector3(0, 0, 9);
  const districtFocus: Record<District, THREE.Vector3> = {
    east: new THREE.Vector3(83, 0, 44),
    west: new THREE.Vector3(-83, 0, 61),
    shore: new THREE.Vector3(4, 0, -178),
    research: new THREE.Vector3(-93, 0, -65),
    residential: new THREE.Vector3(94, 0, -64),
  };
  const residenceEntrance = new THREE.Vector3(95, 1, -55.15);
  const pierEntrance = new THREE.Vector3(71, 0.09, -190);
  const lakeTime = { value: 0 };
  const forumEntrance = new THREE.Vector3(-94, 1, 75);
  const viewFocus = focus.clone();
  const aim = new THREE.Vector3();
  const marketEntrance = new THREE.Vector3();
  const counter = new THREE.Vector3(...CAFE_COUNTER);
  const coworker = new THREE.Vector3(...CAFE_HOST);
  const seat = new THREE.Vector3(...CAFE_BENCH);
  const seatedHips = seat.clone().add(new THREE.Vector3(0, 0, -0.16));
  const seatFront = seat.clone().add(new THREE.Vector3(0, 0, -0.65));
  const counterFacing = new THREE.Vector3(...CAFE_STALL);
  const seatFacing = seatFront.clone().add(new THREE.Vector3(0, 0, -1));
  const observedPosition = new THREE.Vector3();
  const cafeProps = new THREE.Group();
  let cafeSnapshot: CafeSnapshot | null = null;
  const fishingGear = cafeMode ? createFishingGear() : undefined;
  const fishingSpot = new THREE.Vector3(...FISHING_SPOT);
  const waterFacing = fishingSpot.clone().add(new THREE.Vector3(1, 0, 0));
  const interviewSpot = pierEntrance.clone();
  const regularPosition = pierEntrance.clone().add(new THREE.Vector3(1.25, 0, 0.65));
  let pierRegular: { asset: GLTF; patrol: Patrol } | undefined;
  let regularRequested = false;
  let pierRoute: RoutePoint[] | undefined;
  let pierJourney: { traveller: Patrol; startedAt: number } | undefined;
  let receivedAt = 0;
  const eastEntrances = {
    registry: new THREE.Vector3(80, 1, -14),
    works: new THREE.Vector3(95, 1, 72),
  };
  const centerEntrance = new THREE.Vector3(-92.35, 1.6, -64.6);
  const landmarkEntrances = { ...eastEntrances, center: centerEntrance, hall: new THREE.Vector3(0, 1.8, -82) };
  const streetFrustum = new THREE.Frustum();
  const worksBounds = new THREE.Box3();
  const viewProjection = new THREE.Matrix4();
  const retailPlacements: { mid: THREE.Object3D; bounds: THREE.Sphere; close?: THREE.Object3D }[] = [];
  const tween = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointers = new Map<number, { x: number; y: number }>();
  const aborter = new AbortController();
  let ended = false;
  let contextLost = false;
  let model: THREE.Object3D | undefined;
  let citywide: THREE.Object3D | undefined;
  let overviewStatus: DistrictStatus = 'idle';
  let north: THREE.Object3D | undefined;
  let northLoading: Promise<void> | undefined;
  let northFailed = false;
  const districts: Record<District, { asset?: THREE.Object3D; pending?: Promise<void>; status: DistrictStatus }> = {
    east: { status: 'idle' },
    west: { status: 'idle' },
    shore: { status: 'idle' },
    research: { status: 'idle' },
    residential: { status: 'idle' },
  };
  const details = new Map<Detail, THREE.Object3D>();
  const requestedDetails = new Set<Detail>();
  let retailSource: THREE.Object3D | undefined;
  let retailTemplate: THREE.Object3D | undefined;
  let retailRequested = false;
  const proxies = new Map<Detail, THREE.Object3D[]>();
  let actor: GLTF | undefined;
  let actorLoading = true;
  const agents = new Map<AgentId, ActiveAgent>();
  const navigation = createNavigation();
  const marketGreeting = createMarketGreeting();
  let marketGuest: { asset: GLTF; patrol: Patrol } | undefined;
  let marketGuestRequested = false;
  let greetingFraming = 0;
  let followed: AgentId = '01';
  let route: RouteData | undefined;
  let mode: View = initialView;
  let playing = autoPlay;
  let orbitYaw = START_YAW;
  let orbitPitch = START_PITCH;
  let desiredDistance = START_DISTANCE;
  let orbitDistance = START_DISTANCE;
  let followYaw = 0;
  let followPitch = FOLLOW_PITCH;
  let followDistance = FOLLOW_DISTANCE;
  let followHeight: number | undefined;
  let measurements = 0;
  let measuredAt = performance.now();
  let lastFrame = measuredAt;
  let frameId = 0;
  let firstCityFrame = 0;
  let shadowRadius = 0;

  function updateStreetShadow(focus: THREE.Vector3, close: boolean) {
    const radius = close ? 54 : 124;
    const step = close ? 14 : 44;
    const x = Math.round(focus.x / step) * step;
    const z = Math.round(focus.z / step) * step;
    if (radius === shadowRadius && sun.target.position.x === x && sun.target.position.z === z) return;
    sun.target.position.set(x, 0, z);
    sun.position.copy(sun.target.position).add(sunOffset);
    if (radius !== shadowRadius) {
      shadowRadius = radius;
      Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius });
      sun.shadow.camera.updateProjectionMatrix();
      sun.shadow.normalBias = close ? 0.045 : 0.08;
    }
    renderer.shadowMap.needsUpdate = true;
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
    if (mode === 'follow' && agents.has(followed)) followDistance = THREE.MathUtils.clamp(followDistance * factor, 3.6, 11.5);
    else if (mode === 'overview' && citywide) desiredDistance = THREE.MathUtils.clamp(desiredDistance * factor, 155, 465);
    else desiredDistance = THREE.MathUtils.clamp(desiredDistance * factor, 24, north || sideDistrictLoaded() ? 176 : 139);
  }

  function resetFollowCamera() {
    followYaw = 0;
    followPitch = followed === '03' ? 0.28 : FOLLOW_PITCH;
    followDistance = followed === '03' ? 7.4 : FOLLOW_DISTANCE;
    followHeight = undefined;
    greetingFraming = 0;
  }

  function sideDistrictLoaded() { return Boolean(districts.east.asset || districts.west.asset || districts.research.asset || districts.residential.asset); }

  function resetOrbit() {
    if (mode !== 'overview' && mode !== 'follow') {
      [orbitYaw, orbitPitch, desiredDistance] = DISTRICT_ORBIT[mode];
      return;
    }
    orbitYaw = citywide && mode === 'overview' ? 0.11 : START_YAW;
    orbitPitch = citywide && mode === 'overview' ? CITYWIDE_PITCH : north ? EXPANDED_PITCH : START_PITCH;
    desiredDistance = citywide && mode === 'overview' ? CITYWIDE_DISTANCE : north ? EXPANDED_DISTANCE : START_DISTANCE;
  }

  function setView(next: View, id = followed) {
    const viewChanged = mode !== next;
    if (id !== followed) {
      followed = id;
      resetFollowCamera();
    }
    mode = next;
    if (viewChanged && next !== 'follow') resetOrbit();
    followHeight = undefined;
    if (next === 'follow' && id === '03') loadNorth(true);
    if (next === 'overview') loadCitywide();
    if (next !== 'overview' && next !== 'follow') loadDistrict(next, true);
  }

  function attachAgent(id: AgentId, asset: GLTF, junction: AgentStart) {
    try {
      const from = placeAt(junction);
      const visits: Visits = {
        plaza: 0, market: 0, governance: 0, registry: 0, works: 0, forum: 0, pier: 0, center: 0, residence: 0,
      };
      visits[from] = 1;
      const choice = navigation.choose(id, junction, visits);
      if (!choice) throw new Error('No reachable observation destination');
      const [x, z] = DESTINATION_FACING[choice.destination];
      const patrol = createAgentPatrol(asset, choice.path.points, [x, z]);
      street.add(patrol.root);
      agents.set(id, { asset, patrol, from, destination: choice.destination, visits, lookAt: new THREE.Vector3(x, 0, z) });
    } catch {
      disposeModel(asset.scene);
      callbacks.agent(id, { status: 'unavailable', progress: 0 });
    }
  }

  function chooseNext(id: AgentId, agent: ActiveAgent) {
    const at = agent.destination;
    const visits = { ...agent.visits, [at]: agent.visits[at] + 1 };
    const choice = navigation.choose(id, at, visits);
    if (!choice) return;
    const [x, z] = DESTINATION_FACING[choice.destination];
    agent.patrol.plan(choice.path.points, [x, z]);
    agent.from = at;
    agent.destination = choice.destination;
    agent.lookAt.set(x, 0, z);
    agent.visits = visits;
  }

  function connectPrimary() {
    if (!model || !route || !actor || ended || contextLost) return;
    attachAgent('01', actor, 'plaza');
    actor = undefined;
  }

  function registerRetail(asset: THREE.Object3D) {
    asset.updateMatrixWorld(true);
    asset.traverse((object) => {
      if (!isGardenRetail(object)) return;
      const bounds = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
      retailPlacements.push({ mid: object, bounds });
    });
  }

  function registerProxies(asset: THREE.Object3D, kinds: Detail[]) {
    for (const kind of kinds) {
      const members: THREE.Object3D[] = [];
      asset.traverse((object) => {
        if (object.userData.previewTier === `${kind}_proxy`
          || (kind === 'hall' && object.name.startsWith('HERO_01_Governance_Hall'))) members.push(object);
      });
      proxies.set(kind, members);
      if (kind === 'works') {
        worksBounds.makeEmpty();
        for (const member of members) worksBounds.expandByObject(member);
      }
    }
  }

  function updateRetail() {
    if (!retailPlacements.length) return;
    for (const placement of retailPlacements) {
      const { mid, bounds } = placement;
      const distance = camera.position.distanceTo(bounds.center);
      const showing = placement.close?.visible ?? false;
      const near = distance < (showing ? 86 : 76);
      if (near && !showing && streetFrustum.intersectsSphere(bounds)) {
        if (!retailTemplate) {
          loadRetail();
          continue;
        }
        if (!placement.close) {
          const close = retailTemplate.clone();
          close.name = `${mid.name}_close`;
          close.matrix.copy(mid.matrixWorld);
          close.matrixAutoUpdate = false;
          street.add(close);
          placement.close = close;
        }
        mid.visible = false;
        placement.close.visible = true;
        renderer.shadowMap.needsUpdate = true;
      } else if (!near && showing && placement.close) {
        placement.close.visible = false;
        mid.visible = true;
        renderer.shadowMap.needsUpdate = true;
      }
    }
  }

  function animate(now: number) {
    if (ended || contextLost || !model) return;
    const dt = document.hidden ? 0 : Math.min((now - lastFrame) / 1000, 0.075);
    if (playing && tween && (districts.shore.asset || citywide)) lakeTime.value += dt;
    lastFrame = now;
    measurements++;
    if (now - measuredAt >= 1200) {
      callbacks.fps(Math.round(measurements * 1000 / (now - measuredAt)));
      measurements = 0;
      measuredAt = now;
    }

    const primaryAgent = agents.get('01');
    const primary = primaryAgent?.patrol;
    const greeting = marketGreeting(!cafeMode && playing ? dt : 0, !cafeMode && primaryAgent?.destination === 'market' ? primary : undefined, marketGuest?.patrol);
    const shift = cafeSnapshot?.run;
    const byPier = cafeMode && shift?.place === 'pier';
    const observer = shift?.observer;
    const interviewing = shift?.phase === 'interviewing';
    const travelling = shift?.phase === 'toPier' || shift?.phase === 'toCounter';
    const social = shift?.phase === 'inviting' || shift?.phase === 'chatting' || shift?.phase === 'reconnecting'
      || (interviewing && !byPier);
    if (cafeMode) {
      const poseDt = playing ? dt : 0;
      marketGuest?.patrol.observe(poseDt, coworker, counter, false, social ? 'nod' : undefined);
      const time = (cafeSnapshot?.serverTime ?? 0) + (playing ? now - receivedAt : 0);
      const duration = shift?.until ? shift.until - shift.since : 0;
      const progress = shift && duration > 0 ? THREE.MathUtils.clamp((time - shift.since) / duration, 0, 1) : 0;
      if ((shift?.requestedActivity === 'fish' || observer) && districts.shore.status === 'idle') loadDistrict('shore', true);
      if (observer && districts.shore.status === 'ready' && !regularRequested) {
        regularRequested = true;
        request('agent-03.glb').then((response) => response.arrayBuffer())
          .then((bytes) => loader.parseAsync(bytes, ASSET_PATH)).then((asset) => {
            if (ended || contextLost) { disposeModel(asset.scene); return; }
            try {
              const patrol = createAgentPatrol(asset, [pierEntrance.toArray(), regularPosition.toArray()], [interviewSpot.x, interviewSpot.z]);
              pierRegular = { asset, patrol };
              street.add(patrol.root);
            } catch (error) {
              disposeModel(asset.scene);
              throw error;
            }
          }).catch(() => { if (!ended && !contextLost) callbacks.fallback(); });
      }
      if (pierRegular) {
        pierRegular.patrol.root.visible = Boolean(observer);
        if (observer) pierRegular.patrol.observe(poseDt, regularPosition, interviewSpot, false, interviewing && byPier ? 'nod' : undefined);
      }
      const phase = shift?.phase;
      const fishing = phase === 'casting' || phase === 'fishing' || phase === 'reeling';
      if (!fishing) fishingGear?.hide();
      if (travelling && pierRoute && primary) {
        if (pierJourney?.traveller !== primary || pierJourney.startedAt !== shift.since) {
          const outbound = shift.phase === 'toPier';
          const path: RoutePoint[] = observer ? pierRoute : [...pierRoute, [...FISHING_SPOT]];
          const facing = outbound ? observer ? regularPosition : waterFacing : coworker;
          primary.plan(outbound ? path : [...path].reverse(), [facing.x, facing.z]);
          pierJourney = { traveller: primary, startedAt: shift.since };
        }
        primary.observeJourney(poseDt, progress, duration / 1000);
      } else if (byPier && pierRoute && primary) {
        if (observer) primary.observe(poseDt, interviewSpot, regularPosition);
        else {
          primary.observe(poseDt, fishingSpot, waterFacing);
          if (fishing) fishingGear?.update(primary.root, phase, progress, playing);
        }
      } else if (shift?.phase === 'walking') {
        observedPosition.lerpVectors(counter, seatFront, progress);
        primary?.observe(poseDt, observedPosition, seatFront, true);
      } else if (shift?.place === 'bench') {
        const sitting = shift.phase === 'resting';
        primary?.observe(poseDt, sitting ? seatedHips : seatFront, seatFacing, false, undefined, sitting);
      } else {
        primary?.observe(poseDt, counter, social ? coworker : counterFacing, false, shift?.phase === 'inviting' ? 'wave' : undefined);
      }
    } else if (playing) marketGuest?.patrol.advance(dt, greeting.visitor);
    for (const [id, agent] of agents) {
      const { patrol } = agent;
      const greetingHere = id === '01' && greeting.active;
      if (playing && !cafeMode) {
        const cue = greetingHere ? greeting.resident : { hold: 'end' as const, face: patrol.phase === 'arrived' ? agent.lookAt : undefined };
        patrol.advance(dt, cue);
        if (patrol.phase === 'arrived' && patrol.dwelledSeconds >= 4 && !greetingHere) chooseNext(id, agent);
      }
      const status: Activity = greetingHere ? 'greeting' : patrol.phase === 'arrived' ? 'arrived' : 'outbound';
      const { progress } = patrol;
      if (agent.reported?.status !== status || agent.reported.progress !== progress || agent.reported.destination !== agent.destination) {
        agent.reported = { status, progress, from: agent.from, destination: agent.destination };
        callbacks.agent(id, agent.reported);
      }
    }

    const patrol = agents.get(followed)?.patrol;
    const following = mode === 'follow' && patrol;
    const district = mode !== 'overview' && mode !== 'follow' ? districts[mode] : undefined;
    const wide = Boolean(citywide && (mode === 'overview'
      || (citywide.visible && (mode === 'follow' && !patrol
        || district && (district.status === 'loading' || orbitDistance > 192)))));
    if (citywide && citywide.visible !== wide) {
      citywide.visible = wide;
      street.visible = !wide;
      sunset.visible = wide;
      sun.visible = !wide;
      scene.background = wide ? citySky : streetSky;
      fog.color.copy(wide ? citySky : horizon);
      ambient.intensity = wide ? 0.72 : 0.84;
      scene.environmentIntensity = wide ? 0.25 : 0.28;
      renderer.toneMappingExposure = wide ? 0.82 : 0.88;
      renderer.shadowMap.needsUpdate = true;
    }
    const seeingLake = Boolean(districts.shore.asset && (mode === 'shore' || (following && patrol.root.position.z < -132)));
    // Use more of the depth buffer for the surfaces visible from the high camera.
    const near = following ? 0.18 : Math.max(1, orbitDistance * 0.055);
    const far = wide ? 920 : seeingLake ? 520 : 285;
    if (camera.near !== near || camera.far !== far) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    if (following) {
      fog.near = seeingLake ? 82 : 48;
      fog.far = seeingLake ? 340 : 139;
      const feet = patrol.root.position;
      followHeight = followHeight === undefined || !tween ? feet.y : THREE.MathUtils.damp(followHeight, feet.y, 12, dt);
      aim.set(feet.x, followHeight + 0.94, feet.z);
      // Keep the Agent and front doors in view without looking through the sidewalk signs.
      const registryFrame = 1 - THREE.MathUtils.smoothstep(feet.distanceTo(eastEntrances.registry), 3, 17);
      const worksFrame = 1 - THREE.MathUtils.smoothstep(feet.distanceTo(eastEntrances.works), 3, 17);
      const forumFrame = 1 - THREE.MathUtils.smoothstep(feet.distanceTo(forumEntrance), 3, 20);
      const pierFrame = 1 - THREE.MathUtils.smoothstep(feet.distanceTo(pierEntrance), 4, 23);
      const centerFrame = 1 - THREE.MathUtils.smoothstep(feet.distanceTo(centerEntrance), 4, 17);
      const residenceFrame = 1 - THREE.MathUtils.smoothstep(feet.distanceTo(residenceEntrance), 4, 21);
      const entranceFrame = Math.max(registryFrame, worksFrame, forumFrame, pierFrame, centerFrame, residenceFrame);
      aim.y += 0.58 * entranceFrame;
      aim.y += 1.45 * centerFrame + 1.08 * residenceFrame;
      aim.x -= 1.1 * centerFrame;
      aim.z += 1.15 * worksFrame + 1.8 * forumFrame - 1.6 * pierFrame - 0.65 * registryFrame - 1.2 * residenceFrame;
      if (byPier && !observer) {
        aim.x += 1.42;
        aim.y -= 1.20;
        aim.z += 0.55;
      }
      if (byPier && observer && !travelling) {
        aim.x += 0.6;
        aim.z = feet.z + 0.2;
      }
      const frameGuest = followed === '01' && (cafeMode ? social : greeting.active) ? 1 : 0;
      greetingFraming = tween ? THREE.MathUtils.damp(greetingFraming, frameGuest, 7, dt) : frameGuest;
      if (followed === '01' && marketGuest) {
        const guest = marketGuest.patrol.root.position;
        aim.x = THREE.MathUtils.lerp(aim.x, guest.x, greetingFraming * 0.5);
        aim.z = THREE.MathUtils.lerp(aim.z, guest.z, greetingFraming * 0.5);
      }
      const greetingDistance = camera.aspect < 0.8 ? Math.max(5.6, followDistance) : Math.max(3.9, followDistance * 0.76);
      const distance = THREE.MathUtils.lerp(followDistance, greetingDistance, greetingFraming)
        + 2.2 * entranceFrame + 1.8 * forumFrame + 3.3 * centerFrame + 3.3 * residenceFrame;
      // Frame the shop from the street side as the Agent passes the entrance tree.
      const streetSide = THREE.MathUtils.smoothstep(feet.z, 47, 56);
      const northSide = 1 - THREE.MathUtils.smoothstep(feet.z, -22, 18);
      const centralYaw = THREE.MathUtils.lerp(FOLLOW_YAW, 0.52, northSide) + streetSide * 1.14 + 0.32 * greetingFraming;
      const registryYaw = THREE.MathUtils.lerp(centralYaw, -0.54, registryFrame);
      const landmarkYaw = THREE.MathUtils.lerp(registryYaw, -2.76, worksFrame);
      const forumYaw = THREE.MathUtils.lerp(landmarkYaw, -2.85, forumFrame);
      const pierYaw = THREE.MathUtils.lerp(forumYaw, 0.64, pierFrame);
      const centerYaw = THREE.MathUtils.lerp(pierYaw, 1.13, centerFrame);
      const closeCafe = cafeMode && !travelling && !byPier;
      const yaw = followYaw + (byPier && !travelling ? observer ? 0.10 : 0.49 : closeCafe ? -2.55 : THREE.MathUtils.lerp(centerYaw, 0.24, residenceFrame));
      // Lift the follow view above the banners on the plaza edge and the lamps at the north crossing.
      const plazaEdge = THREE.MathUtils.smoothstep(feet.x, 4, 9)
        * THREE.MathUtils.smoothstep(feet.z, 13, 18) * (1 - THREE.MathUtils.smoothstep(feet.z, 27, 33));
      const northCrossing = THREE.MathUtils.smoothstep(feet.z, -82, -74)
        * (1 - THREE.MathUtils.smoothstep(feet.z, -50, -43));
      const pitch = Math.min(1.3, followPitch + 0.32 * Math.max(plazaEdge, northCrossing, forumFrame)
        - 0.12 * greetingFraming - 0.07 * residenceFrame);
      camera.position.set(
        aim.x + distance * Math.sin(yaw) * Math.cos(pitch),
        aim.y + distance * Math.sin(pitch),
        aim.z + distance * Math.cos(yaw) * Math.cos(pitch),
      );
      camera.lookAt(aim);
    } else {
      fog.near = wide ? 395 : seeingLake ? 177 : north || sideDistrictLoaded() ? 165 : 110;
      fog.far = wide ? 770 : seeingLake ? 510 : north || sideDistrictLoaded() ? 275 : 235;
      orbitDistance = tween ? THREE.MathUtils.damp(orbitDistance, desiredDistance, 11, dt) : desiredDistance;
      const target = wide && !district ? citywideFocus
        : mode !== 'overview' && mode !== 'follow' && (districts[mode].asset || wide) ? districtFocus[mode] : focus;
      if (tween) viewFocus.lerp(target, 1 - Math.exp(-8 * dt));
      else viewFocus.copy(target);
      const distance = orbitDistance * (camera.aspect < 0.8 ? 1.09 : 1);
      camera.position.set(
        viewFocus.x + distance * Math.sin(orbitYaw) * Math.cos(orbitPitch),
        viewFocus.y + distance * Math.sin(orbitPitch),
        viewFocus.z + distance * Math.cos(orbitYaw) * Math.cos(orbitPitch),
      );
      camera.lookAt(viewFocus);
    }
    let worksDistance = Infinity;
    if (!document.hidden && !wide) {
      updateStreetShadow(following ? aim : viewFocus, Boolean(following) || orbitDistance < 66);
      camera.updateMatrixWorld();
      streetFrustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      if (!worksBounds.isEmpty() && streetFrustum.intersectsBox(worksBounds)) {
        worksDistance = worksBounds.distanceToPoint(camera.position);
      }
      updateRetail();
      for (const kind of LANDMARK_DETAILS) {
        const close = details.get(kind);
        if (!close) continue;
        const distance = kind === 'works' ? worksDistance : landmarkEntrances[kind].distanceTo(camera.position);
        const show = distance < (close.visible ? 40 : 33);
        if (show === close.visible) continue;
        close.visible = show;
        for (const proxy of proxies.get(kind) ?? []) proxy.visible = !show;
        renderer.shadowMap.needsUpdate = true;
      }
    }
    renderer.render(scene, camera);
    const showStreetDetails = mode === 'east' || mode === 'west' || mode === 'research'
      || (mode === 'follow' && patrol && patrol.root.position.z > -44) || orbitDistance < 59;
    const readyForDetails = !actorLoading && now - firstCityFrame > 650 && (cafeMode || !playing || !primary || primary.progress > 0);
    if (!document.hidden && readyForDetails) {
      const nearMarket = marketEntrance.distanceTo(camera.position) < 29 || (primary && marketEntrance.distanceTo(primary.root.position) < 29);
      if (nearMarket) {
        loadDetail('market');
        loadMarketGuest();
      }
      if (!wide && showStreetDetails) loadDetail('street');
      if (!cafeMode && playing && (!primary || primary.progress >= 10)) loadNorth();
      if (!cafeMode && playing && (!primary || primary.progress >= 30) && districts.east.status === 'idle') loadDistrict('east', false);
      if (playing && (!primary || primary.progress >= 55) && districts.east.status !== 'loading' && districts.west.status === 'idle') loadDistrict('west', false);
      const researcher = agents.get('03');
      if (playing && researcher?.destination === 'governance' && researcher.patrol.progress >= 34 && districts.research.status === 'idle') {
        loadDistrict('research', false);
      }
      if (playing && researcher?.destination === 'governance' && researcher.patrol.progress >= 50 && districts.shore.status === 'idle') {
        loadDistrict('shore', false);
      }
      if (playing && districts.residential.status === 'idle' && [...agents.values()].some(
        (agent) => agent.destination === 'registry' && agent.patrol.progress >= 42,
      )) loadDistrict('residential', false);
      for (const kind of LANDMARK_DETAILS) {
        const distance = kind === 'works' ? worksDistance : landmarkEntrances[kind].distanceTo(camera.position);
        if (distance < 38) {
          loadDetail(kind);
        }
      }
    }
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
    if (mode === 'follow' && agents.has(followed)) {
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
  async function request(name: string, priority: RequestPriority = 'auto') {
    const response = await fetch(`${ASSET_PATH}${name}`, { signal, priority });
    if (!response.ok) throw new Error(`Missing preview asset ${name}`);
    return response;
  }

  function loadCitywide() {
    if (citywide || overviewStatus === 'loading' || ended || contextLost) return;
    overviewStatus = 'loading';
    callbacks.overview(overviewStatus);
    request(CITYWIDE_FILE).then((response) => response.arrayBuffer()).then(async (bytes) => {
      if (ended || contextLost) return;
      const { scene: asset } = await loader.parseAsync(bytes, ASSET_PATH);
      if (ended || contextLost) { disposeModel(asset); return; }
      citywide = asset;
      asset.visible = false;
      prepareEnvironment(asset);
      softenRetailWindows(asset);
      addLakeRipples(asset, lakeTime);
      scene.add(asset);
      if (mode === 'overview') resetOrbit();
      overviewStatus = 'ready';
      callbacks.overview(overviewStatus);
    }).catch(() => {
      if (ended || contextLost) return;
      overviewStatus = 'unavailable';
      callbacks.overview(overviewStatus);
    });
  }

  function loadRetail() {
    if (retailRequested) return;
    retailRequested = true;
    request(RETAIL_DETAIL, 'low').then((response) => response.arrayBuffer()).then(async (bytes) => {
      if (ended || contextLost) return;
      const { scene: asset } = await loader.parseAsync(bytes, ASSET_PATH);
      const template = asset.children.find(isGardenRetail);
      if (ended || contextLost || !template) { disposeModel(asset); return; }
      prepareEnvironment(asset, streetAnisotropy);
      softenRetailWindows(asset);
      retailSource = asset;
      retailTemplate = template;
    }).catch(() => {});
  }

  function loadDetail(kind: Detail) {
    const placeholders = proxies.get(kind);
    if (!placeholders?.length || requestedDetails.has(kind)) return;
    requestedDetails.add(kind);
    request(DETAIL_FILES[kind], kind === 'street' ? 'low' : 'auto').then((response) => response.arrayBuffer()).then(async (bytes) => {
      if (ended || contextLost) return;
      const { scene: asset } = await loader.parseAsync(bytes, ASSET_PATH);
      if (ended || contextLost) { disposeModel(asset); return; }
      prepareEnvironment(asset, streetAnisotropy);
      // A failed request leaves the original silhouette visible.
      details.set(kind, asset);
      street.add(asset);
      if (kind !== 'street' && kind !== 'market') {
        asset.visible = false;
        return;
      }
      if (kind === 'street') {
        softenRetailWindows(asset);
        registerRetail(asset);
      }
      for (const proxy of placeholders) proxy.visible = false;
      renderer.shadowMap.needsUpdate = true;
    }).catch(() => {});
  }

  function loadDistrict(side: District, interactive: boolean): Promise<void> | undefined {
    const district = districts[side];
    if (district.pending || !model || ended || contextLost || district.status === 'ready') return district.pending;
    district.status = 'loading';
    callbacks.district(side, district.status);
    const [routeFile, meshFile] = DISTRICT_FILES[side];
    const priority = interactive ? 'auto' : 'low';
    const needsGovernance = side === 'shore' || side === 'research';
    const dependency = side === 'residential'
      ? Promise.all([loadDistrict('east', interactive), loadNorth(interactive)])
      : needsGovernance ? loadNorth(interactive) : undefined;
    district.pending = Promise.all([
      request(routeFile, priority).then((response) => response.json() as Promise<EastRoutes | Connection>),
      request(meshFile, priority).then((response) => response.arrayBuffer()),
      dependency,
    ]).then(async ([layout, bytes]) => {
      if (ended || contextLost) return;
      if (needsGovernance && !north) throw new Error('The connection requires the governance district');
      if (side === 'residential' && !districts.east.asset) throw new Error('The connection requires the east district');
      const { scene: asset } = await loader.parseAsync(bytes, ASSET_PATH);
      if (ended || contextLost) { disposeModel(asset); return; }
      try {
        if (side === 'east') navigation.connectEast(layout as EastRoutes);
        else if (side === 'west') navigation.connect('plaza', 'forum', layout as Connection);
        else if (side === 'residential') navigation.connect('registry', 'residence', layout as Connection);
        else navigation.connect('governance', side === 'shore' ? 'pier' : 'center', layout as Connection);
        if (side === 'shore' && cafeMode) {
          const path = navigation.path('01', 'market', 'pier');
          if (!path) throw new Error('No connected route to the fishing spot');
          pierRoute = joinCafeToPier(path.points);
        }
      } catch (error) {
        disposeModel(asset);
        throw error;
      }
      if (side === 'research') addCenterNameplate(asset);
      district.asset = asset;
      prepareEnvironment(asset, streetAnisotropy);
      if (side === 'shore') addLakeRipples(asset, lakeTime);
      softenRetailWindows(asset);
      street.add(asset);
      if (side === 'research' || side === 'west') {
        districts.research.asset?.traverse((object) => {
          if (object.userData.previewTier === 'west_skybridge') object.visible = Boolean(districts.west.asset);
        });
      }
      if (side === 'east') registerProxies(asset, ['registry', 'works']);
      if (side === 'research') registerProxies(asset, ['center']);
      registerRetail(asset);
      const entrances = side === 'east' ? Object.values(eastEntrances)
        : [side === 'west' ? forumEntrance : side === 'shore' ? pierEntrance : side === 'research' ? centerEntrance : residenceEntrance];
      for (const entrance of entrances) {
        const lamp = new THREE.PointLight('#ffd08b', side === 'research' ? 22 : side === 'residential' ? 30 : 65, 14, 2);
        lamp.position.copy(entrance);
        if (side === 'research') lamp.position.set(-88.9, 1.9, -64.4);
        else if (side === 'residential') lamp.position.set(95.3, 2.65, -56.4);
        else lamp.position.y = 3.5;
        street.add(lamp);
      }
      renderer.shadowMap.needsUpdate = true;
      district.status = 'ready';
      callbacks.district(side, district.status);
    }).catch(() => {
      if (ended || contextLost) return;
      district.status = 'unavailable';
      callbacks.district(side, district.status);
      if (side === 'shore' && cafeMode) callbacks.fallback();
    }).finally(() => {
      district.pending = undefined;
    });
    return district.pending;
  }

  function loadNorth(interactive = false) {
    if (northLoading || north || !model || ended || contextLost) return northLoading;
    if (northFailed && !interactive) return;
    const priority = interactive ? 'auto' : 'low';
    northLoading = Promise.all([
      request('governance-route.json', priority).then((response) => response.json() as Promise<RouteData>),
      request('nexus-connector.json', priority).then((response) => response.json() as Promise<Connection>),
      request('governance-north.glb', priority).then((response) => response.arrayBuffer()),
      cafeMode ? undefined : request('agent-03.glb', priority).then((response) => response.arrayBuffer()).catch(() => undefined),
    ]).then(async ([layout, connector, cityBytes, agentBytes]) => {
      if (ended || contextLost) return;
      const city = await loader.parseAsync(cityBytes, ASSET_PATH);
      if (ended || contextLost) { disposeModel(city.scene); return; }
      navigation.connect('plaza', 'plazaNorth', connector);
      navigation.connect('plazaNorth', 'governance', layout);
      north = city.scene;
      prepareEnvironment(north, streetAnisotropy);
      street.add(north);
      softenRetailWindows(north);
      registerRetail(north);
      registerProxies(north, ['hall']);
      focus.set(...layout.target);
      if (mode === 'overview' && desiredDistance === START_DISTANCE && orbitPitch === START_PITCH) {
        desiredDistance = EXPANDED_DISTANCE;
        orbitPitch = EXPANDED_PITCH;
      }
      renderer.shadowMap.needsUpdate = true;
      const entranceLight = new THREE.PointLight('#ffd08b', 64, 14, 2);
      entranceLight.position.set(0, 4, -83);
      street.add(entranceLight);

      if (cafeMode) return;
      if (!agentBytes) throw new Error('Researcher asset unavailable');
      const agent = await loader.parseAsync(agentBytes, ASSET_PATH);
      if (ended || contextLost) { disposeModel(agent.scene); return; }
      attachAgent('03', agent, 'plazaNorth');
    }).catch(() => {
      northFailed = true;
      if (!ended && !contextLost) callbacks.agent('03', { status: 'unavailable', progress: 0 });
    }).finally(() => {
      northLoading = undefined;
    });
    return northLoading;
  }

  function loadMarketGuest() {
    if (!route || marketGuestRequested || ended || contextLost) return;
    marketGuestRequested = true;
    Promise.all([
      request('market-greeting.json', 'low').then((response) => response.json() as Promise<{ points: RoutePoint[] }>),
      request('agent-02.glb', 'low').then((response) => response.arrayBuffer()),
    ]).then(async ([layout, bytes]) => {
      if (ended || contextLost) return;
      const asset = await loader.parseAsync(bytes, ASSET_PATH);
      if (ended || contextLost) { disposeModel(asset.scene); return; }
      try {
        const patrol = createAgentPatrol(asset, layout.points, [marketEntrance.x, marketEntrance.z]);
        marketGuest = { asset, patrol };
        street.add(patrol.root);
      } catch {
        disposeModel(asset.scene);
      }
    }).catch(() => {});
  }

  request('agent-01.glb').then((response) => response.arrayBuffer()).then(async (bytes) => {
    if (ended || contextLost) return;
    const result = await loader.parseAsync(bytes, ASSET_PATH);
    if (ended || contextLost) { disposeModel(result.scene); return; }
    actor = result;
    connectPrimary();
  }).catch(() => {
    if (!ended && !contextLost) callbacks.agent('01', { status: 'unavailable', progress: 0 });
  }).finally(() => { actorLoading = false; });

  Promise.all([
    request('route.json').then((response) => response.json() as Promise<RouteData>),
    request('nexus-market.glb').then((response) => response.arrayBuffer()),
  ]).then(async ([layout, bytes]) => {
    if (ended || contextLost) return;
    const result = await loader.parseAsync(bytes, ASSET_PATH);
    if (ended || contextLost) { disposeModel(result.scene); return; }
    route = layout;
    navigation.connect('plaza', 'market', route);
    focus.set(...route.target);
    marketEntrance.set(...(route.points.at(-1) ?? route.target));
    model = result.scene;
    registerProxies(model, ['street', 'market']);
    prepareEnvironment(model, streetAnisotropy);
    softenRetailWindows(model);
    street.add(model);
    if (cafeMode) {
      street.add(cafeProps);
      cafeProps.add(createCafePaving());
      if (fishingGear) cafeProps.add(fishingGear.group);
      for (const file of ['cafe-bench.glb', 'coffee-stall.glb']) {
        request(file).then((response) => response.arrayBuffer())
        .then((bytes) => loader.parseAsync(bytes, ASSET_PATH)).then(({ scene: prop }) => {
          if (ended || contextLost) { disposeModel(prop); return; }
          prop.rotation.y = Math.PI;
          if (file === 'cafe-bench.glb') prop.position.copy(seat);
          else {
            prop.scale.setScalar(2.75 / 97.84);
            prop.position.set(...CAFE_STALL);
            prepareEnvironment(prop, streetAnisotropy);
          }
          cafeProps.add(prop);
          renderer.shadowMap.needsUpdate = true;
        }).catch(() => { if (!ended && !contextLost) callbacks.fallback(); });
      }
    }
    connectPrimary();
    renderer.shadowMap.needsUpdate = true;
    firstCityFrame = lastFrame = measuredAt = performance.now();
    animate(lastFrame);
    callbacks.ready(performance.now() - started);
    if (mode === 'overview') loadCitywide();
  }).catch(() => {
    if (!ended && !contextLost) callbacks.fallback();
  });

  return {
    syncCafe(snapshot) { cafeSnapshot = snapshot; receivedAt = performance.now(); },
    view: setView,
    zoom,
    play(enabled) { playing = enabled; },
    reset() {
      resetOrbit();
      orbitDistance = desiredDistance;
      resetFollowCamera();
    },
    dispose() {
      ended = true;
      aborter.abort();
      cancelAnimationFrame(frameId);
      sizeObserver.disconnect();
      for (const agent of agents.values()) {
        agent.patrol.dispose();
        disposeModel(agent.asset.scene);
      }
      if (marketGuest) {
        marketGuest.patrol.dispose();
        disposeModel(marketGuest.asset.scene);
      }
      if (pierRegular) {
        pierRegular.patrol.dispose();
        disposeModel(pierRegular.asset.scene);
      }
      if (actor) disposeModel(actor.scene);
      if (model) disposeModel(model);
      if (north) disposeModel(north);
      disposeModel(cafeProps);
      fishingGear?.dispose();
      if (citywide) disposeModel(citywide);
      for (const { asset } of Object.values(districts)) {
        if (asset) disposeModel(asset);
      }
      if (retailSource) disposeModel(retailSource);
      for (const detail of details.values()) disposeModel(detail);
      sun.shadow.dispose();
      sunset.shadow.dispose();
      streetSky.dispose();
      environment.dispose();
      renderer.forceContextLoss();
      renderer.dispose();
      canvas.remove();
    },
  };
}
