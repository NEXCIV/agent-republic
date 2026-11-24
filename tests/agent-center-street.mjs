// Exercise the production /world entry point with a local Chrome installation.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = new URL('/world', process.env.WORLD_PREVIEW_URL ?? 'http://127.0.0.1:3114');
const browser = await chromium.launch({
  channel: 'chrome',
  executablePath: process.env.CHROME_EXECUTABLE_PATH,
  headless: true,
});
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 1000 },
      hasTouch: mobile,
      isMobile: mobile,
      reducedMotion: 'no-preference',
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      // Keep the test tier deterministic on different desktop runners.
      Object.defineProperty(window.navigator, 'deviceMemory', { get: () => 8 });
      Object.defineProperty(window.navigator, 'hardwareConcurrency', { get: () => 8 });
    });
    const requests = [];
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.url().endsWith('.glb')) requests.push(new URL(request.url()).pathname.split('/').pop());
    });
    await page.goto(base.href);
    const enter = page.getByRole('button', { name: 'Agent Center street view' });
    await enter.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => window.performance.getEntriesByType('resource')
      .some((entry) => entry.name.endsWith('agent-center-overview.glb')));
    const expected = mobile ? 'agent-center-mobile.glb' : 'agent-center-detail.glb';
    const other = mobile ? 'agent-center-detail.glb' : 'agent-center-mobile.glb';
    assert.ok(!requests.includes(expected) && !requests.includes(other));
    await enter.click();
    await page.locator('[data-detail="ready"]').waitFor();
    await page.getByRole('button', { name: 'View entrance' }).click();
    await page.getByRole('button', { name: 'Whole building' }).click();
    await page.keyboard.press('Escape');
    await enter.click();
    await page.locator('[data-detail="ready"]').waitFor();
    assert.equal(requests.filter((name) => name === expected).length, 1);
    assert.ok(!requests.includes(other));
    assert.deepEqual(errors, []);
    await context.close();
  }
  const page = await browser.newPage();
  const detail = /agent-center-(detail|mobile)\.glb$/;
  await page.route(detail, (route) => route.fulfill({ status: 404, body: 'missing' }));
  await page.goto(base.href + '?view=agent-center');
  await page.locator('[data-detail="fallback"]').waitFor();
  await page.getByRole('button', { name: 'Back to overview' }).click();
  await page.unroute(detail);
  await page.getByRole('button', { name: 'Agent Center street view' }).click();
  await page.locator('[data-detail="ready"]').waitFor();
  await page.goto(base.href + '?no3d=1&view=agent-center');
  assert.equal(await page.locator('canvas').count(), 0);
  await page.getByRole('heading', { name: 'District directory' }).waitFor();
  console.log('Agent Center street view passed on both tiers, including retry and text navigation.');
} finally {
  await browser.close();
}
