import { defineConfig } from 'vitest/config';
// Vitest 4 no longer excludes dist/ by default; tsc -b emits compiled tests there.
export default defineConfig({
  test: { name: 'shared', passWithNoTests: true, exclude: ['**/node_modules/**', '**/dist/**'] },
});
