import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createDemoCity } from './nexciv-demo-city.mjs';

const city = createDemoCity();
const provider = new URL(process.env.NEXCIV_MODEL_BASE_URL ?? '');
if (provider.protocol !== 'https:' || provider.username || provider.password || provider.search || provider.hash) {
  throw new Error('NEXCIV_MODEL_BASE_URL must be an HTTPS API base URL without credentials or query parameters.');
}
provider.pathname = provider.pathname.replace(/\/$/, '') + '/chat/completions';
const model = process.env.NEXCIV_MODEL;
if (!model) throw new Error('Set NEXCIV_MODEL to the provider model name.');

async function readMaskedKey() {
  if (!process.stdin.isTTY) throw new Error('Set NEXCIV_MODEL_API_KEY for non-interactive use.');
  process.stdout.write('Model API key (hidden): ');
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  let key = '';
  try {
    for await (const input of process.stdin) {
      if (input.includes('\x03')) throw new Error('Cancelled.');
      const end = input.search(/[\r\n]/);
      key += end === -1 ? input : input.slice(0, end);
      if (end !== -1) return key.trim();
    }
  } finally {
    process.stdin.setRawMode(false);
    process.stdout.write('\n');
  }
  return '';
}

async function decide(observation) {
  const key = process.env.NEXCIV_MODEL_API_KEY || await readMaskedKey();
  if (!key) throw new Error('A model API key is required.');
  const response = await fetch(provider, {
    method: 'POST',
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model,
      max_completion_tokens: 384,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: 'You decide the next move for NEXCIV observer 01. Use only the provided observation. Prefer going to the other available source when Ahe is busy and no note asks you to wait. Output exactly a JSON object with one field action, whose value is one of the actions in the observation. No prose.' },
        { role: 'user', content: JSON.stringify(observation) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Model request returned HTTP ${response.status}.`);
  const body = await response.json().catch(() => null);
  const raw = body?.choices?.[0]?.message?.content;
  let value;
  try { value = typeof raw === 'string' && raw.length <= 512 ? JSON.parse(raw) : null; } catch { value = null; }
  if (!value || Object.keys(value).length !== 1 || !observation.actions.includes(value.action)) {
    throw new Error('The model did not return an allowed action.');
  }
  return value.action;
}

async function run() {
  // The isolated demo issues a distinct resident cookie to this harness.
  const request = city.useSession(await city.createSession());

  await request('', { action: 'start', kind: 'observer', driver: 'external', busy: true, requestId: randomUUID() });
  const observation = await request('?control=observer');
  if (!observation?.actions?.length) throw new Error('No current observer action is available.');
  const choice = await decide(observation);
  const { shiftStartedAt } = observation;
  const requestId = randomUUID();
  const command = { action: 'choose', choice, shiftStartedAt, requestId };
  const accepted = await request('', command);
  if (!accepted.accepted) throw new Error(accepted.feedback ?? 'The city rejected the proposed action.');
  const replay = await request('', command);
  if (!replay.accepted) throw new Error('The accepted city receipt could not be replayed.');
  console.log(JSON.stringify({ model, choice, firstPhase: accepted.run.phase, duplicateReceipt: replay.accepted }));

  // No additional model calls are needed while the city executes the interview.
  const until = Date.now() + 175000;
  while (Date.now() < until) {
    const current = await request();
    if (current.run.phase === 'done') {
      const archive = await request('?newspaper=latest');
      if (archive.current?.sources.length !== 2) throw new Error('The finished interview is missing its sourced edition.');
      console.log(JSON.stringify({
        phase: current.run.phase,
        interviewOrder: archive.current.sources.map(({ speaker }) => speaker),
        headline: archive.current.issue.headline,
        modelCalls: 1,
      }));
      return;
    }
    await delay(2500);
  }
  throw new Error('The city interview did not finish within the smoke-test window.');
}

try { await run(); } catch (error) {
  console.error(error instanceof Error ? error.message : 'The observer harness failed.');
  process.exitCode = 1;
}
