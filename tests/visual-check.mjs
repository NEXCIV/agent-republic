import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OrthographicCamera, Vector3 } from 'three';

/**
 * E6-08 — reproducible visual + interaction checks for docs/3D_RENDERING.md
 * §12 (R-01..R-14). The script owns a deterministic fixture API, starts the
 * production Next server against it, drives headless Chrome and writes
 * screenshots into tests/screenshots/.
 *
 * Prerequisite: `pnpm --filter @agent-republic/web build`
 * Run: `pnpm test:visual`
 */

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WEB_DIR = path.join(ROOT, 'apps', 'web');
const entranceView = JSON.parse(readFileSync(path.join(WEB_DIR, 'src/features/world-3d/entrance-view.json'), 'utf8'));
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const SHOTS = path.join(ROOT, 'tests', 'screenshots');
const API_PORT = Number(process.env.VISUAL_API_PORT ?? 8899);
const WEB_PORT = Number(process.env.VISUAL_WEB_PORT ?? 3100);
const BASE = `http://127.0.0.1:${WEB_PORT}`;
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const TX_A = `0x${'ab'.repeat(32)}`;
const TX_B = `0x${'bc'.repeat(32)}`;

const state = {
  fundedBuild: '1200',
  goalBuild: '2000',
  status: 'FUNDING',
  pendingBuild: '300',
  sync: 'LIVE',
  projectAvailable: true,
  frameValid: true,
};

const agents = Array.from({ length: 30 }, (_, index) => {
  const spot = [
    [-8, 0, 3],
    [9, 0, 4],
    [4, 0, 4],
    [-4, 0, 4],
    [-4, 0, 0],
    [4, 0, 0],
    [0, 0, -4],
    [0, 0, 4],
    [-4, 0, -4],
    [4, 0, -4],
    [-9, 0, -1],
    [9, 0, -1],
    [0, 0, 0],
  ][index % 13];
  return {
    agentId: `agent-${String(index + 1).padStart(2, '0')}`,
    position: spot,
    facingRadians: (index / 30) * Math.PI * 2,
    action: 'IDLE',
    locationId: 'PLAZA',
    isSimulated: true,
  };
});

const visualEvents = [
  {
    id: 'event-1',
    kind: 'MILESTONE',
    targetId: 'project:1',
    happenedAtTick: '98',
    sourceType: 'CHAIN',
    sourceId: `${TX_A}:1`,
  },
  {
    id: 'event-2',
    kind: 'MILESTONE',
    targetId: 'IDENTITY',
    happenedAtTick: '99',
    sourceType: 'CHAIN',
    sourceId: `${TX_A}:2`,
  },
  {
    id: 'event-3',
    kind: 'MILESTONE',
    targetId: 'project:1',
    happenedAtTick: '99',
    sourceType: 'OFFCHAIN',
    sourceId: 'agent-note-1',
  },
  {
    id: 'event-4',
    kind: 'DISCUSSION',
    targetId: 'NOTE:def',
    happenedAtTick: '100',
    sourceType: 'CHAIN',
    sourceId: `${TX_B}:3`,
  },
];

function buildFrame() {
  const now = new Date().toISOString();
  if (!state.frameValid) return { schemaVersion: '0.9' };
  return {
    schemaVersion: '1.1',
    frameId: `0x${'11'.repeat(32)}`,
    generatedAt: now,
    source: {
      chainId: 56,
      blockNumber: '48000000',
      blockHash: `0x${'22'.repeat(32)}`,
      blockTimestamp: now,
      confirmedDepth: 15,
      sync: state.sync,
      provenance: 'CHAIN_CONFIRMED',
    },
    epochId: 123,
    facts: {
      citizenCount: 30,
      projects: [
        {
          id: '1',
          titleKey: 'golden-toilet-tower',
          goalBuild: state.goalBuild,
          fundedBuild: state.fundedBuild,
          status: state.status,
          completedAtBlock: null,
        },
      ],
      proposals: [],
    },
    society: { socialRevision: '0', publicMessages: [], agentSummaries: [] },
    simulation: {
      tick: '100',
      worldSeed: 'visual-seed',
      sceneVersion: 'district-01@1',
      agents,
      visualEvents,
    },
  };
}

