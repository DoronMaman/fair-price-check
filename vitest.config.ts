import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/shared', 'apps/api', 'apps/web'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['packages/shared/src/**/*.ts', 'apps/api/src/**/*.ts', 'apps/web/src/**/*.{ts,tsx}'],
      // Scripts are exercised by running them; entry points by e2e.
      exclude: ['**/*.test.*', '**/scripts/**', '**/test/**', 'apps/api/src/server/main.ts', 'apps/web/src/main.tsx'],
      reporter: ['text-summary', 'html'],
    },
  },
});
