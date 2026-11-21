import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Workspace packages resolve to their TS sources in tests so that tests run
 * against uncompiled code. Published/build outputs use dist/ (see each
 * package.json exports) — this alias is for the test runner only.
 */
const packageAliases: Record<string, string> = {
  '@agent-republic/domain': './packages/domain/src/index.ts',
  '@agent-republic/chain': './packages/chain/src/index.ts',
  '@agent-republic/agent-engine': './packages/agent-engine/src/index.ts',
  '@agent-republic/world-engine': './packages/world-engine/src/index.ts',
  '@agent-republic/ui': './packages/ui/src/index.ts',
};

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      Object.entries(packageAliases).map(([name, path]) => [
        name,
        fileURLToPath(new URL(path, import.meta.url)),
      ]),
    ),
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    environment: 'node',
  },
});
