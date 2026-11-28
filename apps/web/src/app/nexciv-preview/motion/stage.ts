import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export type Character = '02' | '06';
export type Motion = 'walk' | 'turn';
export type View = 'front' | 'side';

export const durations: Record<Motion, number> = { walk: 4.1, turn: 2.4 };

type Sidecar = {
  walkPath: { speed: number; start: number; duration: number; ramp: number };
  clips: Omit<ReturnType<typeof THREE.AnimationClip.toJSON>, 'uuid'>[];
};
const gaitOrder = ['100STYLE', 'Quaternius'] as const;
const clipSuffix: Record<Motion, string> = { walk: 'Walk', turn: 'Turn' };

function walkDistance(time: number, { speed, start, duration, ramp }: Sidecar['walkPath']) {
  const elapsed = THREE.MathUtils.clamp(time - start, 0, duration);
  if (elapsed <= ramp) return speed * elapsed ** 2 / (2 * ramp);
  if (elapsed >= duration - ramp) return speed * (duration - ramp - (duration - elapsed) ** 2 / (2 * ramp));
  return speed * (elapsed - ramp / 2);
}

function buildLane(model: THREE.Object3D, clips: Record<Motion, THREE.AnimationClip>) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#23272a');
  scene.add(new THREE.HemisphereLight('#fff3e0', '#aeb5c4', 2.45));
  const key = new THREE.DirectionalLight('#fff6e4', 2.9);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#c6e2ff', 1.4);
  rim.position.set(-2, 3, -3);
  scene.add(rim);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: '#3d4144', roughness: 0.96 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.014;
  scene.add(floor);
  const grid = new THREE.GridHelper(8, 16, '#64635c', '#505457');
  grid.position.y = -0.009;
  scene.add(grid);
  // Root translation moves the skin beyond its rest-pose bounds during the walking trial.
  model.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.frustumCulled = false;
  });
  scene.add(model);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 1.02), new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `varying vec2 point;
      void main() { point = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 point;
      void main() { gl_FragColor = vec4(0.08, 0.07, 0.06, 0.48 * (1.0 - smoothstep(0.05, 1.0, length(point)))); }`,
  }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = -0.003;
  scene.add(contact);
  const hips = model.getObjectByName('Hips')!;
  const hipCenter = new THREE.Vector3();
  const mixer = new THREE.AnimationMixer(model);
  function prepare(clip: THREE.AnimationClip) {
    const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
    action.paused = true;
    action.setEffectiveWeight(0).play();
    return action;
  }
  const actions = { walk: prepare(clips.walk), turn: prepare(clips.turn) };

  function pose(motion: Motion, time: number) {
    actions.walk.setEffectiveWeight(motion === 'walk' ? 1 : 0);
    actions.turn.setEffectiveWeight(motion === 'turn' ? 1 : 0);
    const action = actions[motion];
    action.time = Math.min(time, action.getClip().duration);
    mixer.update(0);
    hips.getWorldPosition(hipCenter);
    contact.position.x = hipCenter.x;
    contact.position.z = hipCenter.z;
  }

  return { scene, pose, release() { mixer.stopAllAction(); mixer.uncacheRoot(model); } };
}

function disposeScenes(...roots: THREE.Object3D[]) {
  const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  for (const root of roots) root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
    resources.add(object.geometry);
    for (const material of [object.material].flat()) {
      resources.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) resources.add(value);
    }
  });
  for (const root of roots) root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
  });
  for (const resource of resources) {
    if (resource instanceof THREE.Texture && typeof ImageBitmap !== 'undefined' &&
      resource.image instanceof ImageBitmap) resource.image.close();
    resource.dispose();
  }
}

export async function loadLanes(id: Character, signal: AbortSignal) {
  // Finish fetching both files before creating any Three.js resources.
  const [modelBytes, sidecar] = await Promise.all([
    fetch(`/nexciv-walk/agent-${id}.glb`, { signal }).then((response) => {
      if (!response.ok) throw new Error('无法读取角色模型');
      return response.arrayBuffer();
    }),
    fetch(`/nexciv-motion/agent-${id}.json`, { signal }).then(async (response) => {
      if (!response.ok) throw new Error('无法读取对照动作');
      return await response.json() as Sidecar;
    }),
  ]);
  signal.throwIfAborted();
  const clipsFor = (gait: typeof gaitOrder[number], motion: Motion) => {
    const name = `${gait}_${clipSuffix[motion]}`;
    const clip = sidecar.clips.find((entry) => entry.name === name);
    if (!clip) throw new Error(`Missing motion: ${name}`);
    return THREE.AnimationClip.parse({ ...clip, uuid: THREE.MathUtils.generateUUID() });
  };
  const clips = gaitOrder.map((gait) => ({ walk: clipsFor(gait, 'walk'), turn: clipsFor(gait, 'turn') }));
  let model: GLTF | undefined;
  let second: THREE.Object3D | undefined;
  try {
    model = await new GLTFLoader().parseAsync(modelBytes, '/nexciv-walk/');
    signal.throwIfAborted();
    const { scene } = model;
    second = clone(scene);
    const lanes = [buildLane(scene, clips[0]!), buildLane(second, clips[1]!)];
    return {
      lanes,
      walkPath: sidecar.walkPath,
      dispose() {
        for (const lane of lanes) lane.release();
        disposeScenes(...lanes.map((lane) => lane.scene));
      },
    };
  } catch (error) {
    if (model) disposeScenes(model.scene, ...(second ? [second] : []));
    throw error;
  }
}

export function createStage(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;
  renderer.setScissorTest(true);
  const camera = new THREE.OrthographicCamera();
  const focus = new THREE.Vector3(0, 0.77, -0.03);
  let aspect = 1;
  let width = 1;
  let height = 1;
  return {
    draw(data: Awaited<ReturnType<typeof loadLanes>>, motion: Motion, view: View, time: number) {
      const nextWidth = Math.max(2, canvas.clientWidth);
      const nextHeight = Math.max(2, canvas.clientHeight);
      if (nextWidth !== width || nextHeight !== height) {
        width = nextWidth;
        height = nextHeight;
        renderer.setSize(width, height, false);
        aspect = width / 2 / height;
      }
      const half = Math.max(1.02, (motion === 'walk' ? 1.16 : 0.83) / aspect);
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.top = half;
      camera.bottom = -half;
      camera.near = 0.1;
      camera.far = 42;
      const { walkPath } = data;
      const depth = motion === 'walk'
        ? (walkDistance(time, walkPath) - walkDistance(durations.walk, walkPath) / 2) * 0.62 : 0;
      focus.z = depth - 0.03;
      camera.position.set(view === 'side' ? 5.2 : 1.95, 2.15, depth + (view === 'side' ? 0.12 : 4.7));
      camera.lookAt(focus);
      camera.updateProjectionMatrix();
      for (const [index, lane] of data.lanes.entries()) {
        lane.pose(motion, time);
        const x = Math.floor(index * width / 2);
        const w = Math.floor((index + 1) * width / 2) - x;
        renderer.setViewport(x, 0, w, height);
        renderer.setScissor(x, 0, w, height);
        renderer.render(lane.scene, camera);
      }
    },
    dispose() { renderer.dispose(); },
  };
}