function buildProjectEnvelope() {
  const now = new Date().toISOString();
  return {
    chainId: 56,
    source: 'DEMO FIXTURE (E6-08 VISUAL)',
    sync: { state: 'SYNCED', finalizedBlock: '48000000', syncedAt: now },
    data: {
      chainProjectId: '1',
      name: 'Golden Toilet Tower',
      goalBuild: state.goalBuild,
      fundedBuild: state.fundedBuild,
      // Deliberately ignored by the page: pending amounts never move the model.
      pendingBuild: state.pendingBuild,
      state: state.status,
      updatedAt: now,
      contributors: [],
      txLinks: [],
      createdAt: now,
    },
  };
}

const fixture = createServer((request, response) => {
  const url = new URL(request.url ?? '/', API_BASE);
  if (url.pathname === '/api/v1/world/frame') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(buildFrame()));
    return;
  }
  if (url.pathname === '/api/v1/projects/1') {
    if (!state.projectAvailable) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end('{"error":"UNAVAILABLE"}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(buildProjectEnvelope()));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end('{"error":"not found"}');
});

const browserCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter((value) => typeof value === 'string' && value.length > 0);
const executablePath = browserCandidates.find((candidate) => existsSync(candidate));

const results = [];
let failures = 0;

function check(id, label, ok, detail = '') {
  results.push({ id, label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${label}${detail === '' ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
}

// Project a visible fixture point through the published entrance camera.
async function pickPoint(page, position = [-8, 4.8, 9]) {
  const canvas = page.locator('.world-stage canvas');
  await canvas.scrollIntoViewIfNeeded();
  const { x, y, width, height } = await canvas.boundingBox();
  const camera = new OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 200);
  const offset = entranceView.offset;
  camera.position.set(offset.x, offset.y, offset.z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.zoom = Math.min(width / entranceView.minWidth, height / entranceView.minHeight, entranceView.maxZoom);
  camera.updateProjectionMatrix();
  const point = new Vector3(...position).project(camera);
  return { x: x + (1 + point.x) * width / 2, y: y + (1 - point.y) * height / 2 };
}

async function waitForServer(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return true;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

if (!existsSync(NEXT_BIN)) {
  console.error(`Next binary not found at ${NEXT_BIN}`);
  process.exit(2);
}
if (!existsSync(path.join(WEB_DIR, '.next', 'BUILD_ID'))) {
  console.error('No production build found. Run: pnpm --filter @agent-republic/web build');
  process.exit(2);
}
if (executablePath === undefined) {
  console.error('No Chromium-based browser found; set CHROME_PATH.');
  process.exit(2);
}

mkdirSync(SHOTS, { recursive: true });

let next;
let browser;
let exitCode = 1;

try {
  await new Promise((resolve) => fixture.listen(API_PORT, '127.0.0.1', resolve));

  let nextLogs = '';
  next = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(WEB_PORT)], {
    cwd: WEB_DIR,
    env: { ...process.env, API_BASE_URL: API_BASE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  next.stdout.on('data', (chunk) => {
    nextLogs += String(chunk);
  });
  next.stderr.on('data', (chunk) => {
    nextLogs += String(chunk);
  });

  if (!(await waitForServer(`${BASE}/world`, 40000))) {
    console.error(nextLogs);
    throw new Error(`Next server did not become ready on ${BASE}`);
  }

  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const pageErrors = [];
  const postRequests = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('request', (request) => {
    if (request.method() === 'POST') postRequests.push(request.url());
  });

  async function gotoWorld(scenario, query = '') {
    await page.goto(`${BASE}/world?scenario=${encodeURIComponent(scenario)}${query}`, {
      waitUntil: 'load',
      timeout: 30000,
    });
    await page.waitForSelector('h1', { timeout: 10000 });
    await page.waitForTimeout(1200);
  }

  async function stageBadge() {
    return (await page.locator('[data-testid="world-stage-badge"]').textContent())?.trim() ?? null;
  }

  async function progressValue() {
    return page.locator('[role="progressbar"]').first().getAttribute('aria-valuenow');
  }

  // R-01 — manifest-derived directory.
  state.frameValid = true;
  state.projectAvailable = true;
  state.sync = 'LIVE';
  state.fundedBuild = '1200';
  state.status = 'FUNDING';
  await gotoWorld('r01');
  const directoryCount = await page.locator('.world-list li').count();
  const directoryText = (await page.locator('.world-list').textContent()) ?? '';
  check('R-01', 'district directory mirrors the manifest', directoryCount === 5, `${directoryCount} entries`);
  check(
    'R-01b',
    'all five landmark IDs are present',
    ['COUNCIL', 'IDENTITY', 'PROJECT', 'CORE', 'PLAZA'].every((id) => directoryText.includes(id)),
  );

  // R-03 — exact stage thresholds.
  const thresholds = [
    ['0', 'FUNDING', 'Foundation', '0'],
    ['499', 'FUNDING', 'Foundation', '24'],
    ['500', 'FUNDING', 'Structural frame', '25'],
    ['1199', 'FUNDING', 'Structural frame', '59'],
    ['1200', 'FUNDING', 'Facade', '60'],
    ['1999', 'FUNDING', 'Facade', '99'],
    ['2000', 'FUNDING', 'SYNC ISSUE', '100'],
    ['2000', 'COMPLETED', 'Complete', '100'],
  ];
  for (const [funded, status, expected, percent] of thresholds) {
    state.fundedBuild = funded;
    state.status = status;
    await gotoWorld(`threshold-${funded}-${status}`);
    const badge = await stageBadge();
    const progress = await progressValue();
    check(
      'R-03',
      `${funded} BUILD / ${status} → ${expected}`,
      badge === expected && progress === percent,
      `badge=${badge} progress=${progress}`,
    );
  }

  // R-04 — pending amounts never move the model.
  state.fundedBuild = '400';
  state.status = 'FUNDING';
  state.pendingBuild = '700';
  await gotoWorld('pending');
  const pendingBadge = await stageBadge();
  const pendingProgress = await progressValue();
  const pendingBody = (await page.locator('body').textContent()) ?? '';
  check(
    'R-04',
    'pending amount is ignored by the confirmed stage',
    pendingBadge === 'Foundation' && pendingProgress === '20' && pendingBody.includes('400 / 2000 BUILD'),
    `badge=${pendingBadge} progress=${pendingProgress}`,
  );

  // R-08/R-12/R-13 — pointer selection, provenance, no transaction.
  state.fundedBuild = '1200';
  state.pendingBuild = '300';
  await gotoWorld('interaction');
  const auditRows = await page.locator('.world-audit tbody tr').count();
  const auditLinks = await page.locator('.world-audit a[href^="/tx/"]').count();
  const agentRows = await page.locator('[data-testid="world-agents-table"] tbody tr').count();
  const bodyText = (await page.locator('body').textContent()) ?? '';
  check('R-12', 'confirmed audit events exclude off-chain notes', auditRows === 3, `${auditRows} rows`);
  check('R-12b', 'each confirmed audit row links to its tx', auditLinks === 3, `${auditLinks} links`);
  check('R-12c', 'agent markers are labelled AI SIMULATED', bodyText.includes('AI SIMULATED'));
  check('R-06', '30 simulated agents are listed', agentRows === 30, `${agentRows} rows`);

  const citizenPoint = await pickPoint(page, [0, 1.48, 4]);
  await page.mouse.click(citizenPoint.x, citizenPoint.y);
  const citizenPanel = page.locator('.world-selection').filter({ hasText: 'AI SIMULATED' });
  await citizenPanel.waitFor({ timeout: 3000 }).catch(() => {});
  check('R-06b', 'a citizen on the plaza approach opens its simulated agent detail',
    (await citizenPanel.count()) === 1);
  await page.keyboard.press('Escape');
  const projectPoint = await pickPoint(page);
  postRequests.length = 0;
  await page.mouse.click(projectPoint.x, projectPoint.y);
  await page.waitForTimeout(900);
  const panel = (await page.locator('.world-selection').textContent()) ?? '';
  check(
    'R-08',
    'mouse selection shows the building panel',
    panel.includes('Golden Toilet Tower') && panel.includes('Open /projects'),
  );
  check(
    'R-13',
    'selecting a model does not submit a transaction',
    postRequests.length === 0 && new URL(page.url()).pathname === '/world',
    `${postRequests.length} POST requests`,
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1300);
  check('R-07', 'Escape clears selection and restores the default view', (await page.locator('.world-selection').count()) === 0);

  await page.mouse.click(projectPoint.x, projectPoint.y);
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForURL('**/projects', { timeout: 10000 }).catch(() => {});
  check('R-08b', 'keyboard Enter opens the same route', new URL(page.url()).pathname === '/projects');

  // R-14 — reduced motion keeps interaction but snaps focus.
  const reducedContext = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    reducedMotion: 'reduce',
  });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(`${BASE}/world?scenario=reduced-motion`, { waitUntil: 'load' });
  await reducedPage.waitForSelector('h1');
  await reducedPage.waitForTimeout(1200);
  const reducedPoint = await pickPoint(reducedPage);
  await reducedPage.mouse.click(reducedPoint.x, reducedPoint.y);
  await reducedPage.waitForTimeout(250);
  check(
    'R-14',
    'reduced motion keeps selection without waiting for a long animation',
    (await reducedPage.locator('.world-selection').count()) === 1,
  );
  await reducedPage.screenshot({ path: path.join(SHOTS, 'world-reduced-motion.png') });
  await reducedContext.close();

  // R-05 — reorg withdraws audit visuals.
  state.sync = 'REORG_RECOVERY';
  await gotoWorld('reorg');
  const danger = (await page.locator('.world-alert.danger').first().textContent()) ?? '';
  const reorgAuditRows = await page.locator('.world-audit tbody tr').count();
  check(
    'R-05',
    'reorg shows reconciliation and withdraws audit rows',
    danger.includes('Chain reconciliation') && reorgAuditRows === 0,
    `rows=${reorgAuditRows}`,
  );
  await page.screenshot({ path: path.join(SHOTS, 'world-reorg.png') });
  state.sync = 'LIVE';

  // R-02 — invalid frame fails closed.
  state.frameValid = false;
  await gotoWorld('invalid-frame');
  const invalidBody = (await page.locator('body').textContent()) ?? '';
  const invalidAgentRows = await page.locator('[data-testid="world-agents-table"] tbody tr').count();
  check(
    'R-02',
    'schema mismatch shows unavailable and no fake agents',
    invalidBody.includes('World simulation frame is currently unavailable') && invalidAgentRows === 0,
    `rows=${invalidAgentRows}`,
  );
  state.frameValid = true;

  // R-09 — no-WebGL and offline remain readable.
  await gotoWorld('no3d', '&no3d=1');
  const no3dCanvas = await page.locator('.world-stage canvas').count();
  const preview = await page.locator('svg.world-preview').count();
  check('R-09', 'text-only mode renders the static plan', no3dCanvas === 0 && preview === 1);
  check('R-09b', 'text-only mode keeps the directory', (await page.locator('.world-list li').count()) === 5);
  await page.screenshot({ path: path.join(SHOTS, 'world-no3d.png') });
  // E7-02: no WebGL must never block the manual business routes.
  const manualProjectLinks = await page.locator('.world-list a[href="/projects"]').count();
  check('R-09d', 'text-only mode keeps the manual projects route', manualProjectLinks > 0, `${manualProjectLinks} links`);
  if (manualProjectLinks > 0) {
    await page.locator('.world-list a[href="/projects"]').first().click();
    await page.waitForURL('**/projects', { timeout: 10000 }).catch(() => {});
    check('R-09e', 'manual projects page loads without WebGL', new URL(page.url()).pathname === '/projects');
  }

  state.projectAvailable = false;
  await gotoWorld('project-offline');
  const offlineBody = (await page.locator('body').textContent()) ?? '';
  check(
    'R-09c',
    'project outage shows unavailable instead of numbers',
    offlineBody.includes('Project #1 confirmed data is currently unavailable') &&
      (await page.locator('[data-testid="world-stage-badge"]').count()) === 0,
  );
  state.projectAvailable = true;

  // Touch selection at 390px.
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const touchPage = await touchContext.newPage();
  await touchPage.goto(`${BASE}/world?scenario=touch`, { waitUntil: 'load' });
  await touchPage.waitForSelector('h1');
  await touchPage.waitForTimeout(1600);
  const touchPoint = await pickPoint(touchPage);
  await touchPage.touchscreen.tap(touchPoint.x, touchPoint.y);
  await touchPage.waitForTimeout(500);
  const touchPanel = (await touchPage.locator('.world-selection').textContent()) ?? '';
  check('R-08c', 'touch selection opens the same panel', touchPanel.includes('Golden Toilet Tower'));
  await touchPage.screenshot({ path: path.join(SHOTS, 'world-touch.png') });
  await touchContext.close();

  // Reproducible four-stage screenshots.
  const stageShots = [
    ['foundation', '0', 'FUNDING'],
    ['frame', '500', 'FUNDING'],
    ['facade', '1200', 'FUNDING'],
    ['complete', '2000', 'COMPLETED'],
  ];
  const shotFiles = [];
  for (const [name, funded, status] of stageShots) {
    state.fundedBuild = funded;
    state.status = status;
    await gotoWorld(`stage-${name}`);
    await page.waitForTimeout(900);
    const hasCanvas = (await page.locator('.world-stage canvas').count()) === 1;
    check('R-03b', `${name} stage renders in WebGL`, hasCanvas);
    const file = `stage-${name}.png`;
    await page.locator('.world-stage').screenshot({ path: path.join(SHOTS, file) });
    shotFiles.push(file);
  }

  writeFileSync(
    path.join(SHOTS, 'manifest.json'),
    `${JSON.stringify(
      {
        buildId: readFileSync(path.join(WEB_DIR, '.next', 'BUILD_ID'), 'utf8').trim(),
        sceneVersion: 'district-01@1',
        viewport: { width: 1440, height: 1100 },
        stages: shotFiles,
        other: ['world-no3d.png', 'world-reorg.png', 'world-touch.png', 'world-reduced-motion.png'],
      },
      null,
      2,
    )}\n`,
  );

  // R-10 — the performance report must exist.
  check('R-10', 'performance report is recorded', existsSync(path.join(ROOT, 'docs', 'PERFORMANCE.md')));
  // R-11 — de-duplication is covered by apps/web/test/milestones.test.ts.
  check('R-11', 'milestone dedupe unit coverage is present', existsSync(path.join(ROOT, 'apps', 'web', 'test', 'milestones.test.ts')));

  check('NO-PAGE-ERRORS', 'no uncaught page errors', pageErrors.length === 0, pageErrors.join('; '));

  exitCode = failures === 0 ? 0 : 1;
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  if (browser !== undefined) await browser.close().catch(() => {});
  fixture.close();
  if (next !== undefined && next.pid !== undefined) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(next.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      next.kill('SIGTERM');
    }
  }
}

console.log(`\n${results.length - failures}/${results.length} visual checks passed.`);
console.log(`Screenshots: ${SHOTS}`);
process.exit(exitCode);
