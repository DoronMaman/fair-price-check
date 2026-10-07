import { defineConfig, devices } from '@playwright/test';

// End-to-end against the production build (one Fastify process serving API + UI),
// in template mode (no LLM key) so it is deterministic and free.
// Run: npm run build && npm run e2e
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3300',
    // The system Chrome — no browser download needed locally or on GitHub runners.
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], channel: 'chrome' } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 }, channel: 'chrome' } },
  ],
  webServer: {
    command: 'node apps/api/dist/server.mjs',
    url: 'http://localhost:3300/api/health',
    env: { PORT: '3300', LLM_API_KEY: '', LOG_LEVEL: 'warn' },
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
