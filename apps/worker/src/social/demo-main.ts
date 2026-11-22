import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { DemoSocialStore } from './demo-store.js';

const fixture = new URL('../../../../examples/world-frame.demo.json', import.meta.url);
const modes = ['run', 'once', 'history', 'pause', 'resume'];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('The social DEMO cannot run in production');
  const [mode = 'run', agentId, ...extra] = process.argv.slice(2);
  const needsAgent = mode === 'pause' || mode === 'resume';
  if (!modes.includes(mode) || needsAgent !== Boolean(agentId) || extra.length !== 0) {
    throw new Error('Usage: social:demo [run | once | history | pause <agent-id> | resume <agent-id>]');
  }
  const databaseUrl = process.env.SOCIAL_DEMO_DATABASE_URL;
  if (!databaseUrl) throw new Error('Set SOCIAL_DEMO_DATABASE_URL to a dedicated _social_demo database');
  const store = new DemoSocialStore(databaseUrl, JSON.parse(await readFile(fixture, 'utf8')));
  const stop = new AbortController();
  const requestStop = (): void => { stop.abort(); };
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);
  try {
    await store.initialize();
    if (needsAgent && agentId) {
      await store.setPaused(agentId, mode === 'pause');
      console.log(JSON.stringify({ mode: 'DEMO', agentId, paused: mode === 'pause' }));
    } else if (mode === 'history') {
      console.log(JSON.stringify({ mode: 'DEMO', sessions: await store.history() }, null, 2));
    } else if (mode === 'once') {
      console.log(JSON.stringify({ mode: 'DEMO', session: await store.step() }));
    } else {
      console.log('DEMO · Social worker running independently of the browser');
      while (!stop.signal.aborted) {
        try {
          const session = await store.step();
          if (session) {
            console.log(JSON.stringify({ mode: 'DEMO', sessionId: session.id, status: session.status, reason: session.reason }));
          }
        } catch (error) {
          console.error('DEMO worker step failed; will retry:', error instanceof Error ? error.message : 'unknown error');
        }
        if (!stop.signal.aborted) {
          await sleep(2_000, undefined, { signal: stop.signal }).catch(() => undefined);
        }
      }
    }
  } finally {
    process.off('SIGINT', requestStop);
    process.off('SIGTERM', requestStop);
    await store.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unable to start social DEMO');
  process.exitCode = 1;
});
