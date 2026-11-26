import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = path.join(root, 'apps/web');
const require = createRequire(path.join(web, 'package.json'));
const db = process.env.NEXCIV_SHARED_PILOT_DB || path.join(root, 'cache/nexciv-shared-pilot.sqlite');
const port = process.env.NEXCIV_SHARED_PILOT_PORT || '3142';
if (!path.isAbsolute(db) || path.extname(db).toLowerCase() !== '.sqlite' || !/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
  throw new Error('Shared pilot needs an absolute .sqlite database and local TCP port.');
}
if (!process.getBuiltinModule?.('node:sqlite')) throw new Error('Shared pilot requires Node.js 22.13+ with SQLite.');

const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', port], {
  cwd: web,
  env: { ...process.env, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', NEXCIV_SHARED_PILOT_DB: db },
  stdio: 'inherit',
});
console.log(`NEXCIV local shared city: http://127.0.0.1:${port}/nexciv-preview/shared`);
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
child.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 0; });
