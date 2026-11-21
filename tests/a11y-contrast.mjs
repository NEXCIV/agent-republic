import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * E7-04 — WCAG 2.1 AA contrast check for the UI tokens in globals.css.
 *
 * Reads the declared CSS variables, computes relative luminance and contrast
 * ratios, and fails if a declared text/background pair falls below 4.5:1
 * (normal text). It does not replace a browser audit, but it is deterministic
 * and runs without network or extra dependencies.
 */

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CSS = path.join(ROOT, 'apps', 'web', 'src', 'app', 'globals.css');
const source = readFileSync(CSS, 'utf8');

// Only the :root block defines global tokens; scoped dark sections redeclare
// some variables and must not overwrite the light-page values under test.
const rootBlock = source.match(/:root\s*\{([\s\S]*?)\}/);
const rootCss = rootBlock === null ? source : rootBlock[1];

const variables = new Map();
for (const match of rootCss.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
  variables.set(match[1], match[2].toLowerCase());
}

const value = (name) => {
  if (name.startsWith('#')) return name.toLowerCase();
  const token = variables.get(name);
  if (token === undefined) {
    console.error(`Missing CSS variable --${name}`);
    process.exit(2);
  }
  return token;
};

function channelLuminance(hex) {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const a = channelLuminance(value(foreground));
  const b = channelLuminance(value(background));
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

const PAIRS = [
  ['hero text', 'cream-text', 'night'],
  ['hero muted', 'cream-muted', 'night'],
  ['hero yellow', 'yellow', 'night'],
  ['body text', 'ink', 'paper'],
  ['panel text', 'ink', 'paper-raised'],
  ['secondary text', 'ink-soft', 'paper-raised'],
  ['hint text', 'ink-muted', 'paper'],
  ['link teal', 'teal', 'paper'],
  ['error banner', 'danger', 'danger-soft'],
  ['warning banner', 'amber', 'amber-soft'],
  ['success', 'success', 'success-soft'],
  ['primary button', 'night', 'yellow'],
  ['accent on yellow', 'night', 'yellow'],
  ['gold accent', 'amber', 'paper-raised'],
];

let failures = 0;
console.log('PAIR                     FOREGROUND   BACKGROUND   RATIO   MIN   RESULT');
for (const [label, foreground, background] of PAIRS) {
  const ratio = contrast(foreground, background);
  const ok = ratio >= 4.5;
  if (!ok) failures += 1;
  console.log(
    `${label.padEnd(24)} ${value(foreground).padEnd(12)} ${value(background).padEnd(12)} ` +
      `${ratio.toFixed(2).padStart(5)}   4.50  ${ok ? 'PASS' : 'FAIL'}`,
  );
}

console.log(`\n${PAIRS.length - failures}/${PAIRS.length} token pairs meet WCAG AA (4.5:1).`);
process.exit(failures === 0 ? 0 : 1);
