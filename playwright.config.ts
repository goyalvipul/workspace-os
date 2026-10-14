import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:4398', trace: 'retain-on-failure', screenshot: 'only-on-failure', serviceWorkers: 'allow' },
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: 'http://localhost:4398/api/health/ready',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /02-.*\.spec\.ts/, dependencies: ['desktop'] },
  ],
});
