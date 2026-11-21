import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * This Windows environment's pnpm workspace junctions are unreliable, so the
 * web bundle resolves the shared TypeScript packages to their built output
 * explicitly. Build order is guaranteed by the workspace dependency graph.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@agent-republic/chain': path.resolve(here, '../../packages/chain/dist/index.js'),
      '@agent-republic/domain': path.resolve(here, '../../packages/domain/dist/index.js'),
      '@agent-republic/world-engine': path.resolve(here, '../../packages/world-engine/dist/index.js'),
    };
    return config;
  },
};

export default nextConfig;
