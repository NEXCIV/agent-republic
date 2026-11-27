import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createAgentPatrol, type RoutePoint } from './agent';
import { CAFE_BENCH, CAFE_COUNTER, CAFE_HOST, CAFE_STALL, createCafePaving, joinCafeToPier } from './cafe-corner';
import { createMarketGreeting } from './marketGreeting';
import { COUNCIL_DEMO_AGENDA, COUNCIL_NOTICE_BOARD, COUNCIL_NOTICE_HEADING, COUNCIL_SURVEY_RECEIPT, LIGHTING_PILOT_STATUS } from '../../lib/council-notice';
import type { CafeSnapshot } from '../../lib/cafe-life';
import { cityWalkTiming, type CityMovement, type CityObservation, type CityRegion } from '../../lib/city-movement';
import type { CityPoint } from '../../lib/cafe-geometry';
import type { SharedPilotView } from '../../lib/shared-pilot-runtime';
import { SHARED_AVATARS } from '../../lib/shared-pilot-profiles';
import type { LightingPilot } from '../../lib/city-activities';
import { createFishingGear, FISHING_SPOT } from './fishing';
import { createInstallationKit, createPilotLamp } from './lighting-pilot';
import { THEATRE_CLOCK, THEATRE_STAGE } from '../../lib/theatre-layout';
import { createTheatreLighting } from './theatre-lighting';
import { createStageInstallation } from './theatre-stage-installation';
import { createNavigation, DESTINATION_FACING, placeAt, type AgentStart, type Connection, type EastRoutes, type Place, type ResidentId, type Visits } from './navigation';

export type District = 'east' | 'west' | 'shore' | 'research' | 'residential';
export type View = 'overview' | 'follow' | District;
export type DistrictStatus = 'idle' | 'loading' | 'ready' | 'unavailable';
export type AgentId = ResidentId;
export type FollowId = AgentId | '02';
export type WalkLandmarkId = 'registry' | 'works' | 'center' | 'governance' | 'market';
const WORKS_MANAGER = 'works.manager';
type ActorId = FollowId | typeof WORKS_MANAGER;
export type WalkSelection = { kind: 'building'; id: WalkLandmarkId }
  | { kind: 'resident'; id: FollowId }
  | { kind: 'person'; id: typeof WORKS_MANAGER };
type Activity = 'outbound' | 'arrived' | 'greeting';
export type AgentStatus = Activity | 'loading' | 'unavailable';
export type AgentReport = { status: AgentStatus; progress: number; from?: Place; destination?: Place };
type RouteData = Connection & { target: RoutePoint };
type Patrol = ReturnType<typeof createAgentPatrol>;
const SHARED_RESIDENTS = ['01', '02'] as const;
type SharedResident = (typeof SHARED_RESIDENTS)[number];
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
  agent: (id: FollowId, report: AgentReport) => void;
  district: (side: District, status: DistrictStatus) => void;
  overview: (status: DistrictStatus) => void;
  fps: (value: number) => void;
  onSelect?: (selection: WalkSelection | null) => void;
};

export type WalkController = {
  syncCafe: (snapshot: CafeSnapshot | null) => void;
  syncCity: (observation: CityObservation | null) => void;
  syncShared: (snapshot: SharedPilotView | null) => void;
  view: (mode: View, id?: FollowId) => void;
  select: (selection: WalkSelection | null) => void;
  focus: (selection: WalkSelection) => void;
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
  east: ['east-routes.json', 'east-civic-district.glb?v=4'],
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
  works: 'public-construction-rebuilt.glb',
  center: 'research-agent-center-detail.glb',
  hall: 'governance-hall-detail.glb',
};
type Detail = keyof typeof DETAIL_FILES;
const LANDMARK_DETAILS = ['registry', 'works', 'center', 'hall'] as const;
const LANDMARK_FRAMING: Record<WalkLandmarkId, { center: CityPoint; yaw: number; distance: number }> = {
  registry: { center: [80, 4, -23.5], yaw: -0.45, distance: 27 },
  works: { center: [95, 6, 82], yaw: -2.76, distance: 33 },
  center: { center: [-98.6, 6, -64.6], yaw: 1.05, distance: 31 },
  governance: { center: [0, 7, -95], yaw: 0.20, distance: 36 },
  market: { center: [18.5, 6, 51], yaw: -0.35, distance: 30 },
};
const LANDMARK_NAMES: [string, WalkLandmarkId][] = [
  ['HERO_01_Governance_Hall', 'governance'],
  ['HERO_02_Agent_Center', 'center'],
  ['HERO_03_Citizen_Registration', 'registry'],
  ['HERO_04_Public_Construction', 'works'],
  ['Market', 'market'],
];
const SELECTABLE_ACTORS = ['01', '02', '03', WORKS_MANAGER] as const;

function isRendered(object: THREE.Object3D) {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

function createResidentMarkerMaterial(label?: string, color = '#f0b90b') {
  const icon = document.createElement('canvas');
  icon.width = icon.height = 48;
  const context = icon.getContext('2d');
  if (!context) return undefined;
  context.beginPath();
  context.arc(24, 24, 19, 0, Math.PI * 2);
  context.fillStyle = '#141619';
  context.fill();
  context.lineWidth = 5;
  context.strokeStyle = color;
  context.stroke();
  context.fillStyle = color;
  if (label) {
    context.font = 'bold 20px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, 24, 25);
  } else {
    context.beginPath();
    context.arc(24, 24, 5, 0, Math.PI * 2);
    context.fill();
  }
  const map = new THREE.CanvasTexture(icon);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map, sizeAttenuation: false, depthWrite: false, depthTest: !label, fog: false, toneMapped: false });
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

function addCouncilNotice(asset: THREE.Object3D) {
  const face = document.createElement('canvas');
  face.width = 384;
  face.height = 432;
  const brush = face.getContext('2d');
  if (!brush) return;
  brush.fillStyle = '#193640';
  brush.fillRect(0, 0, face.width, face.height);
  brush.fillStyle = '#edbe56';
  brush.fillRect(24, 23, 104, 34);
  brush.fillStyle = '#18252a';
  brush.font = '700 19px system-ui, sans-serif';
  brush.fillText('DEMO', 47, 46);
  brush.fillStyle = '#f5e8c9';
  brush.font = '700 53px "Microsoft YaHei", sans-serif';
  brush.fillText('议事公告', 24, 134);
  brush.fillRect(24, 172, 336, 2);
  brush.font = '400 29px "Microsoft YaHei", sans-serif';
  COUNCIL_DEMO_AGENDA.forEach((topic, index) => brush.fillText(topic, 24, 242 + 61 * index));
  const texture = new THREE.CanvasTexture(face);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const notice = new THREE.Mesh(
    new THREE.PlaneGeometry(0.84, 0.96),
    new THREE.MeshBasicMaterial({ map: texture }),
  );
  notice.name = 'NEXCIV_Council_Demo_Notice';
  notice.position.set(...COUNCIL_NOTICE_BOARD);
  notice.rotation.y = COUNCIL_NOTICE_HEADING;
  asset.add(notice);
  let receipt = '';
  let theatreLine = COUNCIL_DEMO_AGENDA[1] as string;
  return (message: string, theatre: string) => {
    if (message === receipt && theatre === theatreLine) return;
    receipt = message;
    theatreLine = theatre;
    brush.fillStyle = '#193640';
    brush.fillRect(22, 274, 340, 58);
    brush.fillStyle = '#f5e8c9';
    brush.font = '400 29px "Microsoft YaHei", sans-serif';
    brush.fillText(theatreLine, 24, 303, 336);
    const received = Boolean(message);
    brush.fillStyle = received ? '#edbe56' : '#193640';
    brush.fillRect(24, 352, 336, 49);
    if (received) {
      brush.fillStyle = '#18252a';
      brush.font = '700 28px "Microsoft YaHei", sans-serif';
      brush.fillText(message, 40, 385, 305);
    }
    texture.needsUpdate = true;
  };
}

