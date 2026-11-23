import assert from 'node:assert/strict';
import { log } from 'node:console';
import { existsSync } from 'node:fs';
import { env } from 'node:process';
import { URL } from 'node:url';
import { chromium } from 'playwright-core';

const base = env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const executablePath = [
  env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const ownerRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/my-agent/commands')) ownerRequests.push(request.url());
  });
  await page.route('**/api/my-agent', (route) => route.fulfill({ status: 401, body: '{}' }));
  await page.goto(new URL('/my-agent', base).href);
  await page.getByRole('heading', { name: 'Session required' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Command' }).count(), 0);
  await page.getByRole('link', { name: 'Try the command demo' }).click();
  await page.getByRole('heading', { name: 'Command demo' }).waitFor();
  await page.getByRole('button', { name: 'Talk to Borealis' }).click();
  await page.getByRole('button', { name: 'Send command' }).click();
  await page.getByRole('combobox', { name: 'Command mode' }).selectOption('INTERRUPT');
  await page.getByRole('button', { name: 'Visit Council Hall' }).click();
  await page.getByRole('button', { name: 'Send command' }).click();
  const interrupted = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Borealis' }) });
  const visit = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: '议会厅' }) });
  await interrupted.locator('summary').getByText('Paused', { exact: true }).waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await visit.getByText('Private route · AI SIMULATED').waitFor();
  await visit.getByText('Arrived', { exact: false }).first().waitFor();
  await interrupted.locator('summary').getByText('Completed', { exact: true }).waitFor();
  const position = await page.getByText(/^Private location ·/).innerText();
  await page.getByRole('combobox', { name: 'Command mode' }).selectOption('SUGGEST');
  await page.getByRole('textbox', { name: 'Command' }).fill('帮我自动投票');
  await page.getByRole('button', { name: 'Send command' }).click();
  await page.locator('summary').getByText('Declined', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Task report' }).waitFor();
  assert.equal(await page.getByText(/^Private location ·/).innerText(), position);
  const history = page.getByRole('region', { name: 'Command history' });
  assert.match(await history.innerText(), /Borealis/);
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  assert.deepEqual(ownerRequests, [], 'demo must not call the private commands API');

  // Exercise the verified layout in isolation. This browser fixture has no chain privileges.
  const date = '2026-11-23T00:00:00.000Z';
  const config = {
    agentId: 'browser-fixture', name: 'Browser fixture', owner: '0x' + '1'.repeat(40),
    status: 'ACTIVE', configVersion: 1, persona: 'COOPERATIVE', goal: 'BUILD_PUBLIC_GOODS',
    createdAt: date, updatedAt: date, versions: [], recentActions: [],
  };
  await page.route('**/api/my-agent', (route) => route.fulfill({ json: { data: config } }));
  const attempts = [];
  const journal = [];
  await page.route('**/api/my-agent/commands', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { source: 'AI_SIMULATED', data: journal } });
    }
    const request = route.request().postDataJSON();
    attempts.push(request);
    if (attempts.length === 1) return route.abort('failed');
    const entry = {
      ...request, id: request.requestId, revision: 1, status: 'COMPLETED', steps: [{ kind: 'REPORT' }],
      results: ['Fixture report'], report: 'Fixture report', configVersion: 1, sourceBlock: '1',
      worldFrameId: '0x' + 'a'.repeat(64), createdAt: date, updatedAt: date,
    };
    journal.push(entry);
    return route.fulfill({ json: { source: 'AI_SIMULATED', data: entry } });
  });
  await page.goto(new URL('/my-agent?visit=PLAZA', base).href);
  const submit = page.getByRole('button', { name: 'Send command' });
  await page.getByText('No tasks yet', { exact: true }).waitFor();
  assert.match(await page.getByRole('textbox', { name: 'Command' }).inputValue(), /Central Plaza/);
  assert.equal(attempts.length, 0, 'map selection only drafts a command');
  assert.doesNotMatch(await history.innerText(), /Borealis/);
  await submit.click();
  await page.getByRole('alert').filter({ hasText: 'reply was interrupted' }).waitFor();
  await submit.click();
  await page.getByRole('heading', { name: 'Task report' }).waitFor();
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0], attempts[1], 'retry must reuse the draft request key');
  assert.deepEqual(Object.keys(attempts[0]).sort(), ['mode', 'requestId', 'text']);
  config.status = 'PAUSED';
  await page.reload();
  await page.getByText('Agent paused', { exact: true }).waitFor();
  assert.equal(await submit.isEnabled(), false);
  log('PASS: locked owner, mobile demo, report persistence, isolated APIs, map drafts, safe retries and pause.');
} finally {
  await browser.close();
}
