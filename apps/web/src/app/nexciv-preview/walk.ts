import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createAgentPatrol, type RoutePoint } from './agent';
import { createMarketGreeting } from './marketGreeting';
import { createNavigation, DESTINATION_FACING, placeAt, type AgentStart, type Connection, type EastRoutes, type Place, type ResidentId, type Visits } from './navigation';

export type District = 'east' | 'west' | 'shore';
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
  fps: (value: number) => void;
};

export type WalkController = {
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
const EAST_PITCH = 1.02;
const EAST_DISTANCE = 143;
const WEST_DISTANCE = 130;
const DISTRICT_FILES: Record<District, [string, string]> = {
  east: ['east-routes.json', 'east-civic-district.glb'],
  west: ['west-route.json', 'west-community-district.glb'],
  shore: ['lakeshore-route.json', 'north-lakeshore.glb'],
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
};
type Detail = keyof typeof DETAIL_FILES;

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

function setBuildingShadows(asset: THREE.Object3D) {
  const pavement = new Set<THREE.Object3D>();
  asset.getObjectByName('NEXCIV_paving')?.traverse((object) => pavement.add(object));
  asset.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const terrain = object.name === 'NEXCIV_terrain' || object.userData.previewTier === 'land';
    object.castShadow = !materials.some((material) => material.transparent) && !terrain && !pavement.has(object);
    object.receiveShadow = true;
  });
}

function isGardenRetail(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh && object.name.replace(/[^a-z0-9]/gi, '').startsWith(RETAIL_PREFIX);
}

