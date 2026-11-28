import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { benchIdle } from '../agent';

export type Character = '02' | '06';
export type Motion = 'walk' | 'turn' | 'sit';
export type View = 'front' | 'side';
export type Gait = '100STYLE' | 'Quaternius';

export const durations: Record<Motion, number> = { walk: 4.1, turn: 2.4, sit: 3.4 };

type Sidecar = {
  seat: { y: number; z: number };
  walkPath: { speed: number; start: number; duration: number; ramp: number };
  clips: Omit<ReturnType<typeof THREE.AnimationClip.toJSON>, 'uuid'>[];
};
type MotionSample = [name: string, time: number, weight?: number];

const smooth = THREE.MathUtils.smoothstep;
const chairDepth = 0.31;
const legacySeatShift = -0.28;

function walkDistance(time: number, { speed, start, duration, ramp }: Sidecar['walkPath']) {
  const elapsed = THREE.MathUtils.clamp(time - start, 0, duration);
  if (elapsed <= ramp) return speed * elapsed ** 2 / (2 * ramp);
  if (elapsed >= duration - ramp) return speed * (duration - ramp - (duration - elapsed) ** 2 / (2 * ramp));
  return speed * (elapsed - ramp / 2);
}

function getClip(clips: THREE.AnimationClip[], name: string) {
  const clip = THREE.AnimationClip.findByName(clips, name);
  if (!clip) throw new Error(`Missing motion: ${name}`);
  return clip;
}

function chair(y: number, z: number) {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#9a6e40', roughness: 0.84 });
  const metal = new THREE.MeshStandardMaterial({ color: '#333b41', roughness: 0.58 });
  function piece(w: number, h: number, d: number, x: number, height: number, depth: number, material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, height, depth);
    group.add(mesh);
  }
  piece(0.38, 0.035, chairDepth, 0, y - 0.0175, z, wood);
  for (const x of [-0.154, 0.154]) {
    for (const depth of [-0.125, 0.125]) piece(0.026, y - 0.035, 0.026, x, (y - 0.035) / 2, z + depth, metal);
  }
  return group;
}

function buildLane(model: THREE.Object3D, clips: THREE.AnimationClip[], stride: number,
  { seat, walkPath }: Pick<Sidecar, 'seat' | 'walkPath'>, candidate: boolean) {
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
  const stool = chair(seat.y, seat.z);
  scene.add(stool);
  const actor = new THREE.Group();
  // Root translation moves the skin beyond its rest-pose bounds during the walking trial.
  model.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.frustumCulled = false;
  });
  actor.add(model);
  scene.add(actor);
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
  const actions = new Map(clips.map((clip) => {
    const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
    action.paused = true;
    action.setEffectiveWeight(0).play();
    return [clip.name, action];
  }));
  const idle = candidate ? 'Idle_A' : 'Idle';
  const walkDuration = candidate ? 0 : getClip(clips, 'Walk').duration;

  function pose(motion: Motion, time: number, gait: Gait) {
    actor.position.set(0, 0, 0);
    model.position.y = 0;
    stool.visible = motion === 'sit';
    let samples: MotionSample[];
    if (candidate && motion !== 'sit') {
      samples = [[`${gait}_${motion === 'walk' ? 'Walk' : 'Turn'}`, time]];
    } else if (motion === 'walk') {
      // The same path and speed for each lane, with clip cadence driven by its own stride.
      const { start, duration } = walkPath;
      const stop = start + duration;
      const distance = walkDistance(time, walkPath);
      actor.position.z = distance - walkDistance(stop, walkPath) / 2;
      const amount = smooth(time, start, start + 0.24) * (1 - smooth(time, stop - 0.24, stop));
      samples = [[idle, time, 1 - amount], ['Walk', walkDuration * ((distance / stride) % 1), amount]];
    } else if (motion === 'turn') {
      const turn = 'TurnRight90';
      const duration = getClip(clips, turn).duration;
      const amount = smooth(time, 0.25, 0.48);
      // The last frame holds the turn orientation, with both lanes restarting together.
      samples = [[idle, time, 1 - amount], [turn, time - 0.25, amount]];
      if (time >= 0.25 + duration) samples = [[turn, duration]];
    } else if (candidate) {
      const up = 2.35;
      const down = 0.25;
      if (time < down) {
        const amount = smooth(time, 0.05, down);
        samples = [[idle, time, 1 - amount], ['Sit_Chair_Down', 0, amount]];
      } else if (time < down + 0.8) {
        samples = [['Sit_Chair_Down', time - down]];
      } else if (time < up) {
        const progress = (time - down - 0.8) / (up - down - 0.8);
        const idleDuration = getClip(clips, 'Sit_Chair_Idle').duration;
        samples = [['Sit_Chair_Idle', progress * idleDuration]];
      } else {
        const phase = time - up;
        const amount = smooth(phase, 0.8, 1.05);
        samples = [['Sit_Chair_StandUp', phase, 1 - amount], [idle, time, amount]];
      }
    } else {
      // Compare the actual city's seated pose, including its immediate vertical offset.
      const seated = time >= 1.05 && time < 2.35;
      model.position.y = seated ? -0.24 : 0;
      actor.position.z = seated ? legacySeatShift : 0;
      samples = [[seated ? 'Bench rest' : idle, time]];
    }

    for (const action of actions.values()) action.setEffectiveWeight(0);
    for (const [name, seconds, weight = 1] of samples) {
      if (weight === 0) continue;
      const action = actions.get(name)!;
      const duration = action.getClip().duration;
      const isIdle = name === idle || name === 'Bench rest';
      action.time = isIdle ? seconds % duration : THREE.MathUtils.clamp(seconds, 0, duration);
      action.setEffectiveWeight(weight);
    }
    mixer.update(0);
    hips.getWorldPosition(hipCenter);
    contact.position.x = hipCenter.x;
    contact.position.z = hipCenter.z + (motion === 'sit' ? 0.12 : 0);
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
  const candidateClips = sidecar.clips.map((clip) => THREE.AnimationClip.parse({
    ...clip,
    uuid: THREE.MathUtils.generateUUID(),
  }));
  let model: GLTF | undefined;
  let second: THREE.Object3D | undefined;
  try {
    model = await new GLTFLoader().parseAsync(modelBytes, '/nexciv-walk/');
    signal.throwIfAborted();
    const { scene, animations } = model;
    const stride = Number(scene.children.find((node) => node.userData.walk_stride_m)?.userData.walk_stride_m);
    if (!(stride > 0)) throw new Error('缺少有效步幅');
    const hips = scene.getObjectByName('Hips')!;
    const oldSeat = { y: hips.position.y - 0.24 - 0.105, z: hips.position.z + legacySeatShift + 0.065 };
    second = clone(scene);
    const old = buildLane(scene, [...animations, benchIdle(getClip(animations, 'Idle'))], stride,
      { seat: oldSeat, walkPath: sidecar.walkPath }, false);
    const candidate = buildLane(second, candidateClips, stride, sidecar, true);
    return {
      lanes: [old, candidate],
      walkPath: sidecar.walkPath,
      dispose() {
        old.release();
        candidate.release();
        disposeScenes(old.scene, candidate.scene);
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
    draw(data: Awaited<ReturnType<typeof loadLanes>>, motion: Motion, view: View, time: number, gait: Gait) {
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
        lane.pose(motion, time, gait);
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
