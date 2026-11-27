import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

/**
 * E2-07 responsive + basic accessibility check (docs/IMPLEMENTATION_PLAN.md).
 *
 * Runs against a built web app with the API reachable, using an installed
 * Chromium-based browser (no browser download):
 *   WEB_BASE_URL=http://127.0.0.1:3000 node tests/responsive-check.mjs
 *
 * For every route × viewport it asserts:
 *   - HTTP 200 and an <h1>
 *   - no page-level horizontal overflow (tables scroll inside .table-wrap)
 *   - skip link, main landmark and primary navigation exist
 *   - first Tab focuses the skip link and it receives a visible focus ring
 */

const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter((value) => typeof value === 'string' && value.length > 0);

const executablePath = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
if (executablePath === undefined) {
  console.error('No Chromium-based browser found; set CHROME_PATH.');
  process.exit(2);
}

const BASE = (process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const TX_HASH = process.env.SMOKE_TX ?? `0x${'33'.repeat(32)}`;

const ROUTES = [
  '/',
  '/projects',
  '/projects/1',
  '/council',
  '/council/1',
  '/activity',
  '/my-agent',
  '/nexciv-preview/docs',
  '/nexciv-preview/cafe/news',
  '/world',
  '/world?no3d=1',
  `/tx/${TX_HASH}`,
];
const VIEWPORTS = [
  { name: 'Mobile 360', width: 360, height: 800 },
  { name: 'Mobile 390', width: 390, height: 844 },
  { name: 'Tablet/Laptop 1024', width: 1024, height: 768 },
  { name: 'Desktop 1440', width: 1440, height: 900 },
];

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const rows = [];
let failures = 0;

for (const viewport of VIEWPORTS) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });

  for (const route of ROUTES) {
    const problems = [];
    let status = 0;
    try {
      const response = await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 20000 });
      status = response?.status() ?? 0;
      await page.waitForSelector('h1', { timeout: 5000 });
    } catch (error) {
      problems.push(`navigation failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (status !== 200) problems.push(`HTTP ${status}`);

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      hasMain: document.querySelector('main#main') !== null,
      hasNav: document.querySelector('nav[aria-label="主导航"]') !== null
        || (window.location.pathname === '/nexciv-preview/shared/join'
          && document.querySelector('[data-site-header] a[href="/nexciv-preview/shared"]') !== null),
      hasSkipLink: document.querySelector('a.skip-link') !== null,
      heading: document.querySelector('h1')?.textContent?.trim() ?? '',
      links: document.querySelectorAll('a[href]').length,
      wrappers: document.querySelectorAll('.table-wrap').length,
      tables: document.querySelectorAll('table').length,
      progressBars: document.querySelectorAll('[role="progressbar"]').length,
    }));

    if (metrics.scrollWidth > metrics.innerWidth + 1) {
      problems.push(`horizontal overflow ${metrics.scrollWidth}px > ${metrics.innerWidth}px`);
    }
    if (!metrics.hasMain) problems.push('missing <main id="main">');
    if (!metrics.hasNav) problems.push('missing labelled primary nav');
    if (!metrics.hasSkipLink) problems.push('missing skip link');
    if (metrics.heading === '') problems.push('missing h1 text');
    if (metrics.links === 0) problems.push('no links');
    if (metrics.tables > 0 && metrics.wrappers === 0) problems.push('table without .table-wrap');

    if (route === '/' && viewport.width === 360) {
      await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return { tag: '', text: '', outline: 'none' };
        const style = window.getComputedStyle(active);
        return {
          tag: active.tagName.toLowerCase(),
          text: active.textContent?.trim().slice(0, 40) ?? '',
          outline: style.outlineStyle,
        };
      });
      if (focus.tag !== 'a' || !focus.text.toLowerCase().includes('skip')) {
        problems.push(`first Tab did not focus the skip link (${focus.tag}:${focus.text})`);
      }
      if (focus.outline === 'none') problems.push('skip link has no visible focus ring');
    }

    if (problems.length > 0) failures += 1;
    rows.push({
      viewport: `${viewport.width}px`,
      route,
      status,
      scrollWidth: metrics.scrollWidth,
      problems,
    });
  }
}

await context.close();
await browser.close();

const header = ['VIEWPORT', 'ROUTE', 'HTTP', 'SCROLL', 'RESULT'];
const widths = [10, 22, 5, 7, 60];
const formatRow = (cells) => cells.map((cell, index) => String(cell).padEnd(widths[index])).join(' ');
console.log(formatRow(header));
console.log(widths.map((width) => '-'.repeat(width)).join(' '));
for (const row of rows) {
  console.log(
    formatRow([
      row.viewport,
      row.route,
      row.status,
      row.scrollWidth,
      row.problems.length === 0 ? 'PASS' : `FAIL: ${row.problems.join('; ')}`,
    ]),
  );
}

console.log(`\n${rows.length - failures}/${rows.length} checks passed at 360/390/1024/1440.`);
process.exit(failures === 0 ? 0 : 1);
