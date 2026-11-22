// Load the delivered files with the web app's Three.js version in a real WebGL2 context.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const repo = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: {
  exports: { type: 'string', default: join(repo, 'exports') },
  output: { type: 'string', default: join(tmpdir(), 'civrum-webgl-' + Date.now()) },
  validator: { type: 'string' },
  quality: { type: 'string', default: 'standard' },
} });
if (!['standard','refined'].includes(values.quality)) throw new Error('--quality must be standard or refined');
const refined = values.quality === 'refined';
const preview = refined ? {width:1920,height:1080} : {width:1280,height:720};
const frames = ['World_Overview','Central_Plaza',...(refined ? ['Street_Detail'] : []),'Road_Assembly'];
const output = resolve(values.output);
const folder = resolve(values.exports);
const requireWeb = createRequire(join(repo, 'apps/web/package.json'));
const three = dirname(dirname(requireWeb.resolve('three')));
const catalog = JSON.parse(await readFile(join(folder, 'catalog.json'), 'utf8'));
const files = new Map(catalog.assets.map((a) => ['/models/' + a.file, join(folder, a.file)]));
for (const name of ['build/three.module.js', 'build/three.core.js', 'examples/jsm/loaders/GLTFLoader.js',
  'examples/jsm/environments/RoomEnvironment.js',
  'examples/jsm/utils/BufferGeometryUtils.js']) files.set('/three/' + name, join(three, name));
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome',
  '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!executablePath) throw new Error('Set CHROME_PATH to a Chromium executable');
const server = createServer(async (req, res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<style>*{margin:0}canvas{display:block}</style><link rel="icon" href="data:,">' +
      '<script type="importmap">{"imports":{"three":"/three/build/three.module.js"}}</script>');
    return;
  }
  const path = files.get(req.url);
  if (!path) { res.writeHead(404).end(); return; }
  try {
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'model/gltf-binary');
    res.end(await readFile(path));
  } catch { res.writeHead(500).end(); }
});

