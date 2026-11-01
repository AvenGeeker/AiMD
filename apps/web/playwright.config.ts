import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * Playwright starts the *built* server (not a mock) against a dedicated `aimarkdown_e2e`
 * database, so these tests exercise the real REST API, the real Hocuspocus WebSocket and the real
 * Postgres mirror. `e2e/ensure-db.mjs` creates that database first, because Playwright starts
 * `webServer` before any `globalSetup` hook.
 *
 * Requires Docker: `make db-up` (Postgres on 127.0.0.1:5433).
 */

const REST_PORT = Number(process.env.E2E_REST_PORT ?? 3100);
const COLLAB_PORT = Number(process.env.E2E_COLLAB_PORT ?? 1310);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${REST_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node ../server/dist/index.js',
    cwd: process.cwd(),
    url: `http://127.0.0.1:${REST_PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      REST_PORT: String(REST_PORT),
      COLLAB_PORT: String(COLLAB_PORT),
      DATABASE_URL: process.env.E2E_DATABASE_URL
        ?? 'postgres://aimarkdown:aimarkdown_dev@127.0.0.1:5433/aimarkdown_e2e',
      JWT_SECRET: 'e2e-secret-0123456789abcdef0123456789abcdef',
      UPLOAD_DIR: './data/e2e-uploads',
      PUBLIC_URL: `http://127.0.0.1:${REST_PORT}`,
      CORS_ORIGIN: '*',
      ALLOW_REGISTRATION: 'true',
      WEB_DIST_DIR: './dist',
      // No reverse proxy in front of the E2E stack, so the browser must reach Hocuspocus
      // directly instead of relying on a /collab path rewrite.
      COLLAB_PUBLIC_URL: `ws://127.0.0.1:${COLLAB_PORT}`,
      LOG_LEVEL: 'warn',
      AUTH_RATE_LIMIT_MAX: '100000',
      API_RATE_LIMIT_MAX: '100000',
      // Short debounce so sync assertions resolve quickly without being flaky.
      COLLAB_DEBOUNCE: '300',
      COLLAB_MAX_DEBOUNCE: '1500',
      AI_ALLOW_PRIVATE_BASE_URL: 'true',
      AI_REQUEST_INTERVAL_MS: '0',
    },
  },
});
