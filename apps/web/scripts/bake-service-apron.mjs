import { createRequire } from 'node:module';
import { MathUtils } from 'three';

const { smoothstep } = MathUtils;
const require = createRequire(import.meta.url);

export async function bakeServiceApron(file) {
  const { json, accessor, bufferView } = file;
  const surface = json.nodes.find((node) => node.skin !== undefined);
  const skin = json.skins[surface.skin];
  const [primitive] = json.meshes[surface.mesh].primitives;
  const { POSITION, TEXCOORD_0 } = primitive.attributes;
  const positions = accessor(POSITION);
  const uv = accessor(TEXCOORD_0);
  const material = json.materials[primitive.material];
  const image = json.images[json.textures[material.pbrMetallicRoughness.baseColorTexture.index].source];
  const sharp = createRequire(require.resolve('next/package.json'))('sharp');
  const { data, info } = await sharp(bufferView(image.bufferView)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const vertices = [];
  const seamWeights = new Map();
  const rows = [];
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.get(i, 0);
    const y = positions.get(i, 1);
    const depth = positions.get(i, 2);
    if (y < 0.535 || y > 0.86 || depth < 0.023 || Math.abs(x) > 0.22) continue;
    const u = Math.round(MathUtils.clamp(uv.get(i, 0), 0, 1) * (info.width - 1));
    const v = Math.round(MathUtils.clamp(uv.get(i, 1), 0, 1) * (info.height - 1));
    const pixel = (v * info.width + u) * info.channels;
    const r = data[pixel], g = data[pixel + 1], b = data[pixel + 2];
    const orange = smoothstep(r - g, 13, 29) * smoothstep(g - b, 6, 17);
    // The light embroidery and pocket share the front surface, while the trousers sit behind it.
    const frontPanel = smoothstep(depth, 0.112, 0.133) * (1 - smoothstep(Math.abs(x), 0.144, 0.182));
    const amount = Math.max(orange, frontPanel) * smoothstep(depth, 0.024, 0.058)
      * (1 - smoothstep(y, 0.765, 0.858)) * (1 - smoothstep(Math.abs(x), 0.193, 0.218));
    const weight = Math.round(amount * 255);
    const seam = [x, y, depth].map((axis) => Math.round(axis * 10000)).join(',');
    seamWeights.set(seam, Math.max(seamWeights.get(seam) ?? 0, weight));
    vertices.push({ i, seam, x });
  }
  for (const { i, seam, x } of vertices) {
    const weight = seamWeights.get(seam);
    if (weight < 4) continue;
    const left = Math.round(smoothstep(x, -0.069, 0.069) * 255);
    rows.push(i, weight, left);
  }
  if (rows.length < 600) throw new Error('Apron panel mask is incomplete');
  return { count: positions.count, jointCount: skin.joints.length, rows };
}