async function initialize({assets,palette,quality}) {
  const T = await import('three');
  const { GLTFLoader } = await import('/three/examples/jsm/loaders/GLTFLoader.js');
  const refined = quality === 'refined';
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(refined ? 1920 : 1280, refined ? 1080 : 720);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = refined ? T.AgXToneMapping : T.NeutralToneMapping;
  renderer.toneMappingExposure = refined ? 1.15 : 1;
  document.body.appendChild(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color(0xc2d6e3);
  scene.fog = new T.FogExp2(0xc2d6e3, .00045);
  if (refined) {
    // Three.js's procedural studio environment supplies broad reflections to dark metal.
    // It changes lighting only; the loaded GLB materials remain untouched and verified below.
    const { RoomEnvironment } = await import('/three/examples/jsm/environments/RoomEnvironment.js');
    const room = new RoomEnvironment();
    const pmrem = new T.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(room,.04).texture;
    scene.environmentIntensity = .45;
    room.dispose();
    pmrem.dispose();
  }
  const light = new T.DirectionalLight(refined ? 0xffeddc : 0xffedd2, refined ? 3.0 : 2.2);
  light.castShadow = true;
  light.shadow.mapSize.set(refined ? 4096 : 2048, refined ? 4096 : 2048);
  light.shadow.bias = refined ? -.00012 : -.00045;
  light.shadow.normalBias = refined ? .035 : .085;
  scene.add(light, light.target, new T.HemisphereLight(0xe5f1ff, 0xc9c1ad, refined ? .65 : 1.65));
  const camera = new T.PerspectiveCamera(41, 16/9, .8, 1350);
  const models = new Map();
  const loader = new GLTFLoader();
  const errors = [];
  renderer.debug.onShaderError = () => errors.push('Shader compile/link failure');
  const gl = renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const needed = ['ROAD_TURN_90_MAIN','ROAD_TURN_90_LOCAL','ROAD_TEE_MAIN','ROAD_CROSS_MAIN',
    'ROAD_STRAIGHT_MAIN','ROAD_STRAIGHT_LOCAL','PH_CENTRAL_NEXUS','TREE_03','CONSTRUCTION_SCAFFOLD_01'];

  for (const asset of assets) {
    const { scene: root, parser } = await loader.loadAsync('/models/' + asset.file);
    if (parser.json.buffers.some((b)=>b.uri) || parser.json.images?.some((im)=>im.uri)) {
      throw new Error('External resource in '+asset.file);
    }
    root.updateMatrixWorld(true);
    let count = 0;
    const materials = {};
    const bounds = new T.Box3().setFromObject(root, true);
    root.traverse((node) => {
      if (!node.isMesh) return;
      if (node.isInstancedMesh) {
        const matrix = new T.Matrix4();
        for (let i=0;i<node.count;i++) {
          node.getMatrixAt(i,matrix);
          if (!matrix.elements.every(Number.isFinite) || Math.abs(matrix.determinant()-1)>.001)
            throw new Error('Invalid instance transform in '+asset.file);
        }
      }
      const mat = node.material;
      const ref = palette[mat.name];
      if (!ref || !mat.isMeshStandardMaterial || mat.color.getHexString() !== ref.sRGB.toLowerCase() ||
          Math.abs(mat.roughness-ref.roughness)>.001 || Math.abs(mat.metalness-ref.metalness)>.001) {
        throw new Error('PBR material mismatch in '+asset.file+': '+mat.name);
      }
      const geo = node.geometry;
      geo.computeBoundingBox();
      node.receiveShadow = true;
      // Road paint and the asphalt below it are only millimetres apart.
      // Both receive shadows; only objects with vertical relief need to cast them.
      node.castShadow = geo.boundingBox.max.y-geo.boundingBox.min.y > .65;
      mat.shadowSide = T.BackSide;
      const tris = (geo.index?.count ?? geo.attributes.position.count)/3 * (node.isInstancedMesh ? node.count : 1);
      count += tris;
      materials[node.material.name] = (materials[node.material.name] ?? 0) + tris;
    });
    const [lo,hi] = asset.bounds;
    const expected = [lo[0],lo[2],-hi[1],hi[0],hi[2],-lo[1]];
    const measured = [...bounds.min.toArray(),...bounds.max.toArray()];
    if (!measured.every((v,i) => Math.abs(v-expected[i]) < .001) ||
        count !== asset.triangles || Object.keys(materials).length !== Object.keys(asset.materials).length ||
        Object.entries(asset.materials).some(([key,n]) => materials[key] !== n)) {
      throw new Error('Geometry/material mismatch in '+asset.file+': '+JSON.stringify({measured,expected,count,materials}));
    }
    models.set(asset.id,root);
  }
  for (const id of needed) if (!models.has(id)) throw new Error('Missing module '+id);
  const city = models.get('CIVRUM_City_Environment');
  const anchors = {CENTRAL_NEXUS:[0,.85,-6],GOVERNANCE_HALL:[0,.172,-95],
    RESEARCH_CENTER:[-95,.172,-65],BUILD_WORKSHOP:[95,.172,85],RESIDENTIAL_HOUSE:[95,.172,-65]};
  for (const [id,xyz] of Object.entries(anchors)) {
    const anchor = city.getObjectByName('GAME_CIVRUM_PH_'+id);
    if (!anchor?.children.length || anchor.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3(...xyz))>.001)
      throw new Error('Missing or shifted building anchor '+id);
  }
  const batches = [];
  city.traverse((node) => { if (node.isInstancedMesh) batches.push(node); });
  if (!batches.length) throw new Error('Three.js did not create GPU instances');
  scene.add(city);
  // An uncommitted studio floor only extends the horizon outside the 300-metre game mesh.
  const floor = new T.Mesh(new T.PlaneGeometry(4000,4000),new T.MeshStandardMaterial({color:0xc5c6c3}));
  floor.rotation.x = -Math.PI/2;
  floor.position.y = -.12;
  floor.receiveShadow = true;
  scene.add(floor);

  function view(position, target, range, near, fov) {
    camera.near = near;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.position.set(...position);
    camera.lookAt(...target);
    light.target.position.set(...target);
    light.position.copy(light.target.position).add(new T.Vector3(-100,150,75));
    Object.assign(light.shadow.camera,{left:-range,right:range,top:range,bottom:-range,near:.5,far:540});
    light.shadow.camera.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene,camera);
  }
  function renderOnce() {
    renderer.render(scene,camera);
    return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
  }
  function assembly() {
    const group = new T.Group();
    for (const [width,z] of [['MAIN',0],['LOCAL',44]]) {
      for (const [key,x,dz,angle] of [['STRAIGHT',-20,0,0],['TURN_90',0,0,0],['STRAIGHT',20,-20,Math.PI/2]]) {
        const module = models.get('ROAD_'+key+'_'+width).clone();
        module.position.set(x,0,z+dz);
        module.rotation.y = angle;
        group.add(module);
      }
    }
    return group;
  }
  const roads = assembly();
  roads.visible = false;
  scene.add(roads);
  function frame(name) {
    city.visible = name !== 'Road_Assembly';
    roads.visible = !city.visible;
    if (name === 'Road_Assembly') view([52,95,80],[1,0,5],65,18,42);
    else if (name === 'Central_Plaza') view([7,9.2,56],[0,10,-5],64,2.0,39);
    else if (name === 'Street_Detail') view([-68.6,2.25,-8],[-84,4.8,-58],48,.15,38);
    else view([49,305,350],[0,0,25],224,110,33);
  }
  function compare() {
    frame('World_Overview');
    const instanced = renderOnce();
    const singles = new T.Group();
    for (const batch of batches) {
      for (let i=0;i<batch.count;i++) {
        const single = new T.Mesh(batch.geometry,batch.material);
        batch.getMatrixAt(i,single.matrix);
        single.matrix.premultiply(batch.matrixWorld);
        single.matrixAutoUpdate = false;
        singles.add(single);
      }
      batch.visible = false;
    }
    scene.add(singles);
    const unbatched = renderOnce();
    scene.remove(singles);
    batches.forEach((batch) => { batch.visible = true; });
    if (instanced.calls >= unbatched.calls) throw new Error('Instancing did not reduce draw calls');
    return {instanced,unbatched,batches:batches.length};
  }
  async function benchmark(w,h) {
    renderer.setSize(w,h);
    camera.aspect = w/h;
    camera.updateProjectionMatrix();
    frame('Central_Plaza');
    const times = [];
    let previous;
    for (let i=0;i<661;i++) {
      const tick = await new Promise((done) => window.requestAnimationFrame(done));
      camera.position.set(7+Math.sin(i*.034)*5,9.2,56);
      camera.lookAt(0,10,-5);
      renderer.render(scene,camera);
      gl.finish();
      if (i>60) times.push(tick-previous);
      previous=tick;
    }
    times.sort((a,b) => a-b);
    const average = times.reduce((a,b) => a+b,0)/times.length;
    if (errors.length || gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw new Error('WebGL errors: '+errors.join(','));
    return {width:w,height:h,dpr:1,frames:times.length,meanFps:+(1000/average).toFixed(1),
      p95FrameMs:+times[Math.ceil(.95*times.length)-1].toFixed(1),...renderOnce()};
  }
  window.civrumQA = {frame,benchmark};
  return {threeRevision:T.REVISION,gpu,checked:models.size,quality,
    preview:{width:refined?1920:1280,height:refined?1080:720,shadowMap:refined?4096:2048,
      toneMapping:refined?'AgX':'Neutral',environment:refined?'procedural RoomEnvironment':'hemisphere only'},
    ...compare()};
}