export function createWalk(host: HTMLDivElement, initialView: View, autoPlay: boolean, callbacks: Callbacks,
  cafeMode = false, sharedMode = false): WalkController {
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
  const actorLayer = callbacks.onSelect ? new THREE.Group() : street;
  if (actorLayer !== street) scene.add(actorLayer);
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
  const observedFacing = new THREE.Vector3();
  const cafeProps = new THREE.Group();
  const lightingProps = new THREE.Group();
  scene.add(lightingProps);
  let cafeSnapshot: CafeSnapshot | null = null;
  let cityObservation: CityObservation | null = null;
  let cityReceivedAt = 0;
  let cityAssetsFor: string | undefined;
  let cityJourney: { traveller: Patrol; id: string } | undefined;
  let workerAssetsFor: string | undefined;
  let workerJourney: string | undefined;
  let workerReport: AgentReport | undefined;
  let lightingLamp: THREE.Group | undefined;
  let installationKit: THREE.Group | undefined;
  let theatreLights: ReturnType<typeof createTheatreLighting> | undefined;
  let stageInstallation: ReturnType<typeof createStageInstallation> | undefined;
  let theatreOpen = false;
  const theatreFocus = new THREE.Vector3(THEATRE_STAGE[0], 0.82, 83.25);
  let siteHost: { patrol: Patrol; asset: GLTF; position: THREE.Vector3; facing: THREE.Vector3 } | undefined;
  let siteHostRequested = false;
  const fishingGear = cafeMode ? createFishingGear() : undefined;
  const fishingSpot = new THREE.Vector3(...FISHING_SPOT);
  const waterFacing = fishingSpot.clone().add(new THREE.Vector3(1, 0, 0));
  const interviewSpot = pierEntrance.clone();
  const regularPosition = pierEntrance.clone().add(new THREE.Vector3(1.25, 0, 0.65));
  let pierRegular: { asset: GLTF; patrol: Patrol } | undefined;
  let regularRequested = false;
  let strollAssetsFor: string | undefined;
  let strollJourney: string | undefined;
  let pierRoute: RoutePoint[] | undefined;
  let pierJourney: { traveller: Patrol; startedAt: number } | undefined;
  let receivedAt = 0;
  const eastEntrances = {
    registry: new THREE.Vector3(80, 1, -14),
    works: new THREE.Vector3(95, 1, 72),
  };
  const centerEntrance = new THREE.Vector3(-92.35, 1.6, -64.6);
  const landmarkEntrances = { ...eastEntrances, center: centerEntrance, hall: new THREE.Vector3(0, 1.8, -82) };
  const councilNotice = new THREE.Vector3(...COUNCIL_NOTICE_BOARD);
  const streetFrustum = new THREE.Frustum();
  const worksBounds = new THREE.Box3();
  const viewProjection = new THREE.Matrix4();
  const landmarkModels = new Map<WalkLandmarkId, { root: THREE.Object3D; bounds: THREE.Box3; meshes: THREE.Mesh[] }[]>();
  const markerMaterial = callbacks.onSelect && !sharedMode ? createResidentMarkerMaterial() : undefined;
  const sharedMarkerMaterials: THREE.SpriteMaterial[] = [];
  const residentMarkers = new Map<ActorId, THREE.Sprite>();
  if (callbacks.onSelect) {
    for (const id of SELECTABLE_ACTORS) {
      if (sharedMode && id !== '01' && id !== '02') continue;
      const material = sharedMode ? createResidentMarkerMaterial(id, id === '01' ? '#f0b90b' : '#79bab7') : markerMaterial;
      if (!material) continue;
      if (sharedMode) sharedMarkerMaterials.push(material);
      const marker = new THREE.Sprite(material);
      if (sharedMode) marker.renderOrder = 100;
      marker.visible = false;
      scene.add(marker);
      residentMarkers.set(id, marker);
    }
  }
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const blockingGeometries: THREE.Mesh[] = [];
  const selectionBounds = new THREE.Box3();
  const selectionCenter = new THREE.Vector3();
  const selectionSize = new THREE.Vector3();
  const landmarkTarget = new THREE.Vector3();
  const selectionMaterial = new THREE.LineBasicMaterial({ color: '#f0b90b', fog: false, toneMapped: false });
  const buildingOutline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 0, -0.5),
    new THREE.Vector3(0.5, 0, 0.5), new THREE.Vector3(-0.5, 0, 0.5),
  ]), selectionMaterial);
  const residentOutline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 32 }, (_, index) => {
      const angle = index / 32 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    }),
  ), selectionMaterial);
  buildingOutline.visible = residentOutline.visible = false;
  scene.add(buildingOutline, residentOutline);
  let selection: WalkSelection | null = null;
  let framedLandmark: WalkLandmarkId | undefined;
  const retailPlacements: { mid: THREE.Object3D; bounds: THREE.Sphere; close?: THREE.Object3D }[] = [];
  const tween = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointers = new Map<number, { x: number; y: number; startX: number; startY: number; dragging: boolean }>();
  const aborter = new AbortController();
  let ended = false;
  let contextLost = false;
  let model: THREE.Object3D | undefined;
  let citywide: THREE.Object3D | undefined;
  let overviewStatus: DistrictStatus = 'idle';
  let north: THREE.Object3D | undefined;
  let updateCouncilNotice: ReturnType<typeof addCouncilNotice>;
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
  let actorLoading = !sharedMode;
  const agents = new Map<AgentId, ActiveAgent>();
  const navigation = createNavigation();
  const marketGreeting = createMarketGreeting();
  let marketGuest: { asset: GLTF; patrol: Patrol } | undefined;
  const sharedActors = new Map<SharedResident, { asset: GLTF; patrol: Patrol }>();
  const sharedRequests = new Map<SharedResident, { file: string }>();
  let sharedSnapshot: SharedPilotView | null = null;
  let sharedReceivedAt = performance.now();
  const sharedJourneys = new Map<string, string>();
  const sharedRegions = new Set<CityRegion>();
  const speechCanvas = sharedMode ? document.createElement('canvas') : undefined;
  if (speechCanvas) { speechCanvas.width = 576; speechCanvas.height = 176; }
  const speechTexture = speechCanvas ? new THREE.CanvasTexture(speechCanvas) : undefined;
  if (speechTexture) speechTexture.colorSpace = THREE.SRGBColorSpace;
  const speechMaterial = speechTexture ? new THREE.SpriteMaterial({ map: speechTexture, transparent: true,
    depthTest: false, depthWrite: false, fog: false, sizeAttenuation: false, toneMapped: false }) : undefined;
  const speech = speechMaterial ? new THREE.Sprite(speechMaterial) : undefined;
  if (speech) { speech.visible = false; speech.center.set(.5, 0); speech.renderOrder = 101; scene.add(speech); }
  let speechKey = '';
  let marketGuestRequested = false;
  let greetingFraming = 0;
  let followed: ActorId = '01';
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

  function selectableActor(id: ActorId) {
    if (sharedMode) return id === '01' || id === '02' ? sharedActors.get(id) : undefined;
    const assignedWorker = cityObservation?.lightingPilot?.worker;
    if (id === WORKS_MANAGER) return assignedWorker ? undefined : siteHost;
    if (id === '02') return cafeMode || assignedWorker ? siteHost : marketGuest;
    if (id === '03' && cafeMode) return pierRegular;
    return agents.get(id);
  }

  function followedPatrol() {
    const patrol = selectableActor(followed)?.patrol;
    return patrol?.root.visible ? patrol : undefined;
  }

  function registerLandmark(id: WalkLandmarkId, root: THREE.Object3D) {
    if (!callbacks.onSelect) return;
    const meshes: THREE.Mesh[] = [];
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) meshes.push(node);
    });
    if (!meshes.length) return;
    root.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(root);
    const models = landmarkModels.get(id) ?? [];
    models.push({ root, bounds, meshes });
    landmarkModels.set(id, models);
  }

  function updateSelectionOutline() {
    buildingOutline.visible = residentOutline.visible = false;
    if (selection?.kind === 'building') {
      selectionBounds.makeEmpty();
      for (const model of landmarkModels.get(selection.id) ?? []) {
        if (isRendered(model.root)) selectionBounds.union(model.bounds);
      }
      if (selectionBounds.isEmpty()) return;
      selectionBounds.getCenter(selectionCenter);
      selectionBounds.getSize(selectionSize);
      buildingOutline.position.set(selectionCenter.x, Math.max(0.26, selectionBounds.min.y + 0.12), selectionCenter.z);
      buildingOutline.scale.set(selectionSize.x + 1, 1, selectionSize.z + 1);
      buildingOutline.visible = true;
    } else if (selection) {
      const root = selectableActor(selection.id)?.patrol.root;
      if (!root || !isRendered(root)) return;
      const radius = THREE.MathUtils.clamp(camera.position.distanceTo(root.position) * 0.012, 0.57, 4.8);
      residentOutline.position.copy(root.position);
      residentOutline.position.y += 0.045;
      residentOutline.scale.set(radius, 1, radius);
      residentOutline.visible = true;
    }
  }

  function updateResidentMarkers() {
    const markerScale = 2 * (sharedMode ? 27 : 16) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, host.clientHeight);
    for (const [id, marker] of residentMarkers) {
      const root = selectableActor(id)?.patrol.root;
      marker.visible = Boolean(root && isRendered(root) && camera.position.distanceTo(root.position) > 62);
      if (!marker.visible || !root) continue;
      marker.position.copy(root.position);
      marker.position.y += 2.15;
      marker.scale.setScalar(markerScale);
    }
  }

  function zoom(factor: number) {
    if (framedLandmark) desiredDistance = THREE.MathUtils.clamp(desiredDistance * factor, 16, 94);
    else if (mode === 'follow' && followedPatrol()) followDistance = THREE.MathUtils.clamp(followDistance * factor, 3.6, 11.5);
    else if (mode === 'overview' && citywide) desiredDistance = THREE.MathUtils.clamp(desiredDistance * factor, 155, 465);
    else desiredDistance = THREE.MathUtils.clamp(desiredDistance * factor, 24, north || sideDistrictLoaded() ? 176 : 139);
  }

  function resetFollowCamera() {
    followYaw = 0;
    followPitch = followed === '03' && !cafeMode ? 0.28 : FOLLOW_PITCH;
    followDistance = followed === '03' && !cafeMode ? 7.4 : FOLLOW_DISTANCE;
    followHeight = undefined;
    greetingFraming = 0;
  }

  function sideDistrictLoaded() { return Boolean(districts.east.asset || districts.west.asset || districts.research.asset || districts.residential.asset); }

  function resetOrbit() {
    if (framedLandmark) {
      const { yaw, distance } = LANDMARK_FRAMING[framedLandmark];
      [orbitYaw, orbitPitch, desiredDistance] = [yaw, 0.53, distance];
      return;
    }
    if (mode !== 'overview' && mode !== 'follow') {
      if (mode === 'west' && cafeMode && cityObservation?.theatre?.booking) {
        [orbitYaw, orbitPitch, desiredDistance] = [Math.PI + 0.12, 0.64, 27];
        return;
      }
      [orbitYaw, orbitPitch, desiredDistance] = DISTRICT_ORBIT[mode];
      return;
    }
    orbitYaw = citywide && mode === 'overview' ? 0.11 : START_YAW;
    orbitPitch = citywide && mode === 'overview' ? CITYWIDE_PITCH : north ? EXPANDED_PITCH : START_PITCH;
    desiredDistance = citywide && mode === 'overview' ? CITYWIDE_DISTANCE : north ? EXPANDED_DISTANCE : START_DISTANCE;
  }

  function setView(next: View, id = followed) {
    const viewChanged = mode !== next || Boolean(framedLandmark);
    framedLandmark = undefined;
    if (id !== followed) {
      followed = id;
      resetFollowCamera();
    }
    mode = next;
    if (viewChanged && next !== 'follow') resetOrbit();
    followHeight = undefined;
    if (next === 'follow' && id === '03' && !cafeMode) loadNorth(true);
    if (next === 'follow' && id === '02' && cityObservation?.lightingPilot?.worker) {
      loadRouteRegions(cityObservation.lightingPilot.worker.movement.regions);
    }
    if (next === 'overview') loadCitywide();
    if (next !== 'overview' && next !== 'follow') loadDistrict(next, true);
  }

  function focusSelection(target: WalkSelection) {
    if (target.kind !== 'building') {
      const root = selectableActor(target.id)?.patrol.root;
      if (target.kind === 'person' || (root && isRendered(root))) setView('follow', target.id);
      return;
    }
    if (mode === 'follow' && followedPatrol()) {
      viewFocus.copy(aim);
      orbitDistance = camera.position.distanceTo(aim);
    }
    mode = 'overview';
    framedLandmark = target.id;
    landmarkTarget.set(...LANDMARK_FRAMING[target.id].center);
    resetOrbit();
    if (target.id === 'works' || target.id === 'registry') loadDistrict('east', true);
    else if (target.id === 'governance') loadNorth(true);
    else if (target.id === 'center') loadDistrict('research', true);
    else loadDetail('market');
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
      actorLayer.add(patrol.root);
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
      if (kind !== 'street') {
        for (const member of members) registerLandmark(kind === 'hall' ? 'governance' : kind, member);
      }
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

  function poseCityWalk(
    movement: CityMovement, primary: Patrol | undefined, cityTime: number, poseDt: number,
    talkTarget?: THREE.Vector3, stageSeat?: CityPoint | null,
  ) {
    if (cityAssetsFor !== movement.requestId) {
      cityAssetsFor = movement.requestId;
      loadRouteRegions(movement.regions);
    }
    const { walkingMs, progress, stop } = cityWalkTiming(movement, cityTime);
    if (!primary) return progress;
    const target = movement.points.at(-1)!;
    if (stageSeat) {
      observedPosition.set(...stageSeat);
      observedFacing.set(...THEATRE_STAGE);
      primary.observe(poseDt, observedPosition, observedFacing, false, undefined, true);
    } else if (talkTarget) {
      observedPosition.set(...target);
      primary.observe(poseDt, observedPosition, talkTarget, false, 'nod');
    } else if (stop || (movement.facing && cityTime >= movement.arrivesAt)) {
      const position = stop?.position ?? target;
      const [x, z] = stop?.facing ?? movement.facing!;
      observedPosition.set(...position);
      observedFacing.set(x, position[1], z);
      primary.observe(poseDt, observedPosition, observedFacing);
    } else if (walkingMs > 0) {
      if (cityJourney?.id !== movement.requestId || cityJourney.traveller !== primary) {
        primary.plan(movement.points, [target[0], target[2]]);
        cityJourney = { traveller: primary, id: movement.requestId };
      }
      primary.observeJourney(poseDt, progress, walkingMs / 1000);
    } else {
      observedPosition.set(...target);
      primary.observe(poseDt, observedPosition, counterFacing);
    }
    return progress;
  }

  function poseWorksSite(pilot: LightingPilot | undefined, cityTime: number, poseDt: number, talkTarget?: THREE.Vector3) {
    const worker = pilot?.worker;
    const host = cityObservation?.nearby?.people.find(({ id }) => id === WORKS_MANAGER);
    const hostPosition = worker?.movement.points[0] ?? host?.position;
    if (hostPosition && !siteHostRequested) loadSiteHost(hostPosition);
    if (worker && workerAssetsFor !== worker.movement.requestId) {
      workerAssetsFor = worker.movement.requestId;
      loadRouteRegions(worker.movement.regions);
    }
    if (pilot?.stage === 'installing' && districts.shore.asset && !installationKit) {
      installationKit = createInstallationKit(pilot.worker.position);
      lightingProps.add(installationKit);
      renderer.shadowMap.needsUpdate = true;
    }
    if (pilot?.stage === 'lit' && districts.shore.asset && !lightingLamp) {
      lightingLamp = createPilotLamp(pilot.lamp.position);
      lightingProps.add(lightingLamp);
      renderer.shadowMap.needsUpdate = true;
    }
    if (installationKit) installationKit.visible = pilot?.stage === 'installing';
    if (lightingLamp) lightingLamp.visible = pilot?.stage === 'lit';

    if (!siteHost) return;
    siteHost.patrol.root.visible = Boolean(cityObservation);
    if (!worker) {
      siteHost.patrol.observe(poseDt, siteHost.position, talkTarget ?? siteHost.facing, false, talkTarget ? 'nod' : undefined);
      return;
    }

    const { movement } = worker;
    const [x, z] = movement.facing!;
    const { progress, walkingMs } = cityWalkTiming(movement, cityTime);
    if (pilot.stage === 'dispatch') {
      if (workerJourney !== movement.requestId) {
        workerJourney = movement.requestId;
        siteHost.patrol.plan(movement.points, [x, z]);
      }
      siteHost.patrol.observeJourney(poseDt, progress, walkingMs / 1000);
    } else {
      observedPosition.set(...worker.position);
      observedFacing.set(x, worker.position[1], z);
      siteHost.patrol.observe(poseDt, observedPosition, observedFacing, false, pilot.stage === 'installing' ? 'install' : undefined);
    }

    const status = pilot.stage === 'dispatch' ? 'outbound' : 'arrived';
    const percentage = Math.round(progress * 100);
    if (!cafeMode && (workerReport?.status !== status || workerReport.progress !== percentage)) {
      workerReport = { status, progress: percentage, from: 'works' };
      callbacks.agent('02', workerReport);
    }
  }

  function poseShared(now: number, poseDt: number) {
    const projection = sharedSnapshot;
    const elapsed = Math.max(0, now - sharedReceivedAt);
    const serverTime = (projection?.serverTime ?? 0) + Math.min(elapsed, 1600);
    for (const id of SHARED_RESIDENTS) {
      const patrol = sharedActors.get(id)?.patrol;
      const resident = projection?.residents.find(({ residentId }) => residentId === id);
      if (patrol) patrol.root.visible = Boolean(resident);
      if (!resident) continue;
      const move = resident.movement;
      if (move) for (const region of move.regions) {
        if (sharedRegions.has(region)) continue;
        sharedRegions.add(region);
        loadRouteRegions([region]);
      }
      if (!patrol) continue;
      if (move && move.status === 'walking' && move.metres > 0) {
        const key = `${move.startedAt}:${move.destination.place}`;
        const target = move.points.at(-1)!;
        if (sharedJourneys.get(id) !== key) {
          patrol.plan(move.points, [target[0], target[2]]);
          sharedJourneys.set(id, key);
        }
        const duration = move.arrivesAt - move.startedAt;
        const progress = Math.min(1, Math.max(0, (serverTime - move.startedAt) / Math.max(1, duration)));
        patrol.observeJourney(elapsed > 1600 ? 0 : poseDt, progress, Math.max(1, duration) / 1000);
      } else {
        const [x, y, z] = resident.position;
        const previous = move?.points.at(-2);
        observedPosition.set(x, y, z);
        const meeting = projection?.social?.meeting;
        const task = projection?.survey?.task;
        const surveying = task?.status === 'surveying' && projection?.survey.arrived.includes(id);
        const inspecting = surveying && task?.inspections[id].startedAt !== undefined && !task.inspections[id].finding;
        const peer = meeting?.status === 'talking' || meeting?.status === 'completed' ? projection?.residents.find(({ residentId, position, movement }) => residentId !== id && movement?.status !== 'walking' && Math.hypot(position[0]-x, position[2]-z) < 3) : undefined;
        if (surveying) observedFacing.set(x + (id === '01' ? 0.3 : -0.4), y, z + 1.6);
        else if (peer) observedFacing.set(...peer.position);
        else observedFacing.set(previous ? 2 * x - previous[0] : x, y, previous ? 2 * z - previous[2] : z - 1);
        const line = meeting?.status === 'talking' ? meeting.lines.at(-1) : undefined;
        patrol.observe(poseDt, observedPosition, observedFacing, false,
          inspecting ? 'nod' : line?.residentId === id ? (meeting?.lines.length === 1 ? 'wave' : 'nod') : undefined);
      }
    }
    if (speech && speechCanvas && speechTexture) {
      const meeting = projection?.social?.meeting;
      const dialogue = meeting?.status === 'talking' ? meeting.lines.at(-1) : undefined;
      const task = projection?.survey?.task;
      const observation = task?.status === 'surveying' ? projection?.survey.events.filter((event) => event.taskId === task.id && (event.kind === 'SURVEY_INSPECTING' || event.kind === 'SURVEY_RECORDED') && event.residentId).at(-1) : undefined;
      const line = dialogue ? { ...dialogue, key: `${meeting!.id}:${dialogue.happenedAt}` } : observation?.residentId ? { residentId: observation.residentId, text: observation.text, key: observation.id } : undefined;
      const speaker = line && selectableActor(line.residentId)?.patrol.root;
      speech.visible = Boolean(line && speaker?.visible && mode === 'follow');
      if (line && speaker && speech.visible) {
        const key = line.key;
        if (key !== speechKey) {
          speechKey = key;
          const ctx = speechCanvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, 576, 176);
            ctx.fillStyle = '#17191bf5'; ctx.strokeStyle = line.residentId === '01' ? '#f0b90b' : '#79bab7'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.roundRect(5, 5, 566, 148, 18); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(269, 150); ctx.lineTo(288, 173); ctx.lineTo(307, 150); ctx.fill();
            ctx.font = 'bold 25px Microsoft YaHei, sans-serif'; ctx.fillStyle = ctx.strokeStyle;
            ctx.fillText(`${line.residentId} 号`, 25, 40);
            ctx.font = '28px Microsoft YaHei, sans-serif'; ctx.fillStyle = '#f3ead6';
            const text = Array.from(line.text);
            const characters = text.length > 38 ? [...text.slice(0, 37), '…'] : text;
            for (let i = 0; i < characters.length; i += 19) ctx.fillText(characters.slice(i, i + 19).join(''), 25, 80 + (i / 19) * 38);
            speechTexture.needsUpdate = true;
          }
        }
        speech.position.copy(speaker.position); speech.position.y += 2.05;
        const factor = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, host.clientHeight);
        speech.scale.set(252 * factor, 77 * factor, 1);
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
    const primary = sharedMode ? sharedActors.get('01')?.patrol : primaryAgent?.patrol;
    const shift = cafeSnapshot?.run;
    const cityWalk = cityObservation?.movement;
    const projectedPosition = !cafeMode ? cityObservation?.position : undefined;
    const nearMarketOnPatrol = !sharedMode && !cafeMode && !cityWalk && !projectedPosition && primaryAgent?.destination === 'market';
    const greeting = marketGreeting(!cafeMode && playing ? dt : 0, nearMarketOnPatrol ? primary : undefined, marketGuest?.patrol);
    const latestActivity = cityObservation?.recentActivities?.[0];
    const conversation = latestActivity?.status === 'running' && latestActivity.kind === 'talk' ? latestActivity : undefined;
    const surveying = latestActivity?.status === 'running' && latestActivity.kind === 'survey';
    const pilot = cityObservation?.lightingPilot;
    const worker = pilot?.worker;
    const theatre = cityObservation?.theatre;
    const theatre01 = theatre?.residents['01'];
    const theatre03 = theatre?.residents['03'];
    const byPier = cafeMode && !cityWalk && shift?.place === 'pier';
    const observer = cityWalk ? undefined : shift?.observer;
    const outing = observer && shift?.phase !== 'done' ? undefined : cityObservation?.eveningWalk?.recent[0];
    const theatre03Walk = (!observer || shift?.phase === 'done') && theatre03?.walk
      && theatre03.walk.startedAt >= (outing?.movement.startedAt ?? 0) ? theatre03.walk : undefined;
    const thirdWalk = theatre03Walk ?? outing?.movement;
    const interviewing = !cityWalk && shift?.phase === 'interviewing';
    const travelling = !cityWalk && (shift?.phase === 'toPier' || shift?.phase === 'toCounter');
    const social = !cityWalk && (shift?.phase === 'inviting' || shift?.phase === 'chatting' || shift?.phase === 'reconnecting'
      || (interviewing && !byPier));
    const poseDt = playing ? dt : 0;
    const cityTime = (cityObservation?.serverTime ?? 0) + (playing ? now - cityReceivedAt : 0);
    if (!sharedMode) poseWorksSite(pilot, cityTime, poseDt, conversation?.person?.id === WORKS_MANAGER ? primary?.root.position : undefined);
    let observedProgress: number | undefined;
    if (sharedMode) {
      poseShared(now, poseDt);
    } else if (cafeMode) {
      if (theatre?.booking && districts.west.asset) {
        if (!theatreLights) {
          theatreLights = createTheatreLighting();
          cafeProps.add(theatreLights.group);
        }
        const open = theatre.phase === 'open';
        if (open !== theatreOpen) {
          theatreOpen = open;
          theatreLights.setOpen(open);
        }
        if (theatre.programme && !stageInstallation) {
          stageInstallation = createStageInstallation();
          cafeProps.add(stageInstallation.group);
        }
        stageInstallation?.update(cityTime - theatre.booking.opensAt, playing && tween);
      }
      marketGuest?.patrol.observe(poseDt, coworker, counter, false, social ? 'nod' : undefined);
      const time = (cafeSnapshot?.serverTime ?? 0) + (playing ? now - receivedAt : 0);
      const duration = shift?.until ? shift.until - shift.since : 0;
      const progress = shift && duration > 0 ? THREE.MathUtils.clamp((time - shift.since) / duration, 0, 1) : 0;
      if ((!cityWalk && shift?.requestedActivity === 'fish' || observer) && districts.shore.status === 'idle') loadDistrict('shore', true);
      if (thirdWalk && strollAssetsFor !== thirdWalk.requestId) {
        strollAssetsFor = thirdWalk.requestId;
        loadRouteRegions(thirdWalk.regions);
      }
      if ((thirdWalk || (observer && districts.shore.status === 'ready')) && !regularRequested) {
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
        pierRegular.patrol.root.visible = Boolean(thirdWalk || observer);
        if (thirdWalk) {
          const movement = thirdWalk;
          const target = movement.points.at(-1)!;
          const [x, z] = movement.facing!;
          const { progress, walkingMs, stop } = cityWalkTiming(movement, cityTime);
          const sitting = Boolean(theatre03Walk && theatre03?.status === 'seated');
          if (!sitting && !stop && cityTime < movement.arrivesAt && walkingMs > 0) {
            if (strollJourney !== movement.requestId) {
              pierRegular.patrol.plan(movement.points, [x, z]);
              strollJourney = movement.requestId;
            }
            pierRegular.patrol.observeJourney(poseDt, progress, walkingMs / 1000);
          } else {
            const position = sitting ? theatre03!.position! : stop?.position ?? target;
            observedPosition.set(...position);
            observedFacing.set(x, position[1], z);
            pierRegular.patrol.observe(poseDt, observedPosition, observedFacing, false, undefined, sitting);
          }
        } else if (observer) {
          pierRegular.patrol.observe(poseDt, regularPosition, interviewSpot, false, interviewing && byPier ? 'nod' : undefined);
        }
      }
      const phase = shift?.phase;
      const fishing = !cityWalk && (phase === 'casting' || phase === 'fishing' || phase === 'reeling');
      if (!fishing) fishingGear?.hide();
      if (cityWalk) {
        const seat = theatre01?.status === 'seated' && theatre01.walk?.requestId === cityWalk.requestId
          ? theatre01.position : undefined;
        poseCityWalk(cityWalk, primary, cityTime, poseDt, conversation?.person ? siteHost?.position ?? counterFacing : undefined, seat);
      } else if (travelling && pierRoute && primary) {
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
    } else {
      if (cityWalk) {
        const talkTarget = conversation?.person ? observedFacing.set(...conversation.person.position) : undefined;
        observedProgress = poseCityWalk(cityWalk, primary, cityTime, poseDt, talkTarget);
      } else if (projectedPosition && primary) {
        observedPosition.set(...projectedPosition);
        primary.observe(poseDt, observedPosition, counterFacing);
      }
      if (marketGuest) {
        marketGuest.patrol.root.visible = !worker;
        if (playing && !worker) marketGuest.patrol.advance(dt, greeting.visitor);
      }
    }
    for (const [id, agent] of agents) {
      if (sharedMode) continue;
      const { patrol } = agent;
      const greetingHere = id === '01' && greeting.active;
      const hasCityPosition = id === '01' && !cafeMode && (cityWalk || projectedPosition);
      if (playing && !cafeMode && !hasCityPosition) {
        const cue = greetingHere ? greeting.resident : { hold: 'end' as const, face: patrol.phase === 'arrived' ? agent.lookAt : undefined };
        patrol.advance(dt, cue);
        if (patrol.phase === 'arrived' && patrol.dwelledSeconds >= 4 && !greetingHere) chooseNext(id, agent);
      }
      const status: Activity = greetingHere ? 'greeting' : patrol.phase === 'arrived' ? 'arrived' : 'outbound';
      const { progress } = patrol;
      let report: AgentReport = { status, progress, from: agent.from, destination: agent.destination };
      if (hasCityPosition) {
        report = { status: observedProgress !== undefined && observedProgress < 1 ? 'outbound' : 'arrived',
          progress: Math.round(100 * (observedProgress ?? 1)) };
        const destination = cityWalk && 'place' in cityWalk.destination ? cityWalk.destination.place : undefined;
        if (destination && Object.hasOwn(DESTINATION_FACING, destination)) report.destination = destination as Place;
      }
      if (agent.reported?.status !== report.status || agent.reported.progress !== report.progress
        || agent.reported.destination !== report.destination || agent.reported.from !== report.from) {
        agent.reported = report;
        callbacks.agent(id, report);
      }
    }

    const patrol = followedPatrol();
    const following = mode === 'follow' && patrol;
    const district = mode !== 'overview' && mode !== 'follow' ? districts[mode] : undefined;
    const framedLandmarkLoaded = framedLandmark === 'works' || framedLandmark === 'registry' ? districts.east.asset
      : framedLandmark === 'center' ? districts.research.asset : framedLandmark === 'governance' ? north : model;
    const wide = Boolean(citywide && (mode === 'overview' && (!framedLandmark || !framedLandmarkLoaded)
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
      const noticeFrame = followed === '01' && cityWalk?.facing ? 1 - THREE.MathUtils.smoothstep(feet.distanceTo(councilNotice), 2, 7) : 0;
      const workFrame = followed === '02' && worker ? THREE.MathUtils.smoothstep(-feet.z, 154, 168) : 0;
      const surveyFrame = followed === '01' && surveying ? THREE.MathUtils.smoothstep(-feet.z, 150, 164) : 0;
      const strollFrame = followed === '03' && outing && !theatre03Walk ? THREE.MathUtils.smoothstep(-feet.z, 150, 164) : 0;
      const shoreFrame = Math.max(workFrame, surveyFrame, strollFrame);
      const hallFrame = (1 - THREE.MathUtils.smoothstep(feet.distanceTo(landmarkEntrances.hall), 7, 41)) * (1 - noticeFrame);
      const forumFrame = 1 - THREE.MathUtils.smoothstep(feet.distanceTo(forumEntrance), 3, 20);
      const pierFrame = 1 - THREE.MathUtils.smoothstep(feet.distanceTo(pierEntrance), 4, 23);
      const centerFrame = 1 - THREE.MathUtils.smoothstep(feet.distanceTo(centerEntrance), 4, 17);
      const residenceFrame = 1 - THREE.MathUtils.smoothstep(feet.distanceTo(residenceEntrance), 4, 21);
      const entranceFrame = Math.max(registryFrame, worksFrame, hallFrame, forumFrame, pierFrame, centerFrame, residenceFrame);
      aim.y += 0.58 * entranceFrame;
      aim.y += 3.15 * hallFrame + 1.45 * centerFrame + 1.08 * residenceFrame + 0.48 * noticeFrame
        + 0.41 * surveyFrame - 0.12 * workFrame + 0.21 * strollFrame;
      aim.x -= 1.1 * centerFrame;
      aim.z += 1.15 * worksFrame + 1.8 * forumFrame - 1.6 * pierFrame - 0.65 * registryFrame
        - 1.2 * residenceFrame - 3.7 * hallFrame - 0.48 * noticeFrame - 0.8 * surveyFrame - 0.52 * workFrame - 0.86 * strollFrame;
      if (followed === '01' && byPier && !observer) {
        aim.x += 1.42;
        aim.y -= 1.20;
        aim.z += 0.55;
      }
      if (followed === '01' && byPier && observer && !travelling) {
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
      const sharedPhase = sharedSnapshot?.social?.meeting?.status;
      const surveyPair = sharedMode && (sharedSnapshot?.survey?.task?.status === 'surveying' || sharedSnapshot?.survey?.task?.status === 'completed') && sharedSnapshot.survey.arrived.length === 2;
      const sharedPeer = sharedMode && (surveyPair || sharedPhase === 'talking' || sharedPhase === 'completed') && followed !== WORKS_MANAGER
        ? selectableActor(followed === '01' ? '02' : '01')?.patrol.root : undefined;
      const sharedPair = Boolean(sharedPeer?.visible && sharedPeer.position.distanceTo(feet) < (surveyPair ? 9 : 3));
      if (sharedPair && sharedPeer) {
        aim.x = (feet.x + sharedPeer.position.x) / 2;
        aim.y = (feet.y + sharedPeer.position.y) / 2 + (surveyPair ? 1.65 : 1.25);
        aim.z = (feet.z + sharedPeer.position.z) / 2;
      }
      const greetingDistance = camera.aspect < 0.8 ? Math.max(5.6, followDistance) : Math.max(3.9, followDistance * 0.76);
      const streetDistance = THREE.MathUtils.lerp(followDistance, greetingDistance, greetingFraming)
        + 2.2 * entranceFrame + 1.8 * forumFrame + 3.3 * centerFrame + 3.3 * residenceFrame + 8.8 * hallFrame;
      const distance = sharedPair ? Math.max(surveyPair ? 11.8 : 6.2, followDistance) : THREE.MathUtils.lerp(streetDistance, Math.min(followDistance, 4.8), shoreFrame);
      // Frame the shop from the street side as the Agent passes the entrance tree.
      const streetSide = THREE.MathUtils.smoothstep(feet.z, 47, 56);
      const northSide = 1 - THREE.MathUtils.smoothstep(feet.z, -22, 18);
      const centralYaw = THREE.MathUtils.lerp(FOLLOW_YAW, 0.52, northSide) + streetSide * 1.14 + 0.32 * greetingFraming;
      const registryYaw = THREE.MathUtils.lerp(centralYaw, -0.54, registryFrame);
      const landmarkYaw = THREE.MathUtils.lerp(registryYaw, -2.76, worksFrame);
      const forumYaw = THREE.MathUtils.lerp(landmarkYaw, -2.85, forumFrame);
      const pierYaw = THREE.MathUtils.lerp(forumYaw, 0.64, pierFrame);
      const centerYaw = THREE.MathUtils.lerp(pierYaw, 1.13, centerFrame);
      const closeCafe = cafeMode && followed === '01' && !travelling && !byPier;
      const usualYaw = followed === '01' && byPier && !travelling ? observer ? 0.10 : 0.49
        : closeCafe ? -2.55 : THREE.MathUtils.lerp(centerYaw, 0.24, residenceFrame);
      const entranceYaw = THREE.MathUtils.lerp(usualYaw, 0.20, Math.max(hallFrame, noticeFrame));
      const yaw = followYaw + (sharedPair ? (surveyPair ? -1.85 : -2.65) : THREE.MathUtils.lerp(entranceYaw, followed === '02' ? 1.17 : 0.85, shoreFrame));
      // Lift the follow view above the banners on the plaza edge and the lamps at the north crossing.
      const plazaEdge = THREE.MathUtils.smoothstep(feet.x, 4, 9)
        * THREE.MathUtils.smoothstep(feet.z, 13, 18) * (1 - THREE.MathUtils.smoothstep(feet.z, 27, 33));
      const northCrossing = THREE.MathUtils.smoothstep(feet.z, -82, -74)
        * (1 - THREE.MathUtils.smoothstep(feet.z, -50, -43));
      const pitch = sharedPair ? (surveyPair ? .53 : Math.min(.65, followPitch)) : Math.min(1.3, followPitch + 0.32 * Math.max(plazaEdge, northCrossing, forumFrame)
        - 0.12 * greetingFraming - 0.07 * residenceFrame - 0.20 * hallFrame - 0.11 * shoreFrame);
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
      const target = framedLandmark ? landmarkTarget : wide && !district ? citywideFocus
        : mode === 'west' && cafeMode && theatre?.booking && districts.west.asset ? theatreFocus
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
    if (callbacks.onSelect) {
      updateResidentMarkers();
      updateSelectionOutline();
    }
    renderer.render(scene, camera);
    const showStreetDetails = mode === 'east' || mode === 'west' || mode === 'research'
      || (mode === 'follow' && patrol && patrol.root.position.z > -44) || orbitDistance < 59;
    const readyForDetails = !actorLoading && now - firstCityFrame > 650
      && (sharedMode || cafeMode || !playing || !primary || primary.progress > 0);
    if (!document.hidden && readyForDetails) {
      const nearMarket = marketEntrance.distanceTo(camera.position) < 29 || (primary && marketEntrance.distanceTo(primary.root.position) < 29);
      if (nearMarket) {
        loadDetail('market');
        if (!sharedMode) loadMarketGuest();
      }
      if (!wide && showStreetDetails) loadDetail('street');
      if (!sharedMode && !cafeMode && playing && (!primary || primary.progress >= 10)) loadNorth();
      if (!sharedMode && !cafeMode && playing && (!primary || primary.progress >= 30) && districts.east.status === 'idle') loadDistrict('east', false);
      if (!sharedMode && playing && (!primary || primary.progress >= 55) && districts.east.status !== 'loading' && districts.west.status === 'idle') loadDistrict('west', false);
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
    const { clientX: x, clientY: y } = event;
    pointers.set(event.pointerId, { x, y, startX: x, startY: y, dragging: false });
    if (pointers.size > 1) for (const pointer of pointers.values()) pointer.dragging = true;
  }

  function onPointerMove(event: PointerEvent) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = { ...previous, x: event.clientX, y: event.clientY };
    if (!previous.dragging && callbacks.onSelect) {
      if (Math.hypot(next.x - previous.startX, next.y - previous.startY) < 5) return;
      next.dragging = true;
    }
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
    if (mode === 'follow' && followedPatrol()) {
      followYaw -= dx * 0.006;
      followPitch = THREE.MathUtils.clamp(followPitch - dy * 0.006, 0.16, 1.18);
    } else {
      orbitYaw -= dx * 0.006;
      orbitPitch = THREE.MathUtils.clamp(orbitPitch - dy * 0.006, 0.48, 1.45);
    }
  }

  function pickSelection(clientX: number, clientY: number) {
    const bounds = canvas.getBoundingClientRect();
    const x = (clientX - bounds.left) / bounds.width;
    const y = (clientY - bounds.top) / bounds.height;
    if (!bounds.width || !bounds.height || x < 0 || x > 1 || y < 0 || y > 1) return;
    pointer.set(x * 2 - 1, 1 - y * 2);
    raycaster.setFromCamera(pointer, camera);
    raycaster.near = camera.near;
    raycaster.far = camera.far;
    let target: WalkSelection | null = null;
    let nearest = Infinity;

    for (const [id, options] of landmarkModels) {
      for (const option of options) {
        if (!isRendered(option.root) || !raycaster.ray.intersectsBox(option.bounds)) continue;
        const hit = raycaster.intersectObjects(option.meshes.filter(isRendered), false)[0];
        if (hit && hit.distance < nearest) {
          nearest = hit.distance;
          target = { kind: 'building', id };
        }
      }
    }
    for (const id of SELECTABLE_ACTORS) {
      const actor = selectableActor(id);
      if (!actor || !isRendered(actor.patrol.root)) continue;
      const marker = residentMarkers.get(id);
      const hits = marker?.visible ? raycaster.intersectObject(marker, false) : [];
      actor.asset.scene.traverseVisible((node) => {
        if (node instanceof THREE.Mesh) node.raycast(raycaster, hits);
      });
      for (const hit of hits) {
        if (hit.distance < nearest) {
          nearest = hit.distance;
          target = id === WORKS_MANAGER ? { kind: 'person', id } : { kind: 'resident', id };
        }
      }
    }

    if (target) {
      // The selectable mesh can sit behind an unselectable asset such as a tree or a roof.
      const city = citywide?.visible ? citywide : street;
      blockingGeometries.length = 0;
      city.traverseVisible((node) => {
        if (node instanceof THREE.Mesh) blockingGeometries.push(node);
      });
      raycaster.far = nearest - 0.025;
      if (raycaster.intersectObjects(blockingGeometries, false).length) target = null;
      blockingGeometries.length = 0;
    }
    selection = target;
    callbacks.onSelect?.(target);
  }

  function onPointerUp(event: PointerEvent) {
    const press = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (!callbacks.onSelect || !press || press.dragging || !model || contextLost) return;
    if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) < 5) pickSelection(event.clientX, event.clientY);
  }

  function cancelPointer(event: PointerEvent) {
    pointers.delete(event.pointerId);
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    for (const pointer of pointers.values()) pointer.dragging = true;
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
  canvas.addEventListener('pointerup', onPointerUp, { signal });
  canvas.addEventListener('pointercancel', cancelPointer, { signal });
  canvas.addEventListener('lostpointercapture', cancelPointer, { signal });
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
      asset.traverse((node) => {
        const match = LANDMARK_NAMES.find(([prefix]) => node.name.startsWith(prefix));
        if (match) registerLandmark(match[1], node);
      });
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
      if (kind !== 'street') registerLandmark(kind === 'hall' ? 'governance' : kind, asset);
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
      request('governance-north-council-notice.glb', priority).then((response) => response.arrayBuffer()),
      cafeMode || sharedMode ? undefined : request('agent-03.glb', priority).then((response) => response.arrayBuffer()).catch(() => undefined),
    ]).then(async ([layout, connector, cityBytes, agentBytes]) => {
      if (ended || contextLost) return;
      const city = await loader.parseAsync(cityBytes, ASSET_PATH);
      if (ended || contextLost) { disposeModel(city.scene); return; }
      navigation.connect('plaza', 'plazaNorth', connector);
      navigation.connect('plazaNorth', 'governance', layout);
      north = city.scene;
      prepareEnvironment(north, streetAnisotropy);
      updateCouncilNotice = addCouncilNotice(north);
      updateCouncilReceipt();
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

      if (cafeMode || sharedMode) return;
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
        actorLayer.add(patrol.root);
        if (callbacks.onSelect && !cityObservation?.lightingPilot?.worker) {
          callbacks.agent('02', { status: 'arrived', progress: 100, destination: 'market' });
        }
      } catch {
        disposeModel(asset.scene);
      }
    }).catch(() => {});
  }

  function loadSiteHost(point: CityPoint) {
    siteHostRequested = true;
    request('agent-02.glb', 'low').then((response) => response.arrayBuffer()).then(async (bytes) => {
      if (ended || contextLost) return;
      const asset = await loader.parseAsync(bytes, ASSET_PATH);
      if (ended || contextLost) { disposeModel(asset.scene); return; }
      const position = new THREE.Vector3(...point);
      const facing = position.clone().add(new THREE.Vector3(-1, 0, -0.4));
      try {
        const patrol = createAgentPatrol(asset, [point, facing.toArray()], [facing.x, facing.z]);
        siteHost = { asset, patrol, position, facing };
        actorLayer.add(patrol.root);
      } catch {
        disposeModel(asset.scene);
      }
    }).catch(() => {});
  }

  function loadRouteRegions(regions: CityRegion[]) {
    for (const region of regions) {
      if (region === 'north') loadNorth(true);
      else loadDistrict(region, true);
    }
  }

  function updateCouncilReceipt() {
    const pilot = cityObservation?.lightingPilot;
    const text = pilot ? LIGHTING_PILOT_STATUS[pilot.stage] : cityObservation?.lightingSurvey === 'submitted' ? COUNCIL_SURVEY_RECEIPT : '';
    const theatre = cityObservation?.theatre;
    const booking = theatre?.booking;
    const programme = theatre?.phase === 'open' ? '社区剧场 · 已开放'
      : theatre?.phase === 'finished' ? '社区剧场 · 试演结束'
        : booking ? `剧场 · ${THEATRE_CLOCK.format(booking.opensAt)} 开放` : COUNCIL_DEMO_AGENDA[1];
    updateCouncilNotice?.(text, programme);
  }

  if (!sharedMode) request('agent-01.glb').then((response) => response.arrayBuffer()).then(async (bytes) => {
    if (ended || contextLost) return;
    const result = await loader.parseAsync(bytes, ASSET_PATH);
    if (ended || contextLost) { disposeModel(result.scene); return; }
    actor = result;
    connectPrimary();
  }).catch(() => {
    if (!ended && !contextLost) callbacks.agent('01', { status: 'unavailable', progress: 0 });
  }).finally(() => { actorLoading = false; });

  async function loadSharedActor(id: SharedResident, file: string) {
    if (sharedRequests.get(id)?.file === file) return;
    const pending = { file };
    sharedRequests.set(id, pending);
    const current = () => !ended && !contextLost && sharedRequests.get(id) === pending;
    const removePrevious = () => {
      const previous = sharedActors.get(id);
      if (!previous) return;
      actorLayer.remove(previous.patrol.root);
      previous.patrol.dispose();
      disposeModel(previous.asset.scene);
      sharedActors.delete(id);
      sharedJourneys.delete(id);
    };
    let asset: GLTF | undefined;
    try {
      const bytes = await (await request(file)).arrayBuffer();
      if (!current()) return;
      asset = await loader.parseAsync(bytes, ASSET_PATH);
      if (!current()) { disposeModel(asset.scene); return; }
      const start: RoutePoint = [...CAFE_COUNTER];
      const facing: RoutePoint = [start[0], start[1], start[2] + 1];
      const patrol = createAgentPatrol(asset, [start, facing], [facing[0], facing[2]]);
      patrol.root.visible = false;
      removePrevious();
      sharedActors.set(id, { asset, patrol });
      actorLayer.add(patrol.root);
    } catch {
      if (asset) disposeModel(asset.scene);
      if (current()) {
        removePrevious();
        callbacks.agent(id, { status: 'unavailable', progress: 0 });
      }
      return;
    }
    callbacks.agent(id, { status: 'arrived', progress: 100 });
  }

  if (sharedMode && initialView === 'overview') loadCitywide();
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
    if (cafeMode || sharedMode) {
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
    syncShared(snapshot) {
      sharedSnapshot = snapshot;
      sharedReceivedAt = performance.now();
      if (!sharedMode || !snapshot) return;
      for (const id of SHARED_RESIDENTS) {
        const avatar = snapshot.profiles.find((profile) => profile.residentId === id)?.avatar;
        void loadSharedActor(id, SHARED_AVATARS[avatar ?? (id === '01' ? 'citizen' : 'builder')].asset);
      }
    },
    syncCity(observation) {
      cityObservation = observation;
      cityReceivedAt = performance.now();
      updateCouncilReceipt();
    },
    view: setView,
    select(target) { selection = target; },
    focus: focusSelection,
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
      for (const { asset, patrol } of sharedActors.values()) {
        patrol.dispose();
        disposeModel(asset.scene);
      }
      if (pierRegular) {
        pierRegular.patrol.dispose();
        disposeModel(pierRegular.asset.scene);
      }
      if (siteHost) {
        siteHost.patrol.dispose();
        disposeModel(siteHost.asset.scene);
      }
      if (actor) disposeModel(actor.scene);
      if (model) disposeModel(model);
      if (north) disposeModel(north);
      disposeModel(cafeProps);
      disposeModel(lightingProps);
      fishingGear?.dispose();
      if (citywide) disposeModel(citywide);
      for (const { asset } of Object.values(districts)) {
        if (asset) disposeModel(asset);
      }
      if (retailSource) disposeModel(retailSource);
      for (const detail of details.values()) disposeModel(detail);
      buildingOutline.geometry.dispose();
      residentOutline.geometry.dispose();
      selectionMaterial.dispose();
      markerMaterial?.map?.dispose();
      markerMaterial?.dispose();
      for (const material of sharedMarkerMaterials) { material.map?.dispose(); material.dispose(); }
      speechTexture?.dispose(); speechMaterial?.dispose();
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
