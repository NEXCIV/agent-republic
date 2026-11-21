// scripts/audit-world-assets.mjs — reports GLB sizes for the world assets.
// No hard budget gate (user decision 2026-11-20); sizes are informational.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'apps/web/public/world/district-01/v1');
const files = readdirSync(dir).filter((f) => f.endsWith('.glb'));
let total = 0;
for (const file of files) {
  const bytes = statSync(join(dir, file)).size;
  total += bytes;
  console.log(`${file}: ${(bytes / 1024).toFixed(1)} KB`);
}
console.log(`total: ${(total / 1024).toFixed(1)} KB`);

// After a Blender export, refresh the per-asset provenance in the existing manifest.
if (process.argv.includes('--write-manifest')) {
  const path = join(dir, 'assets.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  for (const asset of manifest.assets) {
    const glb = readFileSync(join(dir, asset.file));
    asset.bytes = glb.length;
    asset.sha256 = createHash('sha256').update(glb).digest('hex');
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
}
