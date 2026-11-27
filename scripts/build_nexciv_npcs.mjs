import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = path.join(root, 'apps/web/public/nexciv-walk');
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const sharp = createRequire(webRequire.resolve('next/package.json'))('sharp');
const packer = process.argv[2];
if (!packer) throw new Error('Pass the path to gltfpack 0.25 or its npm cli.js.');
const models = ['04', '05', '07'];
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nexciv-npcs-'));
const input = path.join(tmp, 'prepared.glb');

const padding = (size, byte = 0) => Buffer.alloc((4 - (size % 4)) % 4, byte);

async function reduceTexture(source, destination) {
  const jsonEnd = 20 + source.readUInt32LE(12);
  const doc = JSON.parse(source.toString('utf8', 20, jsonEnd));
  const binary = source.subarray(jsonEnd + 8);
  const image = doc.images[0];
  const view = doc.bufferViews[image.bufferView];
  const original = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const texture = await sharp(original).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();
  image.mimeType = 'image/jpeg';
  view.byteOffset = binary.length;
  view.byteLength = texture.length;
  doc.animations = doc.animations.filter(({ name }) => name === 'Idle' || name === 'Walk');
  const bin = Buffer.concat([binary, texture, padding(texture.length)]);
  doc.buffers[0].byteLength = bin.length;
  const json = Buffer.from(JSON.stringify(doc));
  const jsonPadding = padding(json.length, 0x20);
  const header = Buffer.alloc(20);
  header.write('glTF');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + jsonPadding.length + bin.length, 8);
  header.writeUInt32LE(json.length + jsonPadding.length, 12);
  header.write('JSON', 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length);
  binHeader.write('BIN', 4);
  await fs.writeFile(destination, Buffer.concat([header, json, jsonPadding, binHeader, bin]));
}

try {
  for (const id of models) {
    const output = path.join(assets, `npc-${id}.glb`);
    await reduceTexture(await fs.readFile(path.join(assets, `agent-${id}.glb`)), input);
    // Preserve UV islands and animated joints when simplifying the textured character.
    const options = ['-i', input, '-o', output, '-si', '0.25', '-vtf', '-kn', '-ke', '-cc', '-af', '24'];
    if (packer.endsWith('.js')) execFileSync(process.execPath, [packer, ...options], { stdio: 'inherit' });
    else execFileSync(packer, options, { stdio: 'inherit' });
    const bytes = await fs.readFile(output);
    const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    if (!json.nodes.some(node => node.extras?.walk_stride_m > 0)
      || !['Idle', 'Walk'].every(name => json.animations.some(clip => clip.name === name))) {
      throw new Error(`Missing walk or idle data in ${output}`);
    }
    console.log(path.basename(output), bytes.length, 'bytes');
  }
} finally {
  await fs.rm(input, { force: true });
  await fs.rmdir(tmp);
}

const routes = new Map(await Promise.all([
  'nexus-connector', 'route', 'governance-route', 'west-route', 'east-routes',
  'research-route', 'residential-route', 'lakeshore-route',
].map(async name => [name, JSON.parse(await fs.readFile(path.join(assets, `${name}.json`), 'utf8'))])));
const east = routes.get('east-routes');
routes.set('registry', east.registry);
routes.set('works', east.works);
// Use short portions of the surveyed walking paths, stopping short of the activity anchors.
const paths = [
  ['plaza-south', '04', 'nexus-connector', 'alternate', 8, 47, 1.09, 0.27, 4],
  ['plaza-east', '05', 'nexus-connector', 'points', 57, 105, 1.18, 0.68, 5],
  ['plaza-north', '07', 'nexus-connector', 'alternate', 111, 142, 1.03, 0.59, 4],
  ['cafe-approach', '07', 'route', 'alternate', 12, 45, 1.12, 0.18, 4],
  ['cafe-sidewalk', '05', 'route', 'points', 62, 91, 0.98, 0.24, 6],
  ['council', '04', 'governance-route', 'alternate', 89, 150, 1.16, 0.77, 5],
  ['theatre-approach', '07', 'west-route', 'alternate', 252, 268, 1.08, 0.62, 4],
  ['theatre-sidewalk', '05', 'west-route', 'points', 268, 285, 1.24, 0.31, 5],
  ['registry', '05', 'registry', 'alternate', 26, 106, 1.21, 0.46, 6],
  ['construction', '04', 'works', 'points', 15, 74, 1.29, 0.28, 4],
  ['research', '04', 'research-route', 'alternate', 158, 205, 1.13, 0.68, 6],
  ['residential', '07', 'residential-route', 'points', 64, 103, 1.02, 0.34, 7],
  ['shore-west', '05', 'lakeshore-route', 'points', 230, 291, 1.07, 0.23, 6],
  ['shore-east', '04', 'lakeshore-route', 'alternate', 306, 370, 1.25, 0.63, 5],
].map(([id, model, route, track, first, last, speed, start, pause], index) => {
  const points = routes.get(route)[track].slice(first, last);
  if (points.length !== last - first) throw new Error(`Missing surveyed points for ${id}`);
  return { id, model, speed, start, pause, reverse: index % 2 !== 0, points };
});
await fs.writeFile(path.join(assets, 'npc-paths.json'), JSON.stringify(paths) + '\n');
