import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = path.join(root, 'apps/web');

function launch() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error('Node.js 22.13 or later is required.');

  const { NEXCIV_GUEST_ORIGIN: origin, NEXCIV_GUEST_DB: database, NEXCIV_GUEST_SECRET: secret } = process.env;
  if (!origin || new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin) {
    throw new Error('NEXCIV_GUEST_ORIGIN must be the exact HTTPS origin with no trailing slash.');
  }
  if (!database || !path.isAbsolute(database) || path.extname(database).toLowerCase() !== '.sqlite') {
    throw new Error('NEXCIV_GUEST_DB must be an absolute path to the separate guest .sqlite database.');
  }
  if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret) || Buffer.from(secret, 'base64url').toString('base64url') !== secret) {
    throw new Error('NEXCIV_GUEST_SECRET must be 32 random bytes encoded as base64url.');
  }
  if (process.env.NEXCIV_CAFE_DEMO_DB) throw new Error('Unset NEXCIV_CAFE_DEMO_DB for this guest-only service.');
  if (!existsSync(path.join(web, '.next/BUILD_ID'))) throw new Error('Build apps/web before starting the production guest service.');

  const port = process.env.NEXCIV_GUEST_PORT ?? '3000';
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('NEXCIV_GUEST_PORT must be an unprivileged TCP port.');
  const require = createRequire(path.join(web, 'package.json'));
  const next = require.resolve('next/dist/bin/next');
  const child = spawn(process.execPath, [next, 'start', '--hostname', '127.0.0.1', '--port', port], {
    cwd: web,
    // Prevent Next dotenv loading from starting the legacy, local-only café API.
    env: { ...process.env, NODE_ENV: 'production', NEXCIV_CAFE_DEMO_DB: '', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: 'inherit',
  });
  const relay = (signal) => child.kill(signal);
  process.once('SIGTERM', relay);
  process.once('SIGINT', relay);
  child.on('error', (error) => {
    console.error('Unable to start the production web service:', error.message);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.removeListener('SIGTERM', relay);
    process.removeListener('SIGINT', relay);
    process.exitCode = code ?? (signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1);
  });
}

try {
  launch();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
