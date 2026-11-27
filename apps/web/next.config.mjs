import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sharedInvitesOpen = process.env.NODE_ENV !== 'production' && process.env.NEXCIV_SHARED_PILOT_DB
  && (process.env.NEXCIV_SHARED_INVITE_01 || process.env.NEXCIV_SHARED_INVITE_02);

/**
 * This Windows environment's pnpm workspace junctions are unreliable, so the
 * web bundle resolves the shared TypeScript packages to their built output
 * explicitly. Build order is guaranteed by the workspace dependency graph.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  async redirects() {
    return [
      { source: '/my-agent', has: [{ type: 'query', key: 'visit' }], destination: '/agent-console', permanent: false },
      { source: '/my-agent', has: [{ type: 'query', key: 'meet' }], destination: '/agent-console', permanent: false },
      { source: '/my-agent/demo', destination: '/agent-console/demo', permanent: false },
      {
        source: '/my-agent',
        destination: sharedInvitesOpen ? '/nexciv-preview/shared/join' : '/nexciv-preview/cafe?connect=1#connect-agent',
        permanent: false,
      },
    ];
  },
  // The explicit shared-city local pilot can run beside the existing preview.
  ...(process.env.NEXCIV_SHARED_PILOT_DB && process.env.NODE_ENV !== 'production' ? { distDir: 'cache/shared-next' } : {}),
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@agent-republic/agent-engine': path.resolve(here, '../../packages/agent-engine/dist/index.js'),
      '@agent-republic/chain': path.resolve(here, '../../packages/chain/dist/index.js'),
      '@agent-republic/domain': path.resolve(here, '../../packages/domain/dist/index.js'),
      '@agent-republic/world-engine': path.resolve(here, '../../packages/world-engine/dist/index.js'),
    };
    return config;
  },
};

export default nextConfig;
