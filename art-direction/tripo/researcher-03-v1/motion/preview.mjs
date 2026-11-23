import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const clamp = THREE.MathUtils.clamp;
const smooth = (t) => t*t*(3-2*t);
const modelUrl = (path) => new URL(path, import.meta.url).href;

export async function createReview(canvas, character = 'researcher') {
  const loader = new GLTFLoader();
  const builder = character === 'builder';
  const file = builder ? '../../builder-02-v1/motion/CIVRUM_Builder_02.glb' : './CIVRUM_Researcher_03.glb';
  const [agent, core] = await Promise.all([
    loader.loadAsync(modelUrl(file)),
    loader.loadAsync(modelUrl('../../agent-center-v3/benchmark/CIVRUM_Agent_Center_Street.glb')),
  ]);
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc5d6db);
  scene.fog = new THREE.FogExp2(0xc5d6db,.029);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room,.04).texture;
  scene.environmentIntensity = .48;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe4f3ff,0xc4a584,1.5));
  const sun = new THREE.DirectionalLight(0xffe3b9,2.5);
  sun.position.set(1,12,0);
  sun.target.position.set(5,0,5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-11,right:11,top:11,bottom:-11,near:.1,far:40});
  sun.shadow.normalBias=.013;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun,sun.target);

  function slab(width, depth, x, z, y, color) {
    const geo = new THREE.PlaneGeometry(width,depth);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color,roughness:.9}));
    mesh.rotation.x=-Math.PI/2;
    mesh.position.set(x,y,z);
    mesh.receiveShadow=true;
    scene.add(mesh);
  }
  slab(40,40,0,0,-.012,0xa9aaa2);
  slab(7,7,0,0,-.008,0xd0c6b5);
  slab(14,3.1,4.5,4,-.006,0xccc1aa);
  slab(2.2,3,9,5.55,-.005,0xd3c6b4);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.33,1.38,64),
    new THREE.MeshStandardMaterial({color:0xaf904a}));
  ring.rotation.x=-Math.PI/2;
  ring.position.y=-.004;
  scene.add(ring);
  const actor = new THREE.Group();
  actor.add(agent.scene);
  core.scene.position.set(9,0,9);
  for (const root of [agent.scene,core.scene]) {
    root.traverse(o=>{ if (o.isMesh) { o.castShadow=true; o.receiveShadow=true; } });
  }
  scene.add(actor,core.scene);
  // The street sample uses a broad sun shadow. A soft contact patch under
  // each boot makes the planted foot readable at a close camera distance.
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 64;
  const context = shadowCanvas.getContext('2d');
  const gradient = context.createRadialGradient(32,32,3,32,32,32);
  gradient.addColorStop(0,'rgba(42,34,27,0.80)');
  gradient.addColorStop(.52,'rgba(59,47,36,0.42)');
  gradient.addColorStop(1,'rgba(59,47,36,0)');
  context.fillStyle = gradient;
  context.fillRect(0,0,64,64);
  const shadowMap = new THREE.CanvasTexture(shadowCanvas);
  shadowMap.colorSpace = THREE.SRGBColorSpace;
  scene.updateMatrixWorld(true);
  const contacts = [];
  actor.traverse(bone => {
    if (!bone.isBone || !bone.name.startsWith('Foot')) return;
    const material = new THREE.MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false});
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(.26,.39),material);
    patch.rotation.order='YXZ';
    patch.rotation.x=-Math.PI/2;
    scene.add(patch);
    contacts.push({bone,patch,restHeight:bone.getWorldPosition(new THREE.Vector3()).y,
      restRotation:bone.getWorldQuaternion(new THREE.Quaternion()).invert()});
  });
  const footPosition = new THREE.Vector3(), footRotation = new THREE.Quaternion();
  const forward = new THREE.Vector3();
  const mixer = new THREE.AnimationMixer(agent.scene);
  const actions = Object.fromEntries(agent.animations.map(clip => {
    const action = mixer.clipAction(clip);
    action.play();
    action.paused = true;
    return [clip.name,action];
  }));
  const walkPeriod = actions.Walk.getClip().duration;
  const stride = agent.scene.getObjectByName(builder ? 'Builder02' : 'Researcher03').userData.walk_stride_m;
  const speed = stride/walkPeriod;
  const ramp = .24;
  let end = 0;
  const segments = [];
  function segment(clip, seconds, x, z, heading, distance=0) {
    segments.push({clip,seconds,x,z,heading,distance,begin:end});
    end += seconds;
  }
  function walk(distance,x,z,heading) {
    segment('Walk', distance/speed+ramp,x,z,heading,distance);
  }
  // Manifest route P0 → P4 → P8 → P12. Only the last 2.30 m are a
  // local approach to the foot of the stairs in this art review.
  segment('Idle',1.5,0,0,0);
  walk(4,0,0,0);
  segment('TurnLeft90',1,0,4,0);
  walk(9,0,4,Math.PI/2);
  segment('TurnRight90',1,9,4,Math.PI/2);
  walk(2.30,9,4,0);
  segment('Idle',2.6,9,6.30,0);
  const camera = new THREE.PerspectiveCamera(35,1,.03,100);
  const target = new THREE.Vector3();
  function render(seconds) {
    const time = clamp(seconds,0,end);
    const part = segments.find(s => time < s.begin+s.seconds) ?? segments.at(-1);
    const local = time-part.begin;
    Object.values(actions).forEach(a => a.setEffectiveWeight(0));
    const action=actions[part.clip];
    action.setEffectiveWeight(1);
    action.time=local % action.getClip().duration;
    let moved=0;
    if (part.clip==='Walk') {
      // Integrate the ramp so travel, foot phase and final distance agree.
      let distanceTime = local-ramp/2;
      if (local<ramp) distanceTime = local*local/(2*ramp);
      const remaining = part.seconds-local;
      if (remaining<ramp) distanceTime = part.distance/speed-remaining*remaining/(2*ramp);
      moved = clamp(distanceTime*speed,0,part.distance);
      action.time = (moved/speed) % walkPeriod;
      const weight = smooth(clamp(Math.min(local,remaining)/ramp,0,1));
      action.setEffectiveWeight(weight);
      actions.Idle.time=0;
      actions.Idle.setEffectiveWeight(1-weight);
    } else if (part.clip.startsWith('Turn')) {
      action.time=clamp(local,0,action.getClip().duration);
    }
    actor.position.set(part.x+Math.sin(part.heading)*moved,0,part.z+Math.cos(part.heading)*moved);
    actor.rotation.y=part.heading;
    mixer.update(0);
    scene.updateMatrixWorld(true);
    for (const {bone,patch,restHeight,restRotation} of contacts) {
      bone.getWorldPosition(footPosition);
      bone.getWorldQuaternion(footRotation).multiply(restRotation);
      forward.set(0,0,1).applyQuaternion(footRotation);
      patch.position.set(footPosition.x+.022*forward.x,-.001,footPosition.z+.022*forward.z);
      patch.rotation.y=Math.atan2(forward.x,forward.z);
      patch.material.opacity=.68*(1-clamp((footPosition.y-restHeight)/.135,0,1));
    }
    const finish = smooth(clamp((actor.position.x-3.3)/5.7,0,1));
    const angle=THREE.MathUtils.degToRad(30+122*finish);
    const distance=3.85+2.0*finish;
    const focusHeight=.90+.64*finish;
    camera.position.set(actor.position.x+distance*Math.sin(angle),1.28+1.02*finish,
      actor.position.z+distance*Math.cos(angle));
    target.set(actor.position.x,focusHeight,actor.position.z+.55*finish);
    camera.lookAt(target);
    const w=canvas.clientWidth, h=canvas.clientHeight;
    if (renderer.domElement.width!==Math.floor(w*renderer.getPixelRatio()) ||
        renderer.domElement.height!==Math.floor(h*renderer.getPixelRatio())) renderer.setSize(w,h,false);
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
    renderer.render(scene,camera);
    return part.clip;
  }
  return {render,duration:end,segments,actor,agent,core,mixer,actions,speed,renderer};
}