function softenRetailWindows(asset: THREE.Object3D) {
  asset.traverse((object) => {
    if (!isGardenRetail(object)) return;
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
  const camera = new THREE.PerspectiveCamera(49, 1, 0.18, 285);
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
  const eastFocus = new THREE.Vector3(83, 0, 44);
  const westFocus = new THREE.Vector3(-83, 0, 61);
  const shoreFocus = new THREE.Vector3(4, 0, -178);
  const pierEntrance = new THREE.Vector3(71, 0.09, -190);
  const lakeTime = { value: 0 };
  const forumEntrance = new THREE.Vector3(-94, 1, 75);
  const viewFocus = focus.clone();
  const aim = new THREE.Vector3();
  const marketEntrance = new THREE.Vector3();
  const eastEntrances = {
    registry: new THREE.Vector3(80, 1, -14),
    works: new THREE.Vector3(95, 1, 72),
  };
  const retailFrustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const retailPlacements: { mid: THREE.Mesh; bounds: THREE.Sphere; close?: THREE.Mesh }[] = [];
  const tween = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointers = new Map<number, { x: number; y: number }>();
  const aborter = new AbortController();
  let ended = false;
  let contextLost = false;
  let model: THREE.Object3D | undefined;
  let north: THREE.Object3D | undefined;
  let northLoading: Promise<void> | undefined;
  let northFailed = false;
  const districts: Record<District, { asset?: THREE.Object3D; status: DistrictStatus }> = {
    east: { status: 'idle' },
    west: { status: 'idle' },
    shore: { status: 'idle' },
  };
  const details = new Map<Detail, THREE.Object3D>();
  const requestedDetails = new Set<Detail>();
  let retailSource: THREE.Object3D | undefined;
  let retailMesh: THREE.Mesh | undefined;
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
    else desiredDistance = THREE.MathUtils.clamp(desiredDistance * factor, 24, north || sideDistrictLoaded() ? 176 : 139);
  }

  function resetFollowCamera() {
    followYaw = 0;
    followPitch = followed === '03' ? 0.28 : FOLLOW_PITCH;
    followDistance = followed === '03' ? 7.4 : FOLLOW_DISTANCE;
    followHeight = undefined;
    greetingFraming = 0;
  }

  function sideDistrictLoaded() { return Boolean(districts.east.asset || districts.west.asset); }

  function resetOrbit() {
    orbitYaw = mode === 'west' ? -0.18 : START_YAW;
    orbitPitch = mode === 'shore' ? 0.76 : mode === 'east' || mode === 'west' ? EAST_PITCH : north ? EXPANDED_PITCH : START_PITCH;
    desiredDistance = mode === 'west' ? WEST_DISTANCE : mode === 'east' ? EAST_DISTANCE : mode === 'shore' ? 169 : north ? EXPANDED_DISTANCE : START_DISTANCE;
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
    if (next === 'east' || next === 'west' || next === 'shore') loadDistrict(next, true);
  }

  function attachAgent(id: AgentId, asset: GLTF, junction: AgentStart) {
    try {
      const from = placeAt(junction);
      const visits: Visits = { plaza: 0, market: 0, governance: 0, registry: 0, works: 0, forum: 0, pier: 0 };
      visits[from] = 1;
      const choice = navigation.choose(id, junction, visits);
      if (!choice) throw new Error('No reachable observation destination');
      const [x, z] = DESTINATION_FACING[choice.destination];
      const patrol = createAgentPatrol(asset, choice.path.points, [x, z]);
      scene.add(patrol.root);
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
        if (object.userData.previewTier === `${kind}_proxy`) members.push(object);
      });
      proxies.set(kind, members);
    }
  }

  function updateRetail() {
    if (!retailPlacements.length) return;
    camera.updateMatrixWorld();
    retailFrustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const placement of retailPlacements) {
      const { mid, bounds } = placement;
      const distance = camera.position.distanceTo(bounds.center);
      const showing = placement.close?.visible ?? false;
      const near = distance < (showing ? 86 : 76);
      if (near && !showing && retailFrustum.intersectsSphere(bounds)) {
        if (!retailMesh) {
          loadRetail();
          continue;
        }
        if (!placement.close) {
          const close = new THREE.Mesh(retailMesh.geometry, retailMesh.material);
          close.name = `${mid.name}_close`;
          close.matrix.copy(mid.matrixWorld);
          close.matrixAutoUpdate = false;
          close.castShadow = mid.castShadow;
          close.receiveShadow = mid.receiveShadow;
          scene.add(close);
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
    if (playing && tween && districts.shore.asset) lakeTime.value += dt;
    lastFrame = now;
    measurements++;
    if (now - measuredAt >= 1200) {
      callbacks.fps(Math.round(measurements * 1000 / (now - measuredAt)));
      measurements = 0;
      measuredAt = now;
    }

    const primaryAgent = agents.get('01');
    const primary = primaryAgent?.patrol;
    const greeting = marketGreeting(playing ? dt : 0, primaryAgent?.destination === 'market' ? primary : undefined, marketGuest?.patrol);
    if (playing) marketGuest?.patrol.advance(dt, greeting.visitor);
    for (const [id, agent] of agents) {
      const { patrol } = agent;
      const greetingHere = id === '01' && greeting.active;
      if (playing) {
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
    const seeingLake = Boolean(districts.shore.asset && (mode === 'shore' || (following && patrol.root.position.z < -132)));
    // Use more of the depth buffer for the surfaces visible from the high camera.
    const near = following ? 0.18 : Math.max(1, orbitDistance * 0.055);
    const far = seeingLake ? 520 : 285;
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
      const entranceFrame = Math.max(registryFrame, worksFrame, forumFrame, pierFrame);
      aim.y += 0.58 * entranceFrame;
      aim.z += 1.15 * worksFrame + 1.8 * forumFrame - 1.6 * pierFrame - 0.65 * registryFrame;
      const frameGuest = followed === '01' && greeting.active ? 1 : 0;
      greetingFraming = tween ? THREE.MathUtils.damp(greetingFraming, frameGuest, 7, dt) : frameGuest;
      if (followed === '01' && marketGuest) {
        const guest = marketGuest.patrol.root.position;
        aim.x = THREE.MathUtils.lerp(aim.x, guest.x, greetingFraming * 0.5);
        aim.z = THREE.MathUtils.lerp(aim.z, guest.z, greetingFraming * 0.5);
      }
      const greetingDistance = camera.aspect < 0.8 ? Math.max(5.6, followDistance) : Math.max(3.9, followDistance * 0.76);
      const distance = THREE.MathUtils.lerp(followDistance, greetingDistance, greetingFraming) + 2.2 * entranceFrame + 1.8 * forumFrame;
      // Frame the shop from the street side as the Agent passes the entrance tree.
      const streetSide = THREE.MathUtils.smoothstep(feet.z, 47, 56);
      const northSide = 1 - THREE.MathUtils.smoothstep(feet.z, -22, 18);
      const centralYaw = THREE.MathUtils.lerp(FOLLOW_YAW, 0.52, northSide) + streetSide * 1.14 + 0.32 * greetingFraming;
      const registryYaw = THREE.MathUtils.lerp(centralYaw, -0.54, registryFrame);
      const landmarkYaw = THREE.MathUtils.lerp(registryYaw, -2.76, worksFrame);
      const forumYaw = THREE.MathUtils.lerp(landmarkYaw, -2.85, forumFrame);
      const yaw = followYaw + THREE.MathUtils.lerp(forumYaw, 0.64, pierFrame);
      // Lift the follow view above the banners on the plaza edge and the lamps at the north crossing.
      const plazaEdge = THREE.MathUtils.smoothstep(feet.x, 4, 9)
        * THREE.MathUtils.smoothstep(feet.z, 13, 18) * (1 - THREE.MathUtils.smoothstep(feet.z, 27, 33));
      const northCrossing = THREE.MathUtils.smoothstep(feet.z, -82, -74)
        * (1 - THREE.MathUtils.smoothstep(feet.z, -50, -43));
      const pitch = Math.min(1.3, followPitch + 0.32 * Math.max(plazaEdge, northCrossing, forumFrame) - 0.12 * greetingFraming);
      camera.position.set(
        aim.x + distance * Math.sin(yaw) * Math.cos(pitch),
        aim.y + distance * Math.sin(pitch),
        aim.z + distance * Math.cos(yaw) * Math.cos(pitch),
      );
      camera.lookAt(aim);
    } else {
      fog.near = seeingLake ? 177 : north || sideDistrictLoaded() ? 165 : 110;
      fog.far = seeingLake ? 510 : north || sideDistrictLoaded() ? 275 : 235;
      orbitDistance = tween ? THREE.MathUtils.damp(orbitDistance, desiredDistance, 11, dt) : desiredDistance;
      const target = mode === 'shore' && districts.shore.asset ? shoreFocus
        : mode === 'east' && districts.east.asset ? eastFocus : mode === 'west' && districts.west.asset ? westFocus : focus;
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
    if (!document.hidden) {
      updateRetail();
      for (const kind of ['registry', 'works'] as const) {
        const close = details.get(kind);
        if (!close) continue;
        const show = eastEntrances[kind].distanceTo(camera.position) < (close.visible ? 40 : 33);
        if (show === close.visible) continue;
        close.visible = show;
        for (const proxy of proxies.get(kind) ?? []) proxy.visible = !show;
        renderer.shadowMap.needsUpdate = true;
      }
    }
    renderer.render(scene, camera);
    const showStreetDetails = mode === 'east' || mode === 'west' || (mode === 'follow' && patrol && patrol.root.position.z > -44) || orbitDistance < 59;
    const readyForDetails = !actorLoading && now - firstCityFrame > 650 && (!playing || !primary || primary.progress > 0);
    if (!document.hidden && readyForDetails) {
      const nearMarket = marketEntrance.distanceTo(camera.position) < 29 || (primary && marketEntrance.distanceTo(primary.root.position) < 29);
      if (nearMarket) {
        loadDetail('market');
        loadMarketGuest();
      }
      if (showStreetDetails) loadDetail('street');
      if (playing && (!primary || primary.progress >= 10)) loadNorth();
      if (playing && (!primary || primary.progress >= 30) && districts.east.status === 'idle') loadDistrict('east', false);
      if (playing && (!primary || primary.progress >= 55) && districts.east.status !== 'loading' && districts.west.status === 'idle') loadDistrict('west', false);
      const researcher = agents.get('03');
      if (playing && researcher?.destination === 'governance' && researcher.patrol.progress >= 50 && districts.shore.status === 'idle') {
        loadDistrict('shore', false);
      }
      if (districts.east.asset) {
        for (const kind of ['registry', 'works'] as const) {
          const entrance = eastEntrances[kind];
          if (entrance.distanceTo(camera.position) < 38) {
            loadDetail(kind);
          }
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

  function loadRetail() {
    if (retailRequested) return;
    retailRequested = true;
    request(RETAIL_DETAIL, 'low').then((response) => response.arrayBuffer()).then(async (bytes) => {
      if (ended || contextLost) return;
      const { scene: asset } = await loader.parseAsync(bytes, ASSET_PATH);
      const mesh = asset.children.find(isGardenRetail);
      if (ended || contextLost || !mesh) { disposeModel(asset); return; }
      softenRetailWindows(asset);
      retailSource = asset;
      retailMesh = mesh;
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
      setBuildingShadows(asset);
      // A failed request leaves the original silhouette visible.
      details.set(kind, asset);
      scene.add(asset);
      if (kind === 'registry' || kind === 'works') {
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

  function loadDistrict(side: District, interactive: boolean) {
    const district = districts[side];
    if (!model || ended || contextLost || district.status === 'ready' || district.status === 'loading') return;
    district.status = 'loading';
    callbacks.district(side, district.status);
    const [routeFile, meshFile] = DISTRICT_FILES[side];
    const priority = interactive ? 'auto' : 'low';
    Promise.all([
      request(routeFile, priority).then((response) => response.json() as Promise<EastRoutes | Connection>),
      request(meshFile, priority).then((response) => response.arrayBuffer()),
      side === 'shore' ? loadNorth(interactive) : undefined,
    ]).then(async ([layout, bytes]) => {
      if (ended || contextLost) return;
      if (side === 'shore' && !north) throw new Error('The lakeshore connection requires the governance district');
      const { scene: asset } = await loader.parseAsync(bytes, ASSET_PATH);
      if (ended || contextLost) { disposeModel(asset); return; }
      try {
        if (side === 'east') navigation.connectEast(layout as EastRoutes);
        else if (side === 'west') navigation.connect('plaza', 'forum', layout as Connection);
        else navigation.connect('governance', 'pier', layout as Connection);
      } catch (error) {
        disposeModel(asset);
        throw error;
      }
      district.asset = asset;
      setBuildingShadows(asset);
      if (side === 'shore') addLakeRipples(asset, lakeTime);
      softenRetailWindows(asset);
      scene.add(asset);
      if (side === 'east') registerProxies(asset, ['registry', 'works']);
      registerRetail(asset);
      const entrances = side === 'east' ? Object.values(eastEntrances) : [side === 'west' ? forumEntrance : pierEntrance];
      for (const entrance of entrances) {
        const lamp = new THREE.PointLight('#ffd08b', 65, 14, 2);
        lamp.position.copy(entrance);
        lamp.position.y = 3.5;
        scene.add(lamp);
      }
      if (side === 'east') sun.shadow.camera.right = 124;
      if (side === 'west') sun.shadow.camera.left = -125;
      sun.shadow.camera.far = Math.max(185, sun.shadow.camera.far);
      sun.shadow.camera.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate = true;
      district.status = 'ready';
      callbacks.district(side, district.status);
    }).catch(() => {
      if (ended || contextLost) return;
      district.status = 'unavailable';
      callbacks.district(side, district.status);
    });
  }

  function loadNorth(interactive = false) {
    if (northLoading || north || !model || ended || contextLost) return northLoading;
    if (northFailed && !interactive) return;
    const priority = interactive ? 'auto' : 'low';
    northLoading = Promise.all([
      request('governance-route.json', priority).then((response) => response.json() as Promise<RouteData>),
      request('nexus-connector.json', priority).then((response) => response.json() as Promise<Connection>),
      request('governance-north.glb', priority).then((response) => response.arrayBuffer()),
      request('agent-03.glb', priority).then((response) => response.arrayBuffer()).catch(() => undefined),
    ]).then(async ([layout, connector, cityBytes, agentBytes]) => {
      if (ended || contextLost) return;
      const city = await loader.parseAsync(cityBytes, ASSET_PATH);
      if (ended || contextLost) { disposeModel(city.scene); return; }
      navigation.connect('plaza', 'plazaNorth', connector);
      navigation.connect('plazaNorth', 'governance', layout);
      north = city.scene;
      setBuildingShadows(north);
      scene.add(north);
      softenRetailWindows(north);
      registerRetail(north);
      focus.set(...layout.target);
      if (mode === 'overview' && desiredDistance === START_DISTANCE && orbitPitch === START_PITCH) {
        desiredDistance = EXPANDED_DISTANCE;
        orbitPitch = EXPANDED_PITCH;
      }
      sun.position.z -= 35;
      sun.target.position.z -= 35;
      Object.assign(sun.shadow.camera, { top: 92, bottom: -92, far: sideDistrictLoaded() ? 185 : 178 });
      sun.shadow.camera.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate = true;
      const entranceLight = new THREE.PointLight('#ffd08b', 64, 14, 2);
      entranceLight.position.set(0, 4, -83);
      scene.add(entranceLight);

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
        scene.add(patrol.root);
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
    setBuildingShadows(model);
    softenRetailWindows(model);
    scene.add(model);
    connectPrimary();
    renderer.shadowMap.needsUpdate = true;
    firstCityFrame = lastFrame = measuredAt = performance.now();
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
      if (actor) disposeModel(actor.scene);
      if (model) disposeModel(model);
      if (north) disposeModel(north);
      for (const { asset } of Object.values(districts)) {
        if (asset) disposeModel(asset);
      }
      if (retailSource) disposeModel(retailSource);
      for (const detail of details.values()) disposeModel(detail);
      sun.shadow.dispose();
      environment.dispose();
      renderer.forceContextLoss();
      renderer.dispose();
      canvas.remove();
    },
  };
}
