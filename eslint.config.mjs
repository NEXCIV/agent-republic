import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.next/**', '**/cache/**', '**/next-env.d.ts', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Standalone Node + browser-context check scripts
    // (tests/responsive-check.mjs, scripts/audit-world-assets.mjs).
    files: ['tests/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        process: 'readonly',
        window: 'readonly',
        document: 'readonly',
        HTMLElement: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  {
    files: ['art-direction/tripo/researcher-03-v1/motion/preview.mjs'],
    languageOptions: {
      globals: {
        devicePixelRatio: 'readonly',
        document: 'readonly',
        URL: 'readonly',
      },
    },
  },
);