let browser;
try {
  await mkdir(output,{ recursive: true });
  for (const f of [...frames,'benchmark']) {
    const path = join(output,f+(f==='benchmark'?'.json':'.png'));
    if (existsSync(path)) throw new Error('Choose an empty --output directory: '+path);
  }
  await new Promise((done) => server.listen(0,'127.0.0.1',done));
  browser = await chromium.launch({executablePath,headless:true});
  const page = await browser.newPage({viewport:preview,deviceScaleFactor:1});
  const errors = [];
  page.on('pageerror',(err) => errors.push(err.message));
  page.on('console',(msg) => {if (msg.type()==='error') errors.push(msg.text());});
  await page.goto('http://127.0.0.1:'+server.address().port);
  const report = await page.evaluate(initialize,{...catalog,quality:values.quality});
  if (values.validator) {
    const validator = requireWeb(resolve(values.validator));
    const messages = {};
    for (const entry of catalog.assets) {
      const result = await validator.validateBytes(await readFile(join(folder,entry.file)),{uri:entry.file,maxIssues:0});
      if (result.issues.numErrors || result.issues.numWarnings) throw new Error(JSON.stringify(result.issues));
      for (const item of result.issues.messages) messages[item.code] = (messages[item.code] ?? 0)+1;
    }
    report.format = {validator:validator.version(),files:catalog.assets.length,errors:0,warnings:0,info:messages};
  }
  for (const name of frames) {
    await page.evaluate((n) => window.civrumQA.frame(n),name);
    await page.locator('canvas').screenshot({path:join(output,name+'.png')});
  }
  report.browser = basename(executablePath)+' '+browser.version();
  report.views = [];
  for (const [width,height] of [[1280,720],[390,844]]) {
    await page.setViewportSize({width,height});
    report.views.push(await page.evaluate(([w,h])=>window.civrumQA.benchmark(w,h),[width,height]));
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(join(output,'benchmark.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {
  if (browser) await browser.close();
  server.close();
}
