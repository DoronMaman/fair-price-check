import { defineConfig } from 'vitest/config';
// Pure-function tests only (no DOM), so the node environment is enough.
export default defineConfig({ test: { name: 'web', exclude: ['**/node_modules/**', '**/dist/**'] } });
