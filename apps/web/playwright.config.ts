import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * End-to-end journeys (docs/TESTING.md §5). The database is seeded on the host first
 * (`pnpm --filter web e2e:seed`); `auth.setup.ts` then signs each role in once and every spec
 * reuses its session. Screenshots are compared only in the Linux container (`e2e:snap`), where the
 * baselines are made.
 */

// The repo-root .env holds the port the app runs on locally (BETTER_AUTH_URL).
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3031';
const port = new URL(baseURL).port || '3031';
/** Set by `e2e:snap`: the app runs on the host and the runner only drives the browser. */
const external = process.env.E2E_EXTERNAL_APP === '1';

/**
 * Each run signs in from its own address, so the per-address caps on sign-in and password links
 * (docs/SECURITY.md §2) count one run's attempts, not the sum of every earlier run against the
 * same server.
 */
const runAddress = `10.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250))}.${String(1 + Math.floor(Math.random() * 250))}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  // One retry, reported as flaky: a busy machine now and then misses a page load. The steps that
  // use up a single-use link or code never retry (public.spec.ts).
  retries: 1,
  // CI compares against the committed baselines and never writes one; a local Linux run writes
  // a missing baseline, which is then reviewed and committed (`e2e:snap`).
  updateSnapshots: process.env.CI === undefined ? 'missing' : 'none',
  workers: 2,
  timeout: 60_000,
  // In CI a run that cannot finish in time stops with its report, before the job's own limit.
  globalTimeout: process.env.CI === undefined ? 0 : 20 * 60_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  reporter: [['list'], ['html', { outputFolder: './e2e/playwright-report', open: 'never' }]],
  use: {
    baseURL,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: { 'x-forwarded-for': runAddress },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'desktop-light',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        colorScheme: 'light',
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'desktop-dark',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        colorScheme: 'dark',
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'phone',
      dependencies: ['setup'],
      use: {
        ...devices['Pixel 7'],
        colorScheme: 'light',
        viewport: { width: 400, height: 860 },
      },
    },
  ],
  ...(external
    ? {}
    : {
        webServer: {
          // The production build, started as a local production run (apps/web/src/auth/deps.ts).
          // `next` straight from the script's PATH: under `pnpm exec`, pnpm 12 on Linux outlives
          // the runner's stop and leaves the server holding the port.
          command: `next start -p ${port}`,
          url: `${baseURL}/api/v1/health`,
          env: { BOS_ENVIRONMENT: 'local' },
          reuseExistingServer: process.env.CI === undefined,
          timeout: 120_000,
          stdout: 'pipe',
        },
      }),
});
