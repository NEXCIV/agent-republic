import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const launcher = path.join(root, 'scripts/start-nexciv-guest.mjs');
const clean = { ...process.env };
for (const name of [
  'NEXCIV_GUEST_ORIGIN', 'NEXCIV_GUEST_DB', 'NEXCIV_GUEST_SECRET',
  'NEXCIV_CAFE_DEMO_DB', 'NEXCIV_GUEST_PORT',
]) delete clean[name];
const valid = {
  ...clean,
  NEXCIV_GUEST_ORIGIN: 'https://demo.example.com',
  NEXCIV_GUEST_DB: path.join(root, 'cache/guest-launch-check.sqlite'),
  NEXCIV_GUEST_SECRET: randomBytes(32).toString('base64url'),
};

for (const [label, env, expected] of [
  ['missing configuration', clean, /HTTPS origin/],
  ['insecure origin', { ...valid, NEXCIV_GUEST_ORIGIN: 'http://demo.example.com' }, /HTTPS origin/],
  ['origin with trailing slash', { ...valid, NEXCIV_GUEST_ORIGIN: 'https://demo.example.com/' }, /HTTPS origin/],
  ['relative database path', { ...valid, NEXCIV_GUEST_DB: 'cache/guest.sqlite' }, /absolute path/],
  ['wrong database extension', { ...valid, NEXCIV_GUEST_DB: path.join(root, 'cache/guest.db') }, /absolute path/],
  ['invalid secret', { ...valid, NEXCIV_GUEST_SECRET: 'invalid' }, /32 random bytes/],
  ['legacy local database enabled', { ...valid, NEXCIV_CAFE_DEMO_DB: path.join(root, 'cache/legacy.sqlite') }, /Unset NEXCIV_CAFE_DEMO_DB/],
]) {
  test(`guest launcher rejects ${label}`, () => {
    const result = spawnSync(process.execPath, [launcher], { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  });
}

// Optional production smoke: only run against a built, isolated checkout.
// This loopback-only check simulates the proxy's forwarded metadata; it is
// not a validation of real HTTPS or a public deployment.
test('production guest launcher isolates the legacy route and requires HTTPS', {
  skip: process.env.NEXCIV_TEST_PRODUCTION_LAUNCH !== '1',
  timeout: 45000,
}, async () => {
  assert.ok(existsSync(path.join(root, 'apps/web/.next/BUILD_ID')), 'Build the isolated web checkout first.');
  const cache = path.join(root, 'cache');
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(path.join(cache, 'guest-launch-smoke-'));
  const db = path.join(scratch, 'guest.sqlite');
  const localDb = path.join(root, 'apps/web/cache/nexciv-cafe-v1.sqlite');
  assert.ok(!existsSync(localDb), 'Run the optional production smoke in a clean checkout without a local café DB.');
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const env = { ...valid, NEXCIV_GUEST_DB: db, NEXCIV_GUEST_PORT: String(port) };
  const child = spawn(process.execPath, [launcher], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let log = '';
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Production launcher did not become ready.')), 30000);
      child.stdout.on('data', (chunk) => {
        log += chunk;
        if (log.includes('Ready in')) { clearTimeout(deadline); resolve(); }
      });
      child.stderr.on('data', (chunk) => { log += chunk; });
      child.once('error', (error) => { clearTimeout(deadline); reject(error); });
      child.once('exit', (code) => { clearTimeout(deadline); reject(new Error(`Production launcher exited: ${code}`)); });
    });
    assert.ok(log.includes(`http://127.0.0.1:${port}`), 'Production server must bind loopback.');
    const request = (pathname, headers = {}) => new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port, path: pathname, headers }, (response) => {
        response.resume();
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers }));
      });
      req.setTimeout(3000, () => req.destroy(new Error('Loopback request timed out.')));
      req.on('error', reject);
    });
    const host = new URL(env.NEXCIV_GUEST_ORIGIN).host;
    const forwarded = { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https', 'x-forwarded-port': '443' };
    assert.equal((await request('/nexciv-preview', forwarded)).status, 200);
    assert.equal((await request('/api/nexciv-preview/guest', { host })).status, 403);
    const guest = await request('/api/nexciv-preview/guest', forwarded);
    assert.equal(guest.status, 200);
    assert.match(guest.headers['cache-control'], /private, no-store/);
    const cookie = guest.headers['set-cookie']?.join(';') ?? '';
    assert.match(cookie, /Secure/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\/api\/nexciv-preview\/guest/);
    assert.equal((await request('/api/nexciv-preview/cafe', forwarded)).status, 403);
    assert.equal((await request('/api/nexciv-preview/cafe')).status, 404);
    assert.ok(existsSync(db));
    assert.ok(!existsSync(localDb), 'The legacy local café DB must not be created.');
  } finally {
    if (child.exitCode === null && child.pid) {
      // On Windows stop only the process tree spawned by this test.
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGTERM');
    }
  }
});
